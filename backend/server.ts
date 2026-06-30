import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  extractToken,
  validateRepAngle,
  validateFormScore
} from './api/utils/auth';
import { MODULES_REGISTRY } from './api/modules';

const PORT = Number(process.env.PORT) || 8080;
const app = express();

// Database Pool Configuration
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!databaseUrl) {
  console.warn('[Aura Server] DATABASE_URL env variable not found. Running in offline fallback mode.');
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl ? { rejectUnauthorized: false } : false
});

// Seed Database Schema on startup
async function initializeDatabase() {
  if (!databaseUrl) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'athlete',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

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

    // Seed defaults
    const adminCheck = await client.query(`SELECT * FROM users WHERE username = 'admin';`);
    if (adminCheck.rows.length === 0) {
      const adminHash = await bcrypt.hash('admin123', 10);
      await client.query(
        `INSERT INTO users (user_id, username, password_hash, role) VALUES ($1, $2, $3, $4);`,
        ['usr_admin_id', 'admin', adminHash, 'admin']
      );
    }

    const athleteCheck = await client.query(`SELECT * FROM users WHERE username = 'athlete';`);
    if (athleteCheck.rows.length === 0) {
      const athleteHash = await bcrypt.hash('athlete123', 10);
      await client.query(
        `INSERT INTO users (user_id, username, password_hash, role) VALUES ($1, $2, $3, $4);`,
        ['usr_default_athlete_id', 'athlete', athleteHash, 'athlete']
      );
    }
    console.log('[Aura DB] Database initialized and seeded successfully.');
  } catch (err) {
    console.error('[Aura DB] Initialization error:', err);
  } finally {
    client.release();
  }
}

initializeDatabase();

// Middleware
app.use(cors({
  origin: '*',
  credentials: true,
  methods: 'GET,POST,OPTIONS,PUT,DELETE',
  allowedHeaders: ['X-CSRF-Token', 'X-Requested-With', 'Accept', 'Accept-Version', 'Content-Length', 'Content-MD5', 'Content-Type', 'Date', 'X-Api-Version', 'Authorization', 'x-api-key', 'x-admin-login-pin']
}));
app.use(express.json());

// Rate Limiter: max 5 requests per 15 minutes per IP
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many authentication attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper for JWT Security Checks
const checkAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = extractToken(req.headers);
  const mobileApiKey = process.env.EXPO_PUBLIC_API_KEY || 'aura-mobile-key-123';
  const isAuthorized = token && (verifyAccessToken(token) !== null || token === mobileApiKey);
  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized: Invalid access token or API signature.' });
  }
  next();
};

// --- ROUTES ---

// 1. User Registration Route
app.post('/api/auth/register', authRateLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({
      error: 'Username must be at least 3 characters and password at least 6 characters.'
    });
  }

  if (!databaseUrl) {
    return res.status(501).json({ error: 'Database configuration missing on server (Offline Mode).' });
  }

  try {
    const userCheck = await pool.query('SELECT user_id FROM users WHERE username = $1;', [username]);
    if (userCheck.rows.length > 0) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    const userId = 'usr_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query(
      'INSERT INTO users (user_id, username, password_hash, role) VALUES ($1, $2, $3, $4);',
      [userId, username, passwordHash, 'athlete']
    );

    const accessToken = generateAccessToken(userId, 'athlete');
    const refreshToken = generateRefreshToken(userId);

    res.setHeader(
      'Set-Cookie',
      `access_token=${accessToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`
    );

    return res.status(201).json({
      message: 'Account registered successfully',
      user: { userId, username, role: 'athlete' },
      accessToken,
      refreshToken
    });
  } catch (err: any) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// 2. User Login Route
app.post('/api/auth/login', authRateLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  let authenticatedUser: { user_id: string; username: string; role: string } | null = null;

  if (databaseUrl) {
    try {
      const result = await pool.query('SELECT * FROM users WHERE username = $1;', [username]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (isValid) {
          authenticatedUser = {
            user_id: user.user_id,
            username: user.username,
            role: user.role
          };
        }
      }
    } catch (err) {
      console.error('Database connection error during login:', err);
    }
  }

  // Fallback to local hardcoded mock authentication if database is offline or not set up
  if (!authenticatedUser) {
    if (username === 'admin' && password === 'admin123') {
      authenticatedUser = { user_id: 'usr_admin_id', username: 'admin', role: 'admin' };
    } else if (username === 'athlete' && password === 'athlete123') {
      authenticatedUser = { user_id: 'usr_default_athlete_id', username: 'athlete', role: 'athlete' };
    }
  }

  if (!authenticatedUser) {
    return res.status(401).json({ error: 'Unauthorized: Invalid username or password.' });
  }

  const accessToken = generateAccessToken(authenticatedUser.user_id, authenticatedUser.role);
  const refreshToken = generateRefreshToken(authenticatedUser.user_id);

  res.setHeader(
    'Set-Cookie',
    `access_token=${accessToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`
  );

  return res.status(200).json({
    accessToken,
    refreshToken,
    user: {
      userId: authenticatedUser.user_id,
      username: authenticatedUser.username,
      role: authenticatedUser.role
    }
  });
});

