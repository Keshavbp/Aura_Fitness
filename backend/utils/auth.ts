import type { VercelResponse } from '@vercel/node';
import jwt from 'jsonwebtoken';

// Keys - In production, Vercel Env variables will override these defaults
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'aura-jwt-access-secret-key-12345';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'aura-jwt-refresh-secret-key-67890';

export interface UserTokenPayload {
  userId: string;
  role: string;
}

/**
 * Generates an Access Token with 15 minutes expiration
 */
export function generateAccessToken(userId: string, role: string = 'athlete'): string {
  return jwt.sign({ userId, role }, JWT_ACCESS_SECRET, { expiresIn: '15m' });
}

/**
 * Generates a Refresh Token with 7 days expiration
 */
export function generateRefreshToken(userId: string): string {
  return jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
}

/**
 * Verifies an Access Token and returns the payload, or null if invalid
 */
export function verifyAccessToken(token: string): UserTokenPayload | null {
  try {
    return jwt.verify(token, JWT_ACCESS_SECRET) as UserTokenPayload;
  } catch (err) {
    return null;
  }
}

/**
 * Verifies a Refresh Token and returns the payload, or null if invalid
 */
export function verifyRefreshToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET) as { userId: string };
  } catch (err) {
    return null;
  }
}

/**
 * Sets standard security CORS headers for preflight and standard requests
 */
export function setCorsHeaders(res: VercelResponse, methods: string = 'GET,POST,OPTIONS') {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-api-key, x-admin-login-pin'
  );
}

/**
 * Extract token from Authorization header or Cookie
 */
export function extractToken(headers: any): string | null {
  // 1. Check Authorization Bearer header
  const authHeader = headers['authorization'];
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.substring(7);
  }

  // 2. Check x-api-key custom header
  const apiKeyHeader = headers['x-api-key'];
  if (apiKeyHeader) {
    return apiKeyHeader;
  }

  // 3. Check Cookie headers
  const cookieHeader = headers['cookie'];
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc: any, curr: string) => {
      const parts = curr.split('=');
      acc[parts[0].trim()] = (parts[1] || '').trim();
      return acc;
    }, {});
    return cookies['access_token'] || null;
  }

  return null;
}

/**
 * Validates incoming telemetry joint angles to prevent database insertion spamming or out-of-bounds anomalies
 */
export function validateRepAngle(angle: number): boolean {
  return typeof angle === 'number' && !isNaN(angle) && angle >= 0 && angle <= 180;
}

/**
 * Validates form accuracy score ranges
 */
export function validateFormScore(score: number): boolean {
  return typeof score === 'number' && !isNaN(score) && score >= 0 && score <= 100;
}
