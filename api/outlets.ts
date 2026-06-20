import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
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

const DEFAULT_OUTLETS = [
  {
    id: 'outlet-1',
    enabled: true,
    name: "Harino's Main Outlet",
    phone: '+917818958571',
    latitude: 28.011897,
    longitude: 77.675534,
    deliveryRadiusKm: 7,
    freeDeliveryRadiusKm: 3,
    freeDeliveryMinimumOrder: 150,
    minimumOrderIncrementPerKm: 100,
    deliveryChargePerKm: 15,
  },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const db = getFirestore();
    const { action } = req.query as { action?: string };

    if (req.method === 'GET') {
      const snapshot = await db.collection('outlets').get();
      if (snapshot.empty) {
        const batch = db.batch();
        for (const outlet of DEFAULT_OUTLETS) {
          const docRef = db.collection('outlets').doc(outlet.id);
          batch.set(docRef, outlet);
        }
        await batch.commit();
        const seededSnapshot = await db.collection('outlets').get();
        await trackUsage({ reads: snapshot.size + seededSnapshot.size, writes: DEFAULT_OUTLETS.length, otherReads: snapshot.size + seededSnapshot.size });
        res.json({ success: true, outlets: seededSnapshot.docs.map((doc) => doc.data()) });
        return;
      }
      await trackUsage({ reads: snapshot.size, otherReads: snapshot.size });
      res.json({ success: true, outlets: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    if (req.method === 'POST') {
      if (action === 'seed') {
        const outlets = req.body as any[];
        if (!Array.isArray(outlets)) {
          res.status(400).json({ success: false, message: 'Payload must be an array of outlets.' });
          return;
        }
        const batch = db.batch();
        for (const outlet of outlets) {
          const docRef = db.collection('outlets').doc(outlet.id);
          batch.set(docRef, outlet, { merge: true });
        }
        // Update menu version
        const settingsRef = db.collection('settings').doc('app');
        batch.set(settingsRef, { menuVersion: Date.now().toString() }, { merge: true });

        await batch.commit();
        await trackUsage({ writes: outlets.length + 1 });
        res.json({ success: true, count: outlets.length });
        return;
      }

      const outlet = req.body as any;
      if (!outlet.id || !outlet.name) {
        res.status(400).json({ success: false, message: 'Invalid outlet payload.' });
        return;
      }
      await db.collection('outlets').doc(outlet.id).set(outlet, { merge: true });
      await db.collection('settings').doc('app').set({ menuVersion: Date.now().toString() }, { merge: true });
      await trackUsage({ writes: 2 });
      res.json({ success: true });
      return;
    }

    if (req.method === 'DELETE') {
      const { outletId } = req.query as { outletId?: string };
      if (!outletId) {
        res.status(400).json({ success: false, message: 'Missing outletId parameter.' });
        return;
      }
      await db.collection('outlets').doc(decodeURIComponent(outletId)).delete();
      await db.collection('settings').doc('app').set({ menuVersion: Date.now().toString() }, { merge: true });
      await trackUsage({ writes: 1, deletes: 1 });
      res.json({ success: true });
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
