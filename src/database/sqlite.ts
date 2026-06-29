import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export function getDb() {
  if (!db) {
    db = SQLite.openDatabaseSync('aura_fitness.db');
  }
  return db;
}

export function initDb() {
  const database = getDb();
  if (!database) return;
  
  // Enable foreign keys
  database.execSync('PRAGMA foreign_keys = ON;');

  // Create local_users table
  database.execSync(`
    CREATE TABLE IF NOT EXISTS local_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      role_profile TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // Create workout_sessions table
  database.execSync(`
    CREATE TABLE IF NOT EXISTS workout_sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      exercise_key TEXT NOT NULL,
      total_reps_logged INTEGER NOT NULL,
      active_duration_seconds INTEGER NOT NULL,
      is_synced INTEGER DEFAULT 0,
      started_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES local_users(id)
    );
  `);

  // Create rep_telemetry table
  database.execSync(`
    CREATE TABLE IF NOT EXISTS rep_telemetry (
      rep_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      rep_index INTEGER NOT NULL,
      min_joint_angle REAL NOT NULL,
      form_accuracy_score REAL NOT NULL,
      fault_spine_rounded INTEGER DEFAULT 0,
      fault_knee_shear INTEGER DEFAULT 0,
      fault_shallow_depth INTEGER DEFAULT 0,
      timestamp_recorded INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES workout_sessions(session_id) ON DELETE CASCADE
    );
  `);

  // Create downloaded_modules table for caching
  database.execSync(`
    CREATE TABLE IF NOT EXISTS downloaded_modules (
      exercise_key TEXT PRIMARY KEY,
      schema_json TEXT NOT NULL,
      downloaded_at INTEGER NOT NULL
    );
  `);

  // Seed default user if not exists
  const userCount = database.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM local_users;');
  if (userCount && userCount.count === 0) {
    const defaultUserId = 'usr_default_athlete_id';
    database.runSync(
      'INSERT INTO local_users (id, username, role_profile, created_at) VALUES (?, ?, ?, ?);',
      defaultUserId,
      'gym_bro_default',
      'athlete',
      Math.floor(Date.now() / 1000)
    );
  }
}

export function createUser(username: string): { id: string; username: string } {
  const database = getDb();
  const id = 'usr_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const createdAt = Math.floor(Date.now() / 1000);
  
  if (database) {
    database.runSync(
      'INSERT INTO local_users (id, username, role_profile, created_at) VALUES (?, ?, ?, ?);',
      id,
      username,
      'athlete',
      createdAt
    );
  }
  
  return { id, username };
}

export function getLocalUsers() {
  const database = getDb();
  return database ? database.getAllSync<{ id: string; username: string; role_profile: string }>('SELECT * FROM local_users;') : [];
}

export function startWorkoutSession(userId: string, exerciseKey: string): string {
  const database = getDb();
  const sessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const startedAt = Math.floor(Date.now() / 1000);
  
  if (database) {
    database.runSync(
      'INSERT INTO workout_sessions (session_id, user_id, exercise_key, total_reps_logged, active_duration_seconds, is_synced, started_at) VALUES (?, ?, ?, 0, 0, 0, ?);',
      sessionId,
      userId,
      exerciseKey,
      startedAt
    );
  }
  
  return sessionId;
}

export function incrementSessionReps(sessionId: string): number {
  const database = getDb();
  if (!database) return 0;
  const session = database.getFirstSync<{ total_reps_logged: number }>(
    'SELECT total_reps_logged FROM workout_sessions WHERE session_id = ?;',
    sessionId
  );
  
  const newReps = (session?.total_reps_logged ?? 0) + 1;
  
  database.runSync(
    'UPDATE workout_sessions SET total_reps_logged = ? WHERE session_id = ?;',
    newReps,
    sessionId
  );
  
  return newReps;
}

export function updateSessionDuration(sessionId: string, durationSeconds: number) {
  const database = getDb();
  if (database) {
    database.runSync(
      'UPDATE workout_sessions SET active_duration_seconds = ? WHERE session_id = ?;',
      durationSeconds,
      sessionId
    );
  }
}

export interface RepFaults {
  spineRounded: boolean;
  kneeShear: boolean;
  shallowDepth: boolean;
}

export function logRepTelemetry(
  sessionId: string,
  repIndex: number,
  minJointAngle: number,
  formAccuracyScore: number,
  faults: RepFaults
): string {
  const database = getDb();
  const repId = 'rep_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const timestampRecorded = Math.floor(Date.now() / 1000);
  
  if (database) {
    database.runSync(
      `INSERT INTO rep_telemetry (
        rep_id, session_id, rep_index, min_joint_angle, form_accuracy_score, 
        fault_spine_rounded, fault_knee_shear, fault_shallow_depth, timestamp_recorded
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      repId,
      sessionId,
      repIndex,
      minJointAngle,
      formAccuracyScore,
      faults.spineRounded ? 1 : 0,
      faults.kneeShear ? 1 : 0,
      faults.shallowDepth ? 1 : 0,
      timestampRecorded
    );
  }
  
  return repId;
}

