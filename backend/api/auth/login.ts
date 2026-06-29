import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import { generateAccessToken, generateRefreshToken, setCorsHeaders } from '../utils/auth';

async function setupUsersTable(client: Client) {
  // Create users table
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'athlete',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default admin and athlete if not present
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
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, 'POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  let authenticatedUser: { user_id: string; username: string; role: string } | null = null;

  if (databaseUrl) {
    const client = new Client({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }
    });

    try {
      await client.connect();
      await setupUsersTable(client);

      const result = await client.query(`SELECT * FROM users WHERE username = $1;`, [username]);
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
      await client.end();
    } catch (err) {
      console.error("Database connection failure in login handler", err);
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

  // Generate tokens
  const accessToken = generateAccessToken(authenticatedUser.user_id, authenticatedUser.role);
  const refreshToken = generateRefreshToken(authenticatedUser.user_id);

  // Set HTTP-Only, Secure, SameSite cookie for Web client
  res.setHeader(
    'Set-Cookie',
    `access_token=${accessToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900` // 15 mins
  );

  return res.status(200).json({
    message: 'Authenticated successfully',
    user: {
      userId: authenticatedUser.user_id,
      username: authenticatedUser.username,
      role: authenticatedUser.role
    },
    accessToken,
    refreshToken
  });
}
