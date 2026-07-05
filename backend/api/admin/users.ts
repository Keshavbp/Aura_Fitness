import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'pg';

interface UserRecord {
  username: string;
  email: string | null;
}

const MOCK_USERS: UserRecord[] = [
  { username: 'FlexMaster', email: 'flex@aura.fit' },
  { username: 'SquatQueen', email: 'squat@aura.fit' },
  { username: 'IronBeast', email: 'iron@aura.fit' },
  { username: 'GymBro99', email: 'gymbro99@gmail.com' },
  { username: 'AuraFit_Jess', email: 'jess@aura.fit' }
];

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
    return res.status(401).json({ error: 'Unauthorized: Invalid Admin Login PIN.' });
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  let finalUsers = [...MOCK_USERS];

  if (databaseUrl) {
    const client = new Client({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }
    });

    try {
      await client.connect();

      // Ensure users table exists with migration column
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
        ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
      `);

      // Fetch username and email
      const result = await client.query(`
        SELECT username, email FROM users ORDER BY created_at DESC LIMIT 200;
      `);

      finalUsers = result.rows.map(row => ({
        username: row.username === 'You (Local Athlete)' ? 'admin' : row.username,
        email: row.email
      }));
    } catch (err: any) {
      console.error('Database query error in admin/users handler', err);
      // Fallback to mock data in case of DB connection errors
    } finally {
      await client.end();
    }
  }

  return res.status(200).json({ users: finalUsers });
}
