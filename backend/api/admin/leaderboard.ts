import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'pg';

interface LeaderboardEntry {
  rank: number;
  username: string;
  avg_accuracy: number;
  total_reps: number;
  total_sessions: number;
  primary_exercise: string;
}

const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  { rank: 1, username: 'FlexMaster', avg_accuracy: 96.5, total_reps: 480, total_sessions: 16, primary_exercise: 'Pushups' },
  { rank: 2, username: 'SquatQueen', avg_accuracy: 95.8, total_reps: 520, total_sessions: 15, primary_exercise: 'Squats' },
  { rank: 3, username: 'IronBeast', avg_accuracy: 91.2, total_reps: 380, total_sessions: 12, primary_exercise: 'Chest Flyes' },
  { rank: 4, username: 'GymBro99', avg_accuracy: 88.4, total_reps: 290, total_sessions: 10, primary_exercise: 'Squats' },
  { rank: 5, username: 'AuraFit_Jess', avg_accuracy: 86.9, total_reps: 310, total_sessions: 9, primary_exercise: 'Pushups' }
];

const formatExerciseName = (key: string): string => {
  if (key === 'squat') return 'Squats';
  if (key === 'pushup') return 'Pushups';
  if (key === 'dumbbell_fly') return 'Chest Flyes';
  return key;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-admin-login-pin'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Security Check: Verify x-admin-login-pin header
  const adminKey = process.env.ADMIN_LOGIN_PIN || 'admin123';
  const incomingKey = req.headers['x-admin-login-pin'];

  if (incomingKey !== adminKey) {
    if (!process.env.ADMIN_LOGIN_PIN) {
      console.warn("WARNING: ADMIN_LOGIN_PIN env variable is not set. Using default 'admin123'. Please configure it in Vercel.");
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid Admin Login PIN.' });
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  let finalLeaderboard = [...MOCK_LEADERBOARD];

  if (databaseUrl) {
    const client = new Client({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }
    });

    try {
      await client.connect();

      // Ensure tables exist
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
      
      const query = `
        SELECT 
          ws.user_id,
          u.username,
          COALESCE(AVG(rt.form_accuracy_score), 100.0) as avg_accuracy,
          COALESCE(SUM(ws.total_reps_logged), 0)::integer as total_reps,
          COUNT(DISTINCT ws.session_id)::integer as total_sessions,
          MAX(ws.exercise_key) as primary_exercise
        FROM workout_sessions ws
        LEFT JOIN rep_telemetry rt ON ws.session_id = rt.session_id
        LEFT JOIN users u ON ws.user_id = u.user_id
        GROUP BY ws.user_id, u.username;
      `;

      const result = await client.query(query);
      
      // Map database users
      const dbEntries: LeaderboardEntry[] = result.rows.map((row) => {
        // Human-readable username mapping
        let displayName = row.username || row.user_id;
        if (row.user_id === 'usr_default_athlete_id') {
          displayName = 'You (Local Athlete)';
        } else if (!row.username && row.user_id && row.user_id.startsWith('usr_')) {
          displayName = 'Athlete_' + row.user_id.slice(4, 9);
        }

        return {
          rank: 0, // Assigned later
          username: displayName,
          avg_accuracy: parseFloat(parseFloat(row.avg_accuracy).toFixed(1)),
          total_reps: row.total_reps,
          total_sessions: row.total_sessions,
          primary_exercise: formatExerciseName(row.primary_exercise || 'squat')
        };
      });

      // Combine and filter duplicates (e.g. if username already exists)
      const combined = [...dbEntries, ...MOCK_LEADERBOARD];
      const uniqueUsernames = new Set<string>();
      const deduplicated: LeaderboardEntry[] = [];

      for (const entry of combined) {
        if (!uniqueUsernames.has(entry.username)) {
          uniqueUsernames.add(entry.username);
          deduplicated.push(entry);
        }
      }

      // Sort by accuracy descending
      deduplicated.sort((a, b) => b.avg_accuracy - a.avg_accuracy);

      // Re-assign ranks
      finalLeaderboard = deduplicated.map((entry, idx) => ({
        ...entry,
        rank: idx + 1
      }));

      await client.end();
    } catch (dbErr) {
      console.error('Error fetching leaderboard from Postgres, returning mocks', dbErr);
    }
  }

  return res.status(200).json(finalLeaderboard);
}
