import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import { verifyToken } from './cryptoUtils.js';

const getJWTSecret = (): string => {
  return process.env.JWT_SECRET || 'dev-harinos-pizza-secret-key-32-chars-minimum';
};

export const authenticateRequest = (req: VercelRequest): any => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  return verifyToken(token, getJWTSecret());
};

/**
 * Validates the session of staff/manager/admin.
 * If the user has a staff/manager/admin role, it checks x-session-id.
 * If the session is invalid, returns 401.
 * Updates lastActivity timestamp if valid.
 */
export async function validateSession(
  req: VercelRequest,
  res: VercelResponse,
  db: admin.firestore.Firestore
): Promise<{ success: boolean; caller?: any }> {
  const caller = authenticateRequest(req);
  if (!caller) {
    // If no JWT caller token, let it pass (could be a public route or customer login)
    return { success: true };
  }

  // If role is staff, manager, or admin, validate session
  if (['admin', 'manager', 'staff'].includes(caller.role)) {
    const sessionId = req.headers['x-session-id'] as string;
    if (!sessionId) {
      res.status(401).json({ success: false, message: 'Session ID is missing. Please log in again.' });
      return { success: false };
    }

    const username = caller.username;
    let docId = username;
    if (caller.role === 'staff') {
      docId = `${username}_${sessionId}`;
    }

    try {
      const sessionSnap = await db.collection('userSessions').doc(docId).get();
      if (!sessionSnap.exists) {
        res.status(401).json({ success: false, message: 'Session expired or invalidated. Please log in again.' });
        return { success: false };
      }

      const sessionData = sessionSnap.data();
      if (sessionData?.sessionId !== sessionId) {
        res.status(401).json({ success: false, message: 'Your account was logged in from another device.' });
        return { success: false };
      }

      // Update last activity
      db.collection('userSessions').doc(docId).update({
        lastActivity: new Date().toISOString()
      }).catch(err => console.warn('Failed to update lastActivity:', err));

      return { success: true, caller };
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Session validation error.' });
      return { success: false };
    }
  }

  return { success: true, caller };
}
