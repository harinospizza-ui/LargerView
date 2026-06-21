import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import crypto from 'crypto';
import { verifyPassword, hashPassword, generateToken, verifyToken } from './cryptoUtils.js';

const getJWTSecret = (): string => {
  return process.env.JWT_SECRET || 'dev-harinos-pizza-secret-key-32-chars-minimum';
};

const parseServiceAccount = (): admin.ServiceAccount => {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (encoded) {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as admin.ServiceAccount;
  }
  if (raw) {
    return JSON.parse(raw) as admin.ServiceAccount;
  }
  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_BASE64.');
};

const getFirestore = (): admin.firestore.Firestore => {
  if (!admin.apps.length) {
    const serviceAccount = parseServiceAccount();
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || 'harinos-12902',
    });
  }
  return admin.firestore();
};

const logSecurityEvent = async (action: string, username: string, details: string, ip?: string) => {
  const logEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    action,
    username,
    details,
    ip: ip || 'unknown'
  };
  try {
    const db = getFirestore();
    await db.collection('security_logs').doc(logEntry.id).set(logEntry);
  } catch (err) {
    console.error('Failed to log security event:', err);
  }
};

const authenticateRequest = (req: VercelRequest): any => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  return verifyToken(token, getJWTSecret());
};

const DEFAULT_STAFF = [
  { role: 'admin', username: 'Admin_Harinos', password: 'Harinos_Admin', outletId: null },
  { role: 'manager', username: 'Manager_Harinos', password: 'Harinos_Manager', outletId: null },
  { role: 'staff', username: 'Staff_Harinos', password: 'Harinos_Staff', outletId: null },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, message: 'Method not allowed' });
    return;
  }

  const url = new URL(req.url ?? '/', 'https://harinos.local');
  const path = url.pathname.replace(/^\/api\/?/, '/');

  try {
    const db = getFirestore();
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';

    if (path === 'auth/login' || path === '/auth/login') {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username || !password) {
        res.status(400).json({ success: false, message: 'Missing username or password.' });
        return;
      }

      const staffRef = db.collection('users');
      const snapshot = await staffRef.get();
      
      if (snapshot.empty) {
        for (const user of DEFAULT_STAFF) {
          const hashedUser = { ...user, password: hashPassword(user.password) };
          await staffRef.doc(user.username).set(hashedUser);
        }
      }
      
      const userDoc = await staffRef.doc(username).get();
      if (!userDoc.exists) {
        await logSecurityEvent('FAILED_LOGIN', username, 'Non-existent user attempt', clientIp);
        res.status(401).json({ success: false, message: 'Invalid username or password.' });
        return;
      }
      
      const user = userDoc.data() as any;
      if (!verifyPassword(password, user.password)) {
        await logSecurityEvent('FAILED_LOGIN', username, 'Invalid password attempt', clientIp);
        res.status(401).json({ success: false, message: 'Invalid username or password.' });
        return;
      }

      // Auto hash password if stored as plaintext
      if (!user.password.startsWith('pbkdf2$')) {
        const hashed = hashPassword(password);
        await staffRef.doc(username).update({ password: hashed });
        user.password = hashed;
        await logSecurityEvent('PASSWORD_UPGRADED_TO_HASH', username, 'Migrated plaintext password to pbkdf2 hash', clientIp);
      }

      const token = generateToken({ username: user.username, role: user.role, outletId: user.outletId }, getJWTSecret());
      await logSecurityEvent('SUCCESSFUL_LOGIN', username, `Role: ${user.role}`, clientIp);
      
      let firebaseToken = '';
      try {
        firebaseToken = await admin.auth().createCustomToken(user.username);
      } catch (e) {
        console.warn('Failed to generate firebase custom token:', e);
      }
      
      const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const now = new Date().toISOString();

      if (user.role === 'admin' || user.role === 'manager') {
        const docId = user.username;
        const currentSessionSnap = await db.collection('userSessions').doc(docId).get();
        if (currentSessionSnap.exists) {
          const prevSession = currentSessionSnap.data();
          await logSecurityEvent('FORCED_LOGOUT', username, `Session ${prevSession?.sessionId} invalidated by new login on another device`, clientIp);
        }

        await db.collection('userSessions').doc(docId).set({
          sessionId,
          username: user.username,
          role: user.role,
          userAgent: req.headers['user-agent'] || 'Unknown',
          deviceType: 'browser',
          loginTime: now,
          lastActivity: now,
          clientIp
        });

        if (user.role === 'admin') {
          try {
            const tokensSnap = await db.collection('notification_tokens')
              .where('userId', '==', user.username)
              .where('role', '==', 'admin')
              .where('isActive', '==', true)
              .get();
            const tokens = tokensSnap.docs.map(d => d.data());
            const messaging = admin.messaging();
            for (const t of tokens) {
              await messaging.send({
                token: t.fcmToken,
                notification: {
                  title: '🚨 New Admin Login',
                  body: `Your account was logged in from a new device/browser.`
                },
                data: {
                  eventType: 'NEW_LOGIN',
                  username: user.username,
                  timestamp: now
                }
              }).catch(() => {});
            }
          } catch (e) {
            console.warn('Failed to send Admin new-login FCM alert:', e);
          }
        }
      } else {
        const docId = `${user.username}_${sessionId}`;
        await db.collection('userSessions').doc(docId).set({
          sessionId,
          username: user.username,
          role: user.role,
          userAgent: req.headers['user-agent'] || 'Unknown',
          deviceType: 'browser',
          loginTime: now,
          lastActivity: now,
          clientIp
        });
      }

      res.json({
        success: true,
        token,
        sessionId,
        firebaseToken,
        user: { role: user.role, username: user.username, outletId: user.outletId },
      });
      return;
    }

    if (path === 'auth/change-password' || path === '/auth/change-password') {
      const { username, newPassword } = req.body as { username?: string; newPassword?: string };
      if (!username || !newPassword) {
        res.status(400).json({ success: false, message: 'Missing username or new password.' });
        return;
      }

      const caller = authenticateRequest(req);
      if (!caller || (caller.role !== 'admin' && caller.username !== username)) {
        await logSecurityEvent('UNAUTHORIZED_PASSWORD_CHANGE_ATTEMPT', caller?.username || 'anonymous', `Target: ${username}`);
        res.status(403).json({ success: false, message: 'Forbidden. Authorization required.' });
        return;
      }

      const hashed = hashPassword(newPassword);
      const staffRef = db.collection('users');
      const docRef = staffRef.doc(username);
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        res.status(404).json({ success: false, message: 'Staff user not found.' });
        return;
      }
      await docRef.set({ password: hashed }, { merge: true });
      await logSecurityEvent('PASSWORD_CHANGED', caller.username, `Target: ${username}`);
      res.json({ success: true, message: 'Password updated successfully.' });
      return;
    }

    if (path === 'auth/logout' || path === '/auth/logout') {
      const caller = authenticateRequest(req);
      if (!caller) {
        res.status(401).json({ success: false, message: 'Unauthorized. Invalid token.' });
        return;
      }

      const sessionId = req.headers['x-session-id'] as string;
      const username = caller.username;

      let docId = username;
      if (caller.role === 'staff') {
        docId = `${username}_${sessionId || ''}`;
      }

      if (sessionId) {
        await db.collection('userSessions').doc(docId).delete().catch(() => {});
      }

      await logSecurityEvent('SUCCESSFUL_LOGOUT', username, `Role: ${caller.role}`, clientIp);

      res.json({ success: true, message: 'Logged out successfully.' });
      return;
    }

    res.status(404).json({ success: false, message: 'Route not found.' });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error.',
    });
  }
}
