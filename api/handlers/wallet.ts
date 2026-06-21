import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import { verifyToken } from './cryptoUtils.js';
import { trackUsage } from './firestoreUsage.js';
import { validateSession } from './sessionUtils.js';

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

const authenticateRequest = (req: VercelRequest): any => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  return verifyToken(token, getJWTSecret());
};

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

    const sessionCheck = await validateSession(req, res, db);
    if (!sessionCheck.success) return;

    if (req.method === 'GET') {
      const caller = authenticateRequest(req);
      if (!caller) {
        res.status(401).json({ success: false, message: 'Unauthorized.' });
        return;
      }
      if (caller.role !== 'admin' && caller.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Forbidden.' });
        return;
      }
      const snapshot = await db.collection('wallet_transactions').orderBy('createdAt', 'desc').get();
      await trackUsage({ reads: snapshot.size, walletReads: snapshot.size });
      res.json({ success: true, transactions: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    if (req.method === 'POST') {
      const transaction = req.body as any;
      if (!transaction.id || !transaction.customerId || typeof transaction.amount !== 'number') {
        res.status(400).json({ success: false, message: 'Invalid transaction payload.' });
        return;
      }

      // Check if the customer is blocked
      const customerDocRef = db.collection('customers').doc(transaction.customerId);
      const customerSnap = await customerDocRef.get();
      if (!customerSnap.exists) {
        res.status(404).json({ success: false, message: 'Customer not found.' });
        return;
      }
      const customerData = customerSnap.data() as any;
      if (customerData.status === 'blocked') {
        res.status(403).json({ success: false, message: 'Forbidden. Blocked customer cannot perform wallet transactions.' });
        return;
      }

      const caller = authenticateRequest(req);
      const isStaff = caller && (caller.role === 'admin' || caller.role === 'manager');

      // Check if this is a pending top-up request
      const isPendingTopUp = transaction.status === 'pending' && transaction.type === 'topup';

      if (!isPendingTopUp && !isStaff) {
        res.status(403).json({ success: false, message: 'Forbidden. Admin or Manager role required to modify transactions.' });
        return;
      }

      const txRef = db.collection('wallet_transactions').doc(transaction.id);
      const txSnap = await txRef.get();
      
      const previousTx = txSnap.exists ? txSnap.data() : null;
      const wasCompleted = previousTx && previousTx.status === 'completed';
      const isCompletingNow = transaction.status === 'completed' && !wasCompleted;

      if (isCompletingNow) {
        // Run a firestore transaction to atomically update balance and status
        await db.runTransaction(async (dbTx) => {
          const customerSnapForUpdate = await dbTx.get(customerDocRef);
          if (!customerSnapForUpdate.exists) {
            throw new Error('Customer not found during transaction balance update.');
          }
          const currentCustomerData = customerSnapForUpdate.data() as any;
          
          if (currentCustomerData.status === 'blocked') {
            throw new Error('Blocked customer cannot be recharged.');
          }

          const currentBalance = currentCustomerData.walletBalance || 0;
          const newBalance = currentBalance + (transaction.amount || 0);

          dbTx.update(customerDocRef, { walletBalance: newBalance });
          dbTx.set(txRef, transaction, { merge: true });
        });
        
        await trackUsage({ reads: 3, writes: 2, walletReads: 1 });
        res.json({ success: true, message: 'Transaction completed and balance updated.' });
        return;
      }

      // Just save/update the transaction (not completing balance update, e.g. saving pending topup or rejecting)
      await txRef.set(transaction, { merge: true });
      await trackUsage({ reads: 2, writes: 1, walletReads: 1 });
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