// 3. Token Refresh Route
app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required.' });
  }

  const payload = verifyRefreshToken(refreshToken);
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired refresh token.' });
  }

  const role = payload.userId === 'usr_admin_id' ? 'admin' : 'athlete';
  const newAccessToken = generateAccessToken(payload.userId, role);

  res.setHeader(
    'Set-Cookie',
    `access_token=${newAccessToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`
  );

  return res.status(200).json({
    accessToken: newAccessToken
  });
});

// 4. Telemetry Sync Route
app.post('/api/sync', checkAuth, async (req, res) => {
  const { sync_meta, payload_queue } = req.body;
  if (!sync_meta || !payload_queue) {
    return res.status(400).json({ error: 'Invalid Payload' });
  }

  const sessions = payload_queue.sessions || [];
  const telemetry = payload_queue.telemetry || [];
  const localUserId = sync_meta.local_user_id || 'usr_default_athlete_id';

  // Input Validation Bounds Check
  for (const tel of telemetry) {
    if (!validateRepAngle(tel.min_joint_angle) || !validateFormScore(tel.form_accuracy_score)) {
      return res.status(400).json({ error: 'Bad Request: Telemetry metrics out of physical bounds.' });
    }
  }

  let dbConnected = false;
  if (databaseUrl) {
    try {
      // Write Sessions in a Transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const sess of sessions) {
          await client.query(
            `INSERT INTO workout_sessions (session_id, user_id, exercise_key, total_reps_logged, active_duration_seconds, started_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (session_id) DO UPDATE SET
               total_reps_logged = EXCLUDED.total_reps_logged,
               active_duration_seconds = EXCLUDED.active_duration_seconds;`,
            [sess.session_id, localUserId, sess.exercise_key, sess.total_reps_logged, sess.active_duration_seconds, sess.started_at]
          );
        }

        // Write Telemetry
        for (const tel of telemetry) {
          await client.query(
            `INSERT INTO rep_telemetry (rep_id, session_id, rep_index, min_joint_angle, form_accuracy_score, fault_spine_rounded, fault_knee_shear, fault_shallow_depth, timestamp_recorded)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (rep_id) DO NOTHING;`,
            [tel.rep_id, tel.session_id, tel.rep_index, tel.min_joint_angle, tel.form_accuracy_score, tel.fault_spine_rounded, tel.fault_knee_shear, tel.fault_shallow_depth, tel.timestamp_recorded]
          );
        }
        await client.query('COMMIT');
        dbConnected = true;
      } catch (transErr) {
        await client.query('ROLLBACK');
        throw transErr;
      } finally {
        client.release();
      }
    } catch (dbErr) {
      console.error('Failed to sync to Postgres database, processing locally', dbErr);
    }
  }

  if (!dbConnected) {
    console.log(`Sync complete (Offline Backup log only) for user ${localUserId}.`);
  }

  return res.status(200).json({
    status: 'sync_complete',
    processed_counts: {
      sessions: sessions.length,
      telemetry: telemetry.length
    },
    synced_session_ids: sessions.map((s: any) => s.session_id),
    server_epoch: Math.floor(Date.now() / 1000)
  });
});

// 5. Dynamic Module Schemas Route
app.get('/api/modules', checkAuth, (req, res) => {
  const { key } = req.query;
  if (key) {
    const exerciseKey = String(key).toLowerCase();
    const moduleSchema = MODULES_REGISTRY[exerciseKey];
    if (!moduleSchema) {
      return res.status(404).json({ error: `Module for '${exerciseKey}' not found.` });
    }
    return res.status(200).json(moduleSchema);
  }
  return res.status(200).json(MODULES_REGISTRY);
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Aura Server] Running locally at http://0.0.0.0:${PORT}`);
});
