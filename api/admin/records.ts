import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'pg';

interface RepTelemetry {
  rep_id: string;
  rep_index: number;
  min_joint_angle: number;
  form_accuracy_score: number;
  fault_spine_rounded: number;
  fault_knee_shear: number;
  fault_shallow_depth: number;
  timestamp_recorded: number;
}

interface WorkoutSessionRecord {
  session_id: string;
  username: string;
  exercise_key: string;
  total_reps_logged: number;
  active_duration_seconds: number;
  avg_accuracy: number;
  started_at: number;
  telemetry: RepTelemetry[];
}

const MOCK_RECORDS: WorkoutSessionRecord[] = [
  {
    session_id: 'sess_mock_1',
    username: 'FlexMaster',
    exercise_key: 'pushup',
    total_reps_logged: 10,
    active_duration_seconds: 35,
    avg_accuracy: 96.5,
    started_at: Date.now() - 1000 * 60 * 30, // 30 mins ago
    telemetry: [
      { rep_id: 'rep_m1_1', rep_index: 1, min_joint_angle: 74.2, form_accuracy_score: 98.0, fault_spine_rounded: 0, fault_knee_shear: 0, fault_shallow_depth: 0, timestamp_recorded: Date.now() - 1000 * 60 * 30 + 5000 },
      { rep_id: 'rep_m1_2', rep_index: 2, min_joint_angle: 75.1, form_accuracy_score: 97.5, fault_spine_rounded: 0, fault_knee_shear: 0, fault_shallow_depth: 0, timestamp_recorded: Date.now() - 1000 * 60 * 30 + 8000 },
      { rep_id: 'rep_m1_3', rep_index: 3, min_joint_angle: 76.5, form_accuracy_score: 94.0, fault_spine_rounded: 0, fault_knee_shear: 0, fault_shallow_depth: 0, timestamp_recorded: Date.now() - 1000 * 60 * 30 + 11000 }
    ]
  },
  {
    session_id: 'sess_mock_2',
    username: 'SquatQueen',
    exercise_key: 'squat',
    total_reps_logged: 15,
    active_duration_seconds: 52,
    avg_accuracy: 95.8,
    started_at: Date.now() - 1000 * 60 * 120, // 2 hours ago
    telemetry: [
      { rep_id: 'rep_m2_1', rep_index: 1, min_joint_angle: 92.4, form_accuracy_score: 97.0, fault_spine_rounded: 0, fault_knee_shear: 0, fault_shallow_depth: 0, timestamp_recorded: Date.now() - 1000 * 60 * 120 + 4000 },
      { rep_id: 'rep_m2_2', rep_index: 2, min_joint_angle: 98.6, form_accuracy_score: 93.0, fault_spine_rounded: 0, fault_knee_shear: 0, fault_shallow_depth: 1, timestamp_recorded: Date.now() - 1000 * 60 * 120 + 9000 },
      { rep_id: 'rep_m2_3', rep_index: 3, min_joint_angle: 93.1, form_accuracy_score: 97.4, fault_spine_rounded: 0, fault_knee_shear: 0, fault_shallow_depth: 0, timestamp_recorded: Date.now() - 1000 * 60 * 120 + 14000 }
    ]
  },
  {
    session_id: 'sess_mock_3',
    username: 'IronBeast',
    exercise_key: 'dumbbell_fly',
    total_reps_logged: 8,
    active_duration_seconds: 40,
    avg_accuracy: 91.2,
    started_at: Date.now() - 1000 * 60 * 600, // 10 hours ago
    telemetry: [
      { rep_id: 'rep_m3_1', rep_index: 1, min_joint_angle: 32.1, form_accuracy_score: 92.0, fault_spine_rounded: 0, fault_knee_shear: 0, fault_shallow_depth: 0, timestamp_recorded: Date.now() - 1000 * 60 * 600 + 5000 },
      { rep_id: 'rep_m3_2', rep_index: 2, min_joint_angle: 28.5, form_accuracy_score: 95.0, fault_spine_rounded: 0, fault_knee_shear: 0, fault_shallow_depth: 0, timestamp_recorded: Date.now() - 1000 * 60 * 600 + 10000 },
      { rep_id: 'rep_m3_3', rep_index: 3, min_joint_angle: 35.8, form_accuracy_score: 86.6, fault_spine_rounded: 1, fault_knee_shear: 0, fault_shallow_depth: 0, timestamp_recorded: Date.now() - 1000 * 60 * 600 + 16000 }
    ]
  }
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  let finalRecords = [...MOCK_RECORDS];

  if (databaseUrl) {
    const client = new Client({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }
    });

    try {
      await client.connect();

      // Query sessions
      const sessionsResult = await client.query(
        `SELECT * FROM workout_sessions ORDER BY started_at DESC LIMIT 100;`
      );

      if (sessionsResult.rows.length > 0) {
        // Query all telemetry for these sessions
        const sessionIds = sessionsResult.rows.map(s => s.session_id);
        const telemetryResult = await client.query(
          `SELECT * FROM rep_telemetry WHERE session_id = ANY($1) ORDER BY rep_index ASC;`,
          [sessionIds]
        );

        // Group telemetry by session_id
        const telemetryBySession: Record<string, RepTelemetry[]> = {};
        telemetryResult.rows.forEach((row) => {
          if (!telemetryBySession[row.session_id]) {
            telemetryBySession[row.session_id] = [];
          }
          telemetryBySession[row.session_id].push({
            rep_id: row.rep_id,
            rep_index: row.rep_index,
            min_joint_angle: row.min_joint_angle,
            form_accuracy_score: parseFloat(row.form_accuracy_score.toFixed(1)),
            fault_spine_rounded: row.fault_spine_rounded,
            fault_knee_shear: row.fault_knee_shear,
            fault_shallow_depth: row.fault_shallow_depth,
            timestamp_recorded: Number(row.timestamp_recorded)
          });
        });

        // Map rows to WorkoutSessionRecord structure
        const dbRecords: WorkoutSessionRecord[] = sessionsResult.rows.map((sess) => {
          const reps = telemetryBySession[sess.session_id] || [];
          const avgAcc = reps.length > 0
            ? reps.reduce((sum, r) => sum + r.form_accuracy_score, 0) / reps.length
            : 100.0;

          let displayName = sess.user_id;
          if (sess.user_id === 'usr_default_athlete_id') {
            displayName = 'You (Local Athlete)';
          } else if (sess.user_id.startsWith('usr_')) {
            displayName = 'Athlete_' + sess.user_id.slice(4, 9);
          }

          return {
            session_id: sess.session_id,
            username: displayName,
            exercise_key: sess.exercise_key,
            total_reps_logged: sess.total_reps_logged,
            active_duration_seconds: sess.active_duration_seconds,
            avg_accuracy: parseFloat(avgAcc.toFixed(1)),
            started_at: Number(sess.started_at) * (sess.started_at < 10000000000 ? 1000 : 1), // safety for unix timestamps vs millis
            telemetry: reps
          };
        });

        // Combine database records with mock records to keep the feed interesting
        // Put database records first, then mock records
        finalRecords = [...dbRecords, ...MOCK_RECORDS];
      }

      await client.end();
    } catch (dbErr) {
      console.error('Error fetching records from Postgres, returning mocks', dbErr);
    }
  }

  return res.status(200).json(finalRecords);
}
