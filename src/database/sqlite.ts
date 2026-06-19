import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export function getDb() {
  if (Platform.OS === 'web') {
    return null;
  }
  if (!db) {
    db = SQLite.openDatabaseSync('aura_fitness.db');
  }
  return db;
}

export function initDb() {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (!localStorage.getItem('aura_users')) {
        localStorage.setItem('aura_users', JSON.stringify([{
          id: 'usr_default_athlete_id',
          username: 'gym_bro_default',
          role_profile: 'athlete',
          created_at: Math.floor(Date.now() / 1000)
        }]));
      }
      if (!localStorage.getItem('aura_sessions')) {
        localStorage.setItem('aura_sessions', JSON.stringify([]));
      }
      if (!localStorage.getItem('aura_telemetry')) {
        localStorage.setItem('aura_telemetry', JSON.stringify([]));
      }
      if (!localStorage.getItem('aura_downloaded_modules')) {
        localStorage.setItem('aura_downloaded_modules', JSON.stringify({}));
      }
    }
    return;
  }

  const database = getDb();
  if (!database) return;
  
  // Enable foreign keys
  database.execSync('PRAGMA foreign_keys = ON;');

  // Create local_users table
  database.execSync(`
    CREATE TABLE IF NOT EXISTS local_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      auth_token TEXT,
      role_profile TEXT DEFAULT 'athlete',
      created_at INTEGER NOT NULL
    );
  `);

  // Create workout_sessions table
  database.execSync(`
    CREATE TABLE IF NOT EXISTS workout_sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT,
      exercise_key TEXT NOT NULL,
      total_reps_logged INTEGER DEFAULT 0,
      active_duration_seconds INTEGER DEFAULT 0,
      is_synced INTEGER DEFAULT 0,
      started_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES local_users(id) ON DELETE SET NULL
    );
  `);

  // Create rep_telemetry table
  database.execSync(`
    CREATE TABLE IF NOT EXISTS rep_telemetry (
      rep_id TEXT PRIMARY KEY,
      session_id TEXT,
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

  // Create downloaded_modules table
  database.execSync(`
    CREATE TABLE IF NOT EXISTS downloaded_modules (
      exercise_key TEXT PRIMARY KEY,
      schema_json TEXT NOT NULL,
      downloaded_at INTEGER NOT NULL
    );
  `);

  // Seed default user if none exists
  const users = database.getAllSync<{ id: string }>('SELECT id FROM local_users LIMIT 1;');
  if (users.length === 0) {
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
  if (Platform.OS === 'web') {
    const id = 'usr_' + Math.random().toString(36).substring(2, 15);
    const users = JSON.parse(localStorage.getItem('aura_users') || '[]');
    const newUser = { id, username, role_profile: 'athlete', created_at: Math.floor(Date.now() / 1000) };
    users.push(newUser);
    localStorage.setItem('aura_users', JSON.stringify(users));
    return { id, username };
  }

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
  if (Platform.OS === 'web') {
    return JSON.parse(localStorage.getItem('aura_users') || '[]');
  }

  const database = getDb();
  return database ? database.getAllSync<{ id: string; username: string; role_profile: string }>('SELECT * FROM local_users;') : [];
}

export function startWorkoutSession(userId: string, exerciseKey: string): string {
  if (Platform.OS === 'web') {
    const sessionId = 'sess_' + Math.random().toString(36).substring(2, 15);
    const startedAt = Math.floor(Date.now() / 1000);
    const sessions = JSON.parse(localStorage.getItem('aura_sessions') || '[]');
    sessions.push({
      session_id: sessionId,
      user_id: userId,
      exercise_key: exerciseKey,
      total_reps_logged: 0,
      active_duration_seconds: 0,
      is_synced: 0,
      started_at: startedAt
    });
    localStorage.setItem('aura_sessions', JSON.stringify(sessions));
    return sessionId;
  }

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
  if (Platform.OS === 'web') {
    const sessions = JSON.parse(localStorage.getItem('aura_sessions') || '[]');
    const session = sessions.find((s: any) => s.session_id === sessionId);
    if (session) {
      session.total_reps_logged = (session.total_reps_logged ?? 0) + 1;
      localStorage.setItem('aura_sessions', JSON.stringify(sessions));
      return session.total_reps_logged;
    }
    return 0;
  }

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
  if (Platform.OS === 'web') {
    const sessions = JSON.parse(localStorage.getItem('aura_sessions') || '[]');
    const session = sessions.find((s: any) => s.session_id === sessionId);
    if (session) {
      session.active_duration_seconds = durationSeconds;
      localStorage.setItem('aura_sessions', JSON.stringify(sessions));
    }
    return;
  }

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
  if (Platform.OS === 'web') {
    const repId = 'rep_' + Math.random().toString(36).substring(2, 15);
    const timestampRecorded = Math.floor(Date.now() / 1000);
    const telemetry = JSON.parse(localStorage.getItem('aura_telemetry') || '[]');
    telemetry.push({
      rep_id: repId,
      session_id: sessionId,
      rep_index: repIndex,
      min_joint_angle: minJointAngle,
      form_accuracy_score: formAccuracyScore,
      fault_spine_rounded: faults.spineRounded ? 1 : 0,
      fault_knee_shear: faults.kneeShear ? 1 : 0,
      fault_shallow_depth: faults.shallowDepth ? 1 : 0,
      timestamp_recorded: timestampRecorded
    });
    localStorage.setItem('aura_telemetry', JSON.stringify(telemetry));
    return repId;
  }

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
  if (Platform.OS === 'web') {
    const sessions = JSON.parse(localStorage.getItem('aura_sessions') || '[]');
    const users = JSON.parse(localStorage.getItem('aura_users') || '[]');
    const result = sessions.map((s: any) => {
      const user = users.find((u: any) => u.id === s.user_id);
      return {
        ...s,
        username: user ? user.username : 'gym_bro_default'
      };
    });
    return result.sort((a: any, b: any) => b.started_at - a.started_at).slice(0, limit);
  }

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
  if (Platform.OS === 'web') {
    const telemetry = JSON.parse(localStorage.getItem('aura_telemetry') || '[]');
    return telemetry
      .filter((t: any) => t.session_id === sessionId)
      .sort((a: any, b: any) => a.rep_index - b.rep_index);
  }

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

// Synchronization helpers
export function getUnsyncedSessions(): WorkoutSession[] {
  if (Platform.OS === 'web') {
    const sessions = JSON.parse(localStorage.getItem('aura_sessions') || '[]');
    return sessions.filter((s: any) => s.is_synced === 0);
  }

  const database = getDb();
  if (!database) return [];
  return database.getAllSync<WorkoutSession>('SELECT * FROM workout_sessions WHERE is_synced = 0;');
}

export function getUnsyncedTelemetry() {
  if (Platform.OS === 'web') {
    const sessions = JSON.parse(localStorage.getItem('aura_sessions') || '[]');
    const telemetry = JSON.parse(localStorage.getItem('aura_telemetry') || '[]');
    const unsyncedSessionIds = new Set(sessions.filter((s: any) => s.is_synced === 0).map((s: any) => s.session_id));
    return telemetry.filter((t: any) => unsyncedSessionIds.has(t.session_id));
  }

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
  if (Platform.OS === 'web') {
    const sessions = JSON.parse(localStorage.getItem('aura_sessions') || '[]');
    sessions.forEach((s: any) => {
      if (sessionIds.includes(s.session_id)) {
        s.is_synced = 1;
      }
    });
    localStorage.setItem('aura_sessions', JSON.stringify(sessions));
    return;
  }

  const database = getDb();
  if (!database) return;
  // Construct placeholders (?, ?, ?)
  const placeholders = sessionIds.map(() => '?').join(',');
  database.runSync(
    `UPDATE workout_sessions SET is_synced = 1 WHERE session_id IN (${placeholders});`,
    ...sessionIds
  );
}

// Caching operations for downloaded exercise modules
export function saveDownloadedModule(exerciseKey: string, schemaJson: string): void {
  const downloadedAt = Math.floor(Date.now() / 1000);
  
  if (Platform.OS === 'web') {
    const modules = JSON.parse(localStorage.getItem('aura_downloaded_modules') || '{}');
    modules[exerciseKey] = {
      schema_json: schemaJson,
      downloaded_at: downloadedAt
    };
    localStorage.setItem('aura_downloaded_modules', JSON.stringify(modules));
    return;
  }

  const database = getDb();
  if (database) {
    // SQLite upsert or replace
    database.runSync(
      'INSERT OR REPLACE INTO downloaded_modules (exercise_key, schema_json, downloaded_at) VALUES (?, ?, ?);',
      exerciseKey,
      schemaJson,
      downloadedAt
    );
  }
}

export function getCachedModule(exerciseKey: string): string | null {
  if (Platform.OS === 'web') {
    const modules = JSON.parse(localStorage.getItem('aura_downloaded_modules') || '{}');
    return modules[exerciseKey] ? modules[exerciseKey].schema_json : null;
  }

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
  if (Platform.OS === 'web') {
    const modules = JSON.parse(localStorage.getItem('aura_downloaded_modules') || '{}');
    delete modules[exerciseKey];
    localStorage.setItem('aura_downloaded_modules', JSON.stringify(modules));
    return;
  }

  const database = getDb();
  if (database) {
    database.runSync(
      'DELETE FROM downloaded_modules WHERE exercise_key = ?;',
      exerciseKey
    );
  }
}