export interface WorkoutSession {
  session_id: string;
  user_id: string;
  exercise_key: string;
  total_reps_logged: number;
  active_duration_seconds: number;
  is_synced: number;
  started_at: number;
  username?: string;
}

export function getWorkoutSessionsHistory(limit: number = 20): WorkoutSession[] {
  const database = getDb();
  if (!database) return [];
  return database.getAllSync<WorkoutSession>(
    `SELECT w.*, u.username 
     FROM workout_sessions w 
     LEFT JOIN local_users u ON w.user_id = u.id 
     ORDER BY w.started_at DESC 
     LIMIT ?;`,
    limit
  );
}

export function getSessionTelemetry(sessionId: string) {
  const database = getDb();
  if (!database) return [];
  return database.getAllSync<{
    rep_id: string;
    session_id: string;
    rep_index: number;
    min_joint_angle: number;
    form_accuracy_score: number;
    fault_spine_rounded: number;
    fault_knee_shear: number;
    fault_shallow_depth: number;
    timestamp_recorded: number;
  }>(
    'SELECT * FROM rep_telemetry WHERE session_id = ? ORDER BY rep_index ASC;',
    sessionId
  );
}

export function getUnsyncedSessions(): WorkoutSession[] {
  const database = getDb();
  if (!database) return [];
  return database.getAllSync<WorkoutSession>('SELECT * FROM workout_sessions WHERE is_synced = 0;');
}

export function getUnsyncedTelemetry() {
  const database = getDb();
  if (!database) return [];
  return database.getAllSync<{
    rep_id: string;
    session_id: string;
    rep_index: number;
    min_joint_angle: number;
    form_accuracy_score: number;
    fault_spine_rounded: number;
    fault_knee_shear: number;
    fault_shallow_depth: number;
    timestamp_recorded: number;
  }>(
    `SELECT r.* FROM rep_telemetry r 
     JOIN workout_sessions w ON r.session_id = w.session_id 
     WHERE w.is_synced = 0;`
  );
}

export function markSessionsAsSynced(sessionIds: string[]) {
  if (sessionIds.length === 0) return;

  const database = getDb();
  if (!database) return;
  // Construct placeholders (?, ?, ?)
  const placeholders = sessionIds.map(() => '?').join(',');
  database.runSync(
    `UPDATE workout_sessions SET is_synced = 1 WHERE session_id IN (${placeholders});`,
    ...sessionIds
  );
}

export function saveDownloadedModule(exerciseKey: string, schemaJson: string): void {
  const downloadedAt = Math.floor(Date.now() / 1000);
  const database = getDb();
  if (database) {
    database.runSync(
      'INSERT OR REPLACE INTO downloaded_modules (exercise_key, schema_json, downloaded_at) VALUES (?, ?, ?);',
      exerciseKey,
      schemaJson,
      downloadedAt
    );
  }
}

export function getCachedModule(exerciseKey: string): string | null {
  const database = getDb();
  if (!database) return null;
  
  try {
    const row = database.getFirstSync<{ schema_json: string }>(
      'SELECT schema_json FROM downloaded_modules WHERE exercise_key = ?;',
      exerciseKey
    );
    return row ? row.schema_json : null;
  } catch (err) {
    console.warn("Failed to read cached module from downloaded_modules", err);
    return null;
  }
}

export function deleteCachedModule(exerciseKey: string): void {
  const database = getDb();
  if (database) {
    database.runSync(
      'DELETE FROM downloaded_modules WHERE exercise_key = ?;',
      exerciseKey
    );
  }
}
