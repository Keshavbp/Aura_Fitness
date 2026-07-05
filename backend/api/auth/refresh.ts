import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyRefreshToken, generateAccessToken, setCorsHeaders } from '../../utils/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res, 'POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { refreshToken } = req.body || {};

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required.' });
  }

  const payload = verifyRefreshToken(refreshToken);

  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired refresh token.' });
  }

  // Generate new Access Token
  // In a production app, we would query the database to determine the user's active role.
  // We'll default to 'athlete' unless the user is the seeded admin.
  const role = payload.userId === 'usr_admin_id' ? 'admin' : 'athlete';
  const newAccessToken = generateAccessToken(payload.userId, role);

  // Set HTTP-Only Cookie
  res.setHeader(
    'Set-Cookie',
    `access_token=${newAccessToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`
  );

  return res.status(200).json({
    accessToken: newAccessToken
  });
}
