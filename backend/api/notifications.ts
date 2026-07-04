import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Client } from 'pg';
import { verifyAccessToken, extractToken, setCorsHeaders } from './utils/auth';

async function ensureNotificationsTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const client = new Client({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await ensureNotificationsTable(client);

    if (req.method === 'GET') {
      // Public GET: return all notifications sorted by newest first
      const result = await client.query(
        'SELECT id, message, created_at FROM notifications ORDER BY created_at DESC LIMIT 50'
      );

      return res.status(200).json({
        notifications: result.rows.map((row) => ({
          id: row.id,
          message: row.message,
          created_at: row.created_at,
        })),
      });
    }

    if (req.method === 'POST') {
      // Admin-only POST: create a new notification broadcast
      const token = extractToken(req.headers);
      const payload = token ? verifyAccessToken(token) : null;

      // Only allow admin role
      if (!payload || payload.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Admin access required.' });
      }

      const { message } = req.body;

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: 'Message is required.' });
      }

      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      await client.query(
        'INSERT INTO notifications (id, message) VALUES ($1, $2)',
        [notifId, message.trim()]
      );

      return res.status(201).json({
        success: true,
        notification: {
          id: notifId,
          message: message.trim(),
          created_at: new Date().toISOString(),
        },
      });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err: any) {
    console.error('Notifications API Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  } finally {
    await client.end();
  }
}
