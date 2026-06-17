import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';

type OrderStatus = 'new' | 'preparing' | 'ready' | 'out_for_delivery' | 'done' | 'cancelled';

type CustomerProfile = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  loginMethod: 'email' | 'phone';
  verified?: boolean;
  createdAt: string;
};

type OrderPayload = {
  id: string;
  items: unknown[];
  total: number;
  date: string;
  receivedAt?: string;
  status?: OrderStatus;
  [key: string]: unknown;
};

type AdminRole = 'admin' | 'manager' | 'staff';

type AdminUser = {
  role: AdminRole;
  username: string;
  password: string;
  outletId: string | null;
};

type SizeOption = {
  label: string;
  price: number;
};

type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  image: string;
  popular?: boolean;
  spicy?: boolean;
  vegetarian: boolean;
  available: boolean;
  sizes?: SizeOption[];
};

type OfferCard = {
  id: string;
  enabled: boolean;
  image: string;
  offerTitle: string;
  displayText: string;
  offerPercentage?: number;
  condition: string;
  additionalItem?: string;
  additionalItemImage?: string;
  notifyCustomers?: boolean;
};

type OutletConfig = {
  id: string;
  enabled: boolean;
  name: string;
  address?: string;
  phone: string;
  latitude: number;
  longitude: number;
  deliveryRadiusKm: number;
  freeDeliveryRadiusKm: number;
  freeDeliveryMinimumOrder: number;
  minimumOrderIncrementPerKm: number;
  deliveryChargePerKm: number;
};

type WalletTransaction = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  amount: number;
  type: 'topup' | 'reward' | 'debit' | 'credit' | 'admin_adjustment';
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
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
    admin.initializeApp({
      credential: admin.credential.cert(parseServiceAccount()),
      projectId: process.env.FIREBASE_PROJECT_ID || 'harinos-12902',
    });
  }

  return admin.firestore();
};

const sendError = (res: VercelResponse, error: unknown) => {
  console.error(error);
  res.status(500).json({
    success: false,
    message: error instanceof Error ? error.message : 'Internal server error.',
  });
};

