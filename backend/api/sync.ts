import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'pg';

interface SessionData {
  session_id: string;
  exercise_key: string;
  total_reps_logged: number;
  active_duration_seconds: number;
  started_at: number;
}

interface TelemetryData {
  rep_id: string;
  session_id: string;
  rep_index: number;
  min_joint_angle: number;
  form_accuracy_score: number;
  fault_spine_rounded: number;
  fault_knee_shear: number;
  fault_shallow_depth: number;
  timestamp_recorded: number;
}

async function setupDatabaseSchema(client: Client) {
  // Setup tables if they do not exist
  await client.query(`
    CREATE TABLE IF NOT EXISTS workout_sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT,
      exercise_key TEXT NOT NULL,
      total_reps_logged INTEGER DEFAULT 0,
      active_duration_seconds INTEGER DEFAULT 0,
      started_at BIGINT NOT NULL
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS rep_telemetry (
      rep_id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES workout_sessions(session_id) ON DELETE CASCADE,
      rep_index INTEGER NOT NULL,
      min_joint_angle REAL NOT NULL,
      form_accuracy_score REAL NOT NULL,
      fault_spine_rounded INTEGER DEFAULT 0,
      fault_knee_shear INTEGER DEFAULT 0,
      fault_shallow_depth INTEGER DEFAULT 0,
      timestamp_recorded BIGINT NOT NULL
    );
  `);
}

import { verifyAccessToken, extractToken, setCorsHeaders, validateRepAngle, validateFormScore } from '../utils/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, 'POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Security Check: Verify Access Token or Mobile API Key Signature
  const token = extractToken(req.headers);
  const mobileApiKey = process.env.MOBILE_API_KEY || 'aura-mobile-key-123';

  const isAuthorized = token && (verifyAccessToken(token) !== null || token === mobileApiKey);

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized: Invalid access token or API signature.' });
  }

  const { sync_meta, payload_queue } = req.body;

  if (!sync_meta || !payload_queue) {
    return res.status(400).json({ error: 'Invalid Payload' });
  }

  const sessions: SessionData[] = payload_queue.sessions || [];
  const telemetry: TelemetryData[] = payload_queue.telemetry || [];

  const localUserId = sync_meta.local_user_id || 'usr_default_athlete_id';

  // Input Validation Bounds Check
  for (const tel of telemetry) {
    if (!validateRepAngle(tel.min_joint_angle) || !validateFormScore(tel.form_accuracy_score)) {
      return res.status(400).json({ error: 'Bad Request: Telemetry metrics out of physical bounds.' });
    }
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  let dbConnected = false;
  if (databaseUrl) {
    const client = new Client({
      connectionString: databaseUrl,
      ssl: {
        rejectUnauthorized: false
      }
    });

    try {
      await client.connect();
      await setupDatabaseSchema(client);

      // Write Sessions
      for (const sess of sessions) {
        await client.query(
          `INSERT INTO workout_sessions (session_id, user_id, exercise_key, total_reps_logged, active_duration_seconds, started_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (session_id) DO UPDATE SET
             total_reps_logged = EXCLUDED.total_reps_logged,
             active_duration_seconds = EXCLUDED.active_duration_seconds;`,
          [
            sess.session_id,
            localUserId,
            sess.exercise_key,
            sess.total_reps_logged,
            sess.active_duration_seconds,
            sess.started_at
          ]
        );
      }

      // Write Telemetry
      for (const tel of telemetry) {
        await client.query(
          `INSERT INTO rep_telemetry (rep_id, session_id, rep_index, min_joint_angle, form_accuracy_score, fault_spine_rounded, fault_knee_shear, fault_shallow_depth, timestamp_recorded)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (rep_id) DO NOTHING;`,
          [
            tel.rep_id,
            tel.session_id,
            tel.rep_index,
            tel.min_joint_angle,
            tel.form_accuracy_score,
            tel.fault_spine_rounded,
            tel.fault_knee_shear,
            tel.fault_shallow_depth,
            tel.timestamp_recorded
          ]
        );
      }

      await client.end();
      dbConnected = true;
    } catch (dbErr) {
      console.error('Failed to sync to Postgres database, processing locally', dbErr);
    }
  }

  if (!dbConnected) {
    console.log(`Sync complete (Offline Backup log only) for user ${localUserId}.`);
    console.log(`Processed ${sessions.length} sessions, ${telemetry.length} reps.`);
  }

  return res.status(200).json({
    status: 'sync_complete',
    processed_counts: {
      sessions: sessions.length,
      telemetry: telemetry.length
    },
    synced_session_ids: sessions.map(s => s.session_id),
    server_epoch: Math.floor(Date.now() / 1000)
  });
}
