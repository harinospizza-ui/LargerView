import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';

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

const DEFAULT_OFFERS = [
  {
    id: 'offer-card-1',
    enabled: false,
    image: '/images/vegover.jpeg',
    offerTitle: 'Buy any Large Pizza and get a burger free',
    displayText: 'Season Offer.',
    condition: 'Apply on Pizza when selected size price is Rs 299 or more.',
    additionalItem: 'Stuffed Garlic Bread',
    additionalItemImage: '/images/stuffed.jpeg',
    notifyCustomers: true,
  },
  {
    id: 'offer-card-2',
    enabled: false,
    image: '/images/hari.jpeg',
    offerTitle: "New launch: Harino's Special",
    displayText: 'Try our latest limited time dish',
    condition: "Apply on Harino's Special when selected size price is Rs 219 or more.",
    additionalItem: 'Tikka Burger',
    additionalItemImage: '/images/tikkaburgar.jpeg',
    notifyCustomers: true,
  },
  {
    id: 'offer-card-3',
    enabled: false,
    image: '/images/chocolava.jpeg',
    offerTitle: 'Store update or custom announcement',
    displayText: 'Keep this card for info, timings, launch news, bundle highlights, or any message you want to show.',
    condition: 'Display only card. No automatic discount rule.',
    additionalItem: 'Cold Coffee',
    additionalItemImage: '/images/coldcoffee.jpeg',
    notifyCustomers: false,
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
      const snapshot = await db.collection('offers').get();
      if (snapshot.empty) {
        const batch = db.batch();
        for (const offer of DEFAULT_OFFERS) {
          const docRef = db.collection('offers').doc(offer.id);
          batch.set(docRef, offer);
        }
        await batch.commit();
        const seededSnapshot = await db.collection('offers').get();
        res.json({ success: true, offers: seededSnapshot.docs.map((doc) => doc.data()) });
        return;
      }
      res.json({ success: true, offers: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    if (req.method === 'POST') {
      if (action === 'seed') {
        const offers = req.body as any[];
        if (!Array.isArray(offers)) {
          res.status(400).json({ success: false, message: 'Payload must be an array of offers.' });
          return;
        }
        const batch = db.batch();
        for (const offer of offers) {
          const docRef = db.collection('offers').doc(offer.id);
          batch.set(docRef, offer, { merge: true });
        }
        await batch.commit();
        res.json({ success: true, count: offers.length });
        return;
      }

      const offer = req.body as any;
      if (!offer.id || !offer.offerTitle) {
        res.status(400).json({ success: false, message: 'Invalid offer payload.' });
        return;
      }
      await db.collection('offers').doc(offer.id).set(offer, { merge: true });
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
