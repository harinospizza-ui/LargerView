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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { customerId, action } = req.query as { customerId?: string; action?: string };

  try {
    const db = getFirestore();

    // 1. PATCH verification (/api/customers/:customerId/verify)
    if (req.method === 'PATCH' && customerId && action === 'verify') {
      const docRef = db.collection('customers').doc(decodeURIComponent(customerId));
      const snap = await docRef.get();
      if (!snap.exists) {
        res.status(404).json({ success: false, message: 'Customer not found.' });
        return;
      }
      const customerData = snap.data() as any;

      const allCustomersSnap = await db.collection('customers').where('verified', '==', true).get();
      const cleanPhone = (p: string) => p.replace(/\D/g, '');
      const targetPhone = cleanPhone(customerData.phone);
      const alreadyVerified = allCustomersSnap.docs.some((docDoc) => {
        const data = docDoc.data() as any;
        return data.id !== customerId && data.phone && cleanPhone(data.phone) === targetPhone;
      });

      if (alreadyVerified) {
        res.status(400).json({ success: false, message: 'This phone number is already verified under another profile.' });
        return;
      }

      const generateReferralCode = () => {
        return Math.floor(65536 + Math.random() * 983039).toString(16).toUpperCase();
      };
      const referralCode = customerData.referralCode ?? generateReferralCode();

      const customer = { ...customerData, verified: true, referralCode };
      await docRef.set(customer, { merge: true });
      res.json({ success: true, customer });
      return;
    }

    // 2. GET all customers (/api/customers)
    if (req.method === 'GET') {
      const snapshot = await db.collection('customers').limit(500).get();
      const list = snapshot.docs.map((doc) => doc.data() as any);
      list.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      });
      res.json({ success: true, customers: list });
      return;
    }

    // 3. POST save customer (/api/customers)
    if (req.method === 'POST') {
      const profile = req.body as any;
      if (!profile.id || !profile.name || !profile.phone) {
        res.status(400).json({ success: false, message: 'Invalid customer profile.' });
        return;
      }

      await db.collection('customers').doc(profile.id).set(profile, { merge: true });
      res.status(201).json({ success: true, customer: profile });
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