const getPath = (req: VercelRequest): string => {
  const url = new URL(req.url ?? '/', 'https://harinos.local');
  return url.pathname.replace(/^\/api\/?/, '/');
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const db = getFirestore();
    const path = getPath(req);

    if (req.method === 'GET' && path === '/health') {
      res.json({ success: true, storageDriver: 'firebase', projectId: process.env.FIREBASE_PROJECT_ID || 'harinos-12902' });
      return;
    }

    if (req.method === 'POST' && path === '/auth/login') {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username || !password) {
        res.status(400).json({ success: false, message: 'Missing username or password.' });
        return;
      }
      
      const DEFAULT_STAFF: AdminUser[] = [
        { role: 'admin', username: 'Admin_Harinos', password: 'Harinos_Admin', outletId: null },
        { role: 'manager', username: 'Manager_Harinos', password: 'Harinos_Manager', outletId: null },
        { role: 'staff', username: 'Staff_Harinos', password: 'Harinos_Staff', outletId: null },
      ];

      const staffRef = db.collection('staff_users');
      const snapshot = await staffRef.get();
      
      if (snapshot.empty) {
        for (const user of DEFAULT_STAFF) {
          await staffRef.doc(user.username).set(user);
        }
      }
      
      const userDoc = await staffRef.doc(username).get();
      if (!userDoc.exists) {
        res.status(401).json({ success: false, message: 'Invalid username or password.' });
        return;
      }
      
      const user = userDoc.data() as AdminUser;
      if (user.password !== password) {
        res.status(401).json({ success: false, message: 'Invalid username or password.' });
        return;
      }
      
      res.json({
        success: true,
        user: {
          role: user.role,
          username: user.username,
          outletId: user.outletId,
        },
      });
      return;
    }

    if (req.method === 'POST' && path === '/auth/change-password') {
      const { username, newPassword } = req.body as { username?: string; newPassword?: string };
      if (!username || !newPassword) {
        res.status(400).json({ success: false, message: 'Missing username or new password.' });
        return;
      }
      const staffRef = db.collection('staff_users');
      const docRef = staffRef.doc(username);
      const docSnap = await docRef.get();
      if (!docSnap.exists) {
        res.status(404).json({ success: false, message: 'Staff user not found.' });
        return;
      }
      await docRef.set({ password: newPassword }, { merge: true });
      res.json({ success: true, message: 'Password updated successfully.' });
      return;
    }

    if (req.method === 'GET' && path === '/menu-items') {
      const snapshot = await db.collection('menu_items').get();
      res.json({ success: true, menuItems: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    if (req.method === 'POST' && path === '/menu-items') {
      const item = req.body as MenuItem;
      await db.collection('menu_items').doc(item.id).set(item, { merge: true });
      res.json({ success: true });
      return;
    }

    if (req.method === 'POST' && path === '/menu-items/seed') {
      const items = req.body as MenuItem[];
      const batch = db.batch();
      for (const item of items) {
        const docRef = db.collection('menu_items').doc(item.id);
        batch.set(docRef, item, { merge: true });
      }
      await batch.commit();
      res.json({ success: true, count: items.length });
      return;
    }

    if (req.method === 'GET' && path === '/wallet/transactions') {
      const snapshot = await db.collection('wallet_transactions').orderBy('createdAt', 'desc').get();
      res.json({ success: true, transactions: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    if (req.method === 'POST' && path === '/wallet/transactions') {
      const transaction = req.body as WalletTransaction;
      await db.collection('wallet_transactions').doc(transaction.id).set(transaction, { merge: true });
      res.json({ success: true });
      return;
    }

    if (req.method === 'GET' && path === '/outlets') {
      const snapshot = await db.collection('outlets').get();
      res.json({ success: true, outlets: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    if (req.method === 'POST' && path === '/outlets') {
      const outlet = req.body as OutletConfig;
      await db.collection('outlets').doc(outlet.id).set(outlet, { merge: true });
      res.json({ success: true });
      return;
    }

    if (req.method === 'POST' && path === '/outlets/seed') {
      const outlets = req.body as OutletConfig[];
      const batch = db.batch();
      for (const outlet of outlets) {
        const docRef = db.collection('outlets').doc(outlet.id);
        batch.set(docRef, outlet, { merge: true });
      }
      await batch.commit();
      res.json({ success: true, count: outlets.length });
      return;
    }

    if (req.method === 'GET' && path === '/offers') {
      const snapshot = await db.collection('offers').get();
      res.json({ success: true, offers: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    if (req.method === 'POST' && path === '/offers') {
      const offer = req.body as OfferCard;
      await db.collection('offers').doc(offer.id).set(offer, { merge: true });
      res.json({ success: true });
      return;
    }

    if (req.method === 'POST' && path === '/offers/seed') {
      const offers = req.body as OfferCard[];
      const batch = db.batch();
      for (const offer of offers) {
        const docRef = db.collection('offers').doc(offer.id);
        batch.set(docRef, offer, { merge: true });
      }
      await batch.commit();
      res.json({ success: true, count: offers.length });
      return;
    }

    if (req.method === 'GET' && path === '/orders') {
      const snapshot = await db.collection('orders').orderBy('receivedAt', 'desc').limit(500).get();
      res.json({ success: true, orders: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    if (req.method === 'POST' && path === '/orders/full') {
      const order = req.body as Partial<OrderPayload>;
      if (!order.id || !Array.isArray(order.items)) {
        res.status(400).json({ success: false, message: 'Invalid order payload.' });
        return;
      }

      const nextOrder: OrderPayload = {
        ...(order as OrderPayload),
        receivedAt: order.receivedAt ?? new Date().toISOString(),
        status: order.status ?? 'new',
      };
      await db.collection('orders').doc(nextOrder.id).set(nextOrder, { merge: true });
      res.status(201).json({ success: true, orderId: nextOrder.id });
      return;
    }

    const statusMatch = path.match(/^\/orders\/([^/]+)\/status$/);
    if (req.method === 'PATCH' && statusMatch) {
      const status = (req.body as { status?: OrderStatus }).status;
      if (!status) {
        res.status(400).json({ success: false, message: 'Missing status.' });
        return;
      }
      await db.collection('orders').doc(decodeURIComponent(statusMatch[1])).set(
        {
          status,
          statusUpdatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      res.json({ success: true });
      return;
    }

    if (req.method === 'GET' && path === '/customers') {
      const snapshot = await db.collection('customers').orderBy('createdAt', 'desc').limit(500).get();
      res.json({ success: true, customers: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    if (req.method === 'POST' && path === '/customers') {
      const profile = req.body as Partial<CustomerProfile>;
      if (!profile.id || !profile.name || !profile.phone) {
        res.status(400).json({ success: false, message: 'Invalid customer profile.' });
        return;
      }

      await db.collection('customers').doc(profile.id).set(profile, { merge: true });
      res.status(201).json({ success: true, customer: profile });
      return;
    }

    const verifyMatch = path.match(/^\/customers\/([^/]+)\/verify$/);
    if (req.method === 'PATCH' && verifyMatch) {
      await db.collection('customers').doc(decodeURIComponent(verifyMatch[1])).set({ verified: true }, { merge: true });
      res.json({ success: true });
      return;
    }

    res.status(404).json({ success: false, message: `API route not found: ${path}` });
  } catch (error) {
    sendError(res, error);
  }
}
