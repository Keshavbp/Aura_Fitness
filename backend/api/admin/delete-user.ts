import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'pg';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-admin-login-pin'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Security Check: Verify x-admin-login-pin header
  const adminKey = process.env.ADMIN_LOGIN_PIN || 'admin123';
  const incomingKey = req.headers['x-admin-login-pin'];

  if (incomingKey !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid Admin PIN.' });
  }

  const { username } = req.body || {};
  if (!username) {
    return res.status(400).json({ error: 'Username is required.' });
  }

  if (username === 'admin' || username === 'You (Local Athlete)') {
    return res.status(403).json({ error: 'Forbidden: Cannot delete the admin system account.' });
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

    // 1. Get the user_id
    const userResult = await client.query(`SELECT user_id FROM users WHERE username = $1;`, [username]);
    if (userResult.rows.length === 0) {
      await client.end();
      return res.status(404).json({ error: `User '${username}' not found.` });
    }
    const userId = userResult.rows[0].user_id;

    // Begin transaction
    await client.query('BEGIN');

    // 2. Delete workout sessions (Cascade deletes rep_telemetry automatically)
    await client.query(`DELETE FROM workout_sessions WHERE user_id = $1;`, [userId]);

    // 3. Delete user account
    await client.query(`DELETE FROM users WHERE username = $1;`, [username]);

    await client.query('COMMIT');
    await client.end();

    return res.status(200).json({ success: true, message: `User '${username}' and all associated telemetry deleted successfully.` });
  } catch (err: any) {
    console.error('Database transaction error in delete-user handler', err);
    try {
      await client.query('ROLLBACK');
    } catch (e) {}
    try {
      await client.end();
    } catch (e) {}
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
}
