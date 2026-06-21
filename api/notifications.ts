import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import { validateSession } from './sessionUtils.js';
import { trackUsage } from './firestoreUsage.js';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Session-Id');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const db = getFirestore();
    const { action } = req.query as { action?: string };

    // 1. GET dashboard statistics
    if (req.method === 'GET' && action === 'dashboard') {
      const sessionCheck = await validateSession(req, res, db);
      if (!sessionCheck.success) return;
      
      const caller = sessionCheck.caller;
      if (!caller || caller.role !== 'admin') {
        res.status(403).json({ success: false, message: 'Forbidden. Admin access required.' });
        return;
      }

      // Fetch total registered devices
      const tokensSnap = await db.collection('notification_tokens').get();
      const totalDevices = tokensSnap.size;

      // Fetch notification stats
      const statsSnap = await db.collection('notification_stats')
        .orderBy('updatedAt', 'desc')
        .limit(30)
        .get();

      const stats = statsSnap.docs.map(doc => ({
        date: doc.id,
        sent: doc.data().sent || 0,
        failed: doc.data().failed || 0,
        removedTokens: doc.data().removedTokens || 0,
        updatedAt: doc.data().updatedAt || ''
      }));

      await trackUsage({ reads: 1 + statsSnap.size + tokensSnap.size });

      res.json({
        success: true,
        totalDevices,
        stats
      });
      return;
    }

    // 2. POST register token
    if (req.method === 'POST') {
      const payload = req.body as any;
      if (!payload.fcmToken || !payload.role || !payload.userId || !payload.deviceInfo) {
        res.status(400).json({
          success: false,
          message: 'Missing required fields: fcmToken, role, userId, deviceInfo',
        });
        return;
      }

      const validRoles = ['admin', 'manager', 'staff', 'customer'];
      if (!validRoles.includes(payload.role)) {
        res.status(400).json({
          success: false,
          message: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
        });
        return;
      }

      // If registering a staff/manager/admin role, enforce session check
      if (['admin', 'manager', 'staff'].includes(payload.role)) {
        const sessionCheck = await validateSession(req, res, db);
        if (!sessionCheck.success) return;
        
        const caller = sessionCheck.caller;
        if (!caller || caller.username !== payload.userId || caller.role !== payload.role) {
          res.status(403).json({ success: false, message: 'Forbidden. User/Role identity mismatch.' });
          return;
        }
      }

      const tokenHash = payload.fcmToken.substring(0, 16);
      const docId = `${payload.userId}_${tokenHash}`;
      const now = new Date().toISOString();

      await db.collection('notification_tokens').doc(docId).set(
        {
          id: docId,
          userId: payload.userId,
          fcmToken: payload.fcmToken,
          role: payload.role,
          outletId: payload.outletId || null,
          deviceType: 'browser',
          deviceInfo: {
            userAgent: payload.deviceInfo.userAgent || 'Unknown',
            platform: payload.deviceInfo.platform || 'Web',
          },
          isActive: true,
          createdAt: now,
          updatedAt: now,
          lastUsedAt: now,
        },
        { merge: true }
      );

      await trackUsage({ reads: 1, writes: 1 });

      res.status(201).json({
        success: true,
        message: 'Token registered successfully',
        tokenId: docId,
      });
      return;
    }

    res.status(405).json({ success: false, message: 'Method not allowed' });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error.',
    });
  }
}
