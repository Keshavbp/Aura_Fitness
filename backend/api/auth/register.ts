import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import { generateAccessToken, generateRefreshToken, setCorsHeaders } from '../utils/auth';
import { sendWelcomeEmail } from '../utils/email';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, 'POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { username, password, email } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({
      error: 'Username must be at least 3 characters and password at least 6 characters.'
    });
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!databaseUrl) {
    return res.status(500).json({ error: 'Database configuration missing on server.' });
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    // Ensure the users table exists (safeguard)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'athlete',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure the email column exists (migration)
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    `);

    // Check if username is already taken
    const userCheck = await client.query(`SELECT user_id FROM users WHERE username = $1;`, [username]);
    if (userCheck.rows.length > 0) {
      await client.end();
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    // Insert user
    const userId = 'usr_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    const passwordHash = await bcrypt.hash(password, 10);

    await client.query(
      `INSERT INTO users (user_id, username, email, password_hash, role) VALUES ($1, $2, $3, $4, $5);`,
      [userId, username, email || null, passwordHash, 'athlete']
    );

    await client.end();

    // Send mock welcome email
    if (email) {
      try {
        sendWelcomeEmail(username, email);
      } catch (mailErr) {
        console.error('Failed to send mock welcome email:', mailErr);
      }
    }

    // Generate JWTs
    const accessToken = generateAccessToken(userId, 'athlete');
    const refreshToken = generateRefreshToken(userId);

    // Set cookie for web portal
    res.setHeader(
      'Set-Cookie',
      `access_token=${accessToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`
    );

    return res.status(201).json({
      message: 'Account registered successfully',
      user: {
        userId,
        username,
        role: 'athlete'
      },
      accessToken,
      refreshToken
    });

  } catch (err: any) {
    console.error('Database error in signup handler', err);
    try { await client.end(); } catch (e) {}
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
}
