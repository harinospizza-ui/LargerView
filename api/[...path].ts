import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

type OrderStatus = 'new' | 'preparing' | 'ready' | 'out_for_delivery' | 'done' | 'cancelled';

type CustomerProfile = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  loginMethod: 'email' | 'phone';
  verified?: boolean;
  referralCode?: string;
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

// Memory Database fallbacks
let isUsingMemoryDb = false;

const DEFAULT_STAFF: AdminUser[] = [
  { role: 'admin', username: 'Admin_Harinos', password: 'Harinos_Admin', outletId: null },
  { role: 'manager', username: 'Manager_Harinos', password: 'Harinos_Manager', outletId: null },
  { role: 'staff', username: 'Staff_Harinos', password: 'Harinos_Staff', outletId: null },
];

const DEFAULT_OUTLETS: OutletConfig[] = [
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

const DEFAULT_OFFERS: OfferCard[] = [
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

const DEFAULT_MENU_ITEMS: MenuItem[] = [
  {
    id: 'p1_co',
    name: "Cheese & Onion Pizza",
    description: "Classic hand-stretched pizza topped with mozzarella and onions.",
    price: 99,
    category: 'Pizza',
    image: "/images/cheeseonion.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 99 }, { label: 'Medium', price: 219 }, { label: 'Large', price: 329 }]
  },
  {
    id: 'p1_t',
    name: "Cheese & Tomato",
    description: "Double mozzarella with fresh juicy tomatoes.",
    price: 119,
    category: 'Pizza',
    image: "/images/cheesetomato.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 119 }, { label: 'Medium', price: 239 }, { label: 'Large', price: 349 }]
  },
  {
    id: 'p1_cap',
    name: "Cheese & Capsicum",
    description: "Double mozzarella with crunchy green capsicum.",
    price: 119,
    category: 'Pizza',
    image: "/images/cheesecap.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 119 }, { label: 'Medium', price: 239 }, { label: 'Large', price: 349 }]
  },
  {
    id: 'p1_corn',
    name: "Cheese & Corn",
    description: "Sweet golden corn smothered in mozzarella.",
    price: 129,
    category: 'Pizza',
    image: "/images/sweetcorn.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 129 }, { label: 'Medium', price: 259 }, { label: 'Large', price: 369 }]
  },
  {
    id: 'p1_p',
    name: "Cheese & Paneer",
    description: "Soft paneer chunks smothered in mozzarella.",
    price: 129,
    category: 'Pizza',
    image: "/images/cheesepaneer.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 129 }, { label: 'Medium', price: 259 }, { label: 'Large', price: 369 }]
  },
  {
    id: 'p2_tp',
    name: "Tandoori Paneer (Paneer + Onion)",
    description: "Smoky tandoori marinated paneer with grilled onions.",
    price: 149,
    category: 'Pizza',
    image: "/images/tanduripaneer.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 149 }, { label: 'Medium', price: 289 }, { label: 'Large', price: 409 }]
  },
  {
    id: 'p_hs',
    name: "Harino's Special",
    description: "Signature masterpiece with paneer, corn, olives and secret spices.",
    price: 219,
    category: 'Pizza',
    image: "/images/hari.jpeg",
    vegetarian: true,
    available: true,
    popular: true,
    sizes: [{ label: 'Regular', price: 219 }, { label: 'Medium', price: 349 }, { label: 'Large', price: 499 }]
  },
  {
    id: 'm1_v',
    name: "Veg Steam Momos",
    description: "Delicate steamed veggie dumplings.",
    price: 40,
    category: 'Momos & Fries',
    image: "/images/steammomos.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 40 }, { label: 'Full', price: 60 }]
  },
  {
    id: 'b_tk',
    name: "Tikka Burger",
    description: "Spicy tikka patty with premium mayo.",
    price: 40,
    category: 'Burgers',
    image: "/images/tikkaburgar.jpeg",
    vegetarian: true,
    available: true
  },
  {
    id: 's_cl',
    name: "Choco Lava Cake",
    description: "Molten chocolate center cake.",
    price: 60,
    category: 'Sides & Snacks',
    image: "/images/chocolava.jpeg",
    vegetarian: true,
    available: true
  },
  {
    id: 'd_cc',
    name: "Cold Coffee",
    description: "Iced coffee blend.",
    price: 70,
    category: 'Beverages',
    image: "/images/coldcoffee.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 70 }]
  }
];

const DB_FILE = path.join('/tmp', 'harinos_db.json');

const loadLocalDb = () => {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to read local DB:', err);
  }
  return {
    orders: [],
    customers: [
      { id: 'cust_anuj', name: 'Anuj', phone: '7505226934', loginMethod: 'phone', verified: true, createdAt: new Date().toISOString() }
    ],
    menu_items: DEFAULT_MENU_ITEMS,
    outlets: DEFAULT_OUTLETS,
    offers: DEFAULT_OFFERS,
    wallet_transactions: [],
    staff_users: DEFAULT_STAFF,
  };
};

const saveLocalDb = (data: any) => {
  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write local DB:', err);
  }
};

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'harinos-12902';
const REST_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

let isUsingRestDb = false;

const getValue = (valObj: any): any => {
  if (!valObj) return null;
  if ('stringValue' in valObj) return valObj.stringValue;
  if ('integerValue' in valObj) return parseInt(valObj.integerValue, 10);
  if ('doubleValue' in valObj) return parseFloat(valObj.doubleValue);
  if ('booleanValue' in valObj) return valObj.booleanValue;
  if ('nullValue' in valObj) return null;
  if ('arrayValue' in valObj) {
    const values = valObj.arrayValue.values || [];
    return values.map((v: any) => getValue(v));
  }
  if ('mapValue' in valObj) {
    const fields = valObj.mapValue.fields || {};
    const result: any = {};
    for (const [k, v] of Object.entries(fields)) {
      result[k] = getValue(v);
    }
    return result;
  }
  return undefined;
};

const mapFromFirestore = (doc: any): any => {
  if (!doc || !doc.fields) return null;
  const result: any = {};
  for (const [key, value] of Object.entries(doc.fields)) {
    result[key] = getValue(value);
  }
  if (doc.name) {
    const parts = doc.name.split('/');
    result.id = parts[parts.length - 1];
  }
  return result;
};

const toValue = (val: any): any => {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: val.toString() };
    }
    return { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(v => toValue(v)).filter(v => v !== undefined) } };
  }
  if (typeof val === 'object') {
    const fields: any = {};
    for (const [k, v] of Object.entries(val)) {
      const fieldVal = toValue(v);
      if (fieldVal !== undefined) {
        fields[k] = fieldVal;
      }
    }
    return { mapValue: { fields } };
  }
  return undefined;
};

const mapToFirestore = (obj: any): any => {
  const fields: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'id') continue;
    const val = toValue(value);
    if (val !== undefined) {
      fields[key] = val;
    }
  }
  return { fields };
};

const restGetCollection = async (collectionId: string): Promise<any[]> => {
  const url = `${REST_BASE}/${collectionId}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`REST fetch collection failed with status ${res.status}`);
  }
  const data = await res.json();
  const docs = data.documents || [];
  return docs.map((d: any) => mapFromFirestore(d)).filter((d: any) => d !== null);
};

const restGetDocument = async (collectionId: string, documentId: string): Promise<any | null> => {
  const url = `${REST_BASE}/${collectionId}/${encodeURIComponent(documentId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`REST fetch document failed with status ${res.status}`);
  }
  const data = await res.json();
  return mapFromFirestore(data);
};

const restSetDocument = async (collectionId: string, documentId: string, data: any): Promise<void> => {
  const url = `${REST_BASE}/${collectionId}/${encodeURIComponent(documentId)}`;
  const firestoreData = mapToFirestore(data);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(firestoreData),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`REST set document failed with status ${res.status}: ${errText}`);
  }
};

const getFirestore = (): admin.firestore.Firestore | null => {
  try {
    if (!admin.apps.length) {
      const serviceAccount = parseServiceAccount();
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID || 'harinos-12902',
      });
    }
    return admin.firestore();
  } catch (error) {
    console.warn('Firebase admin initialization failed, falling back to REST/local DB:', error);
    isUsingRestDb = true;
    return null;
  }
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
      res.json({
        success: true,
        storageDriver: isUsingMemoryDb ? 'memory' : 'firebase',
        projectId: process.env.FIREBASE_PROJECT_ID || 'harinos-12902',
      });
      return;
    }

    if (req.method === 'GET' && path === '/firebase-config') {
      res.json({
        success: true,
        config: {
          apiKey: (process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '').trim(),
          authDomain: (process.env.VITE_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || '').trim(),
          projectId: (process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || '').trim(),
          storageBucket: (process.env.VITE_FIREBASE_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '').trim(),
          messagingSenderId: (process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID || '').trim(),
          appId: (process.env.VITE_FIREBASE_APP_ID || process.env.FIREBASE_APP_ID || '').trim(),
        }
      });
      return;
    }

    if (req.method === 'POST' && path === '/auth/login') {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username || !password) {
        res.status(400).json({ success: false, message: 'Missing username or password.' });
        return;
      }

      if (isUsingRestDb) {
        try {
          let users = await restGetCollection('staff_users');
          if (users.length === 0) {
            for (const user of DEFAULT_STAFF) {
              await restSetDocument('staff_users', user.username, user);
            }
            users = [...DEFAULT_STAFF];
          }
          const user = users.find((u: any) => u.username === username);
          if (!user || user.password !== password) {
            res.status(401).json({ success: false, message: 'Invalid username or password.' });
            return;
          }
          res.json({
            success: true,
            user: { role: user.role, username: user.username, outletId: user.outletId },
          });
          return;
        } catch (err) {
          console.warn('REST auth login failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }
      
      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        const user = localDb.staff_users.find((u: any) => u.username === username);
        if (!user || user.password !== password) {
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

      const staffRef = db!.collection('staff_users');
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

      if (isUsingRestDb) {
        try {
          const user = await restGetDocument('staff_users', username);
          if (!user) {
            res.status(404).json({ success: false, message: 'Staff user not found.' });
            return;
          }
          user.password = newPassword;
          await restSetDocument('staff_users', username, user);
          res.json({ success: true, message: 'Password updated successfully.' });
          return;
        } catch (err) {
          console.warn('REST change password failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }
      
      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        const userIdx = localDb.staff_users.findIndex((u: any) => u.username === username);
        if (userIdx === -1) {
          res.status(404).json({ success: false, message: 'Staff user not found.' });
          return;
        }
        localDb.staff_users[userIdx].password = newPassword;
        saveLocalDb(localDb);
        res.json({ success: true, message: 'Password updated successfully.' });
        return;
      }

      const staffRef = db!.collection('staff_users');
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
      if (isUsingRestDb) {
        try {
          const items = await restGetCollection('menu_items');
          res.json({ success: true, menuItems: items });
          return;
        } catch (err) {
          console.warn('REST get menu items failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }

      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        res.json({ success: true, menuItems: localDb.menu_items });
        return;
      }

      const snapshot = await db!.collection('menu_items').get();
      res.json({ success: true, menuItems: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    if (req.method === 'POST' && path === '/menu-items') {
      const item = req.body as MenuItem;

      if (isUsingRestDb) {
        try {
          await restSetDocument('menu_items', item.id, item);
          res.json({ success: true });
          return;
        } catch (err) {
          console.warn('REST save menu item failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }
      
      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        const idx = localDb.menu_items.findIndex((i: any) => i.id === item.id);
        if (idx >= 0) localDb.menu_items[idx] = { ...localDb.menu_items[idx], ...item };
        else localDb.menu_items.push(item);
        saveLocalDb(localDb);
        res.json({ success: true });
        return;
      }

      await db!.collection('menu_items').doc(item.id).set(item, { merge: true });
      res.json({ success: true });
      return;
    }

    if (req.method === 'POST' && path === '/menu-items/seed') {
      const items = req.body as MenuItem[];

      if (isUsingRestDb) {
        try {
          for (const item of items) {
            await restSetDocument('menu_items', item.id, item);
          }
          res.json({ success: true, count: items.length });
          return;
        } catch (err) {
          console.warn('REST seed menu items failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }
      
      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        for (const item of items) {
          const idx = localDb.menu_items.findIndex((i: any) => i.id === item.id);
          if (idx >= 0) localDb.menu_items[idx] = { ...localDb.menu_items[idx], ...item };
          else localDb.menu_items.push(item);
        }
        saveLocalDb(localDb);
        res.json({ success: true, count: items.length });
        return;
      }

      const batch = db!.batch();
      for (const item of items) {
        const docRef = db!.collection('menu_items').doc(item.id);
        batch.set(docRef, item, { merge: true });
      }
      await batch.commit();
      res.json({ success: true, count: items.length });
      return;
    }

    if (req.method === 'GET' && path === '/wallet/transactions') {
      if (isUsingRestDb) {
        try {
          const txs = await restGetCollection('wallet_transactions');
          const sorted = txs.sort(
            (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          res.json({ success: true, transactions: sorted });
          return;
        } catch (err) {
          console.warn('REST get transactions failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }

      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        const sorted = [...localDb.wallet_transactions].sort(
          (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        res.json({ success: true, transactions: sorted });
        return;
      }

      const snapshot = await db!.collection('wallet_transactions').orderBy('createdAt', 'desc').get();
      res.json({ success: true, transactions: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    if (req.method === 'POST' && path === '/wallet/transactions') {
      const transaction = req.body as WalletTransaction;

      if (isUsingRestDb) {
        try {
          await restSetDocument('wallet_transactions', transaction.id, transaction);
          res.json({ success: true });
          return;
        } catch (err) {
          console.warn('REST save transaction failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }
      
      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        const idx = localDb.wallet_transactions.findIndex((t: any) => t.id === transaction.id);
        if (idx >= 0) localDb.wallet_transactions[idx] = { ...localDb.wallet_transactions[idx], ...transaction };
        else localDb.wallet_transactions.push(transaction);
        saveLocalDb(localDb);
        res.json({ success: true });
        return;
      }

      await db!.collection('wallet_transactions').doc(transaction.id).set(transaction, { merge: true });
      res.json({ success: true });
      return;
    }

    if (req.method === 'GET' && path === '/outlets') {
      if (isUsingRestDb) {
        try {
          const outlets = await restGetCollection('outlets');
          res.json({ success: true, outlets });
          return;
        } catch (err) {
          console.warn('REST get outlets failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }

      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        res.json({ success: true, outlets: localDb.outlets });
        return;
      }

      const snapshot = await db!.collection('outlets').get();
      res.json({ success: true, outlets: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    if (req.method === 'POST' && path === '/outlets') {
      const outlet = req.body as OutletConfig;

      if (isUsingRestDb) {
        try {
          await restSetDocument('outlets', outlet.id, outlet);
          res.json({ success: true });
          return;
        } catch (err) {
          console.warn('REST save outlet failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }
      
      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        const idx = localDb.outlets.findIndex((o: any) => o.id === outlet.id);
        if (idx >= 0) localDb.outlets[idx] = { ...localDb.outlets[idx], ...outlet };
        else localDb.outlets.push(outlet);
        saveLocalDb(localDb);
        res.json({ success: true });
        return;
      }

      await db!.collection('outlets').doc(outlet.id).set(outlet, { merge: true });
      res.json({ success: true });
      return;
    }

    if (req.method === 'POST' && path === '/outlets/seed') {
      const outlets = req.body as OutletConfig[];

      if (isUsingRestDb) {
        try {
          for (const outlet of outlets) {
            await restSetDocument('outlets', outlet.id, outlet);
          }
          res.json({ success: true, count: outlets.length });
          return;
        } catch (err) {
          console.warn('REST seed outlets failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }
      
      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        for (const outlet of outlets) {
          const idx = localDb.outlets.findIndex((o: any) => o.id === outlet.id);
          if (idx >= 0) localDb.outlets[idx] = { ...localDb.outlets[idx], ...outlet };
          else localDb.outlets.push(outlet);
        }
        saveLocalDb(localDb);
        res.json({ success: true, count: outlets.length });
        return;
      }

      const batch = db!.batch();
      for (const outlet of outlets) {
        const docRef = db!.collection('outlets').doc(outlet.id);
        batch.set(docRef, outlet, { merge: true });
      }
      await batch.commit();
      res.json({ success: true, count: outlets.length });
      return;
    }

    if (req.method === 'GET' && path === '/offers') {
      if (isUsingRestDb) {
        try {
          const offers = await restGetCollection('offers');
          res.json({ success: true, offers });
          return;
        } catch (err) {
          console.warn('REST get offers failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }

      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        res.json({ success: true, offers: localDb.offers });
        return;
      }

      const snapshot = await db!.collection('offers').get();
      res.json({ success: true, offers: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    if (req.method === 'POST' && path === '/offers') {
      const offer = req.body as OfferCard;

      if (isUsingRestDb) {
        try {
          await restSetDocument('offers', offer.id, offer);
          res.json({ success: true });
          return;
        } catch (err) {
          console.warn('REST save offer failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }
      
      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        const idx = localDb.offers.findIndex((o: any) => o.id === offer.id);
        if (idx >= 0) localDb.offers[idx] = { ...localDb.offers[idx], ...offer };
        else localDb.offers.push(offer);
        saveLocalDb(localDb);
        res.json({ success: true });
        return;
      }

      await db!.collection('offers').doc(offer.id).set(offer, { merge: true });
      res.json({ success: true });
      return;
    }

    if (req.method === 'POST' && path === '/offers/seed') {
      const offers = req.body as OfferCard[];

      if (isUsingRestDb) {
        try {
          for (const offer of offers) {
            await restSetDocument('offers', offer.id, offer);
          }
          res.json({ success: true, count: offers.length });
          return;
        } catch (err) {
          console.warn('REST seed offers failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }
      
      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        for (const offer of offers) {
          const idx = localDb.offers.findIndex((o: any) => o.id === offer.id);
          if (idx >= 0) localDb.offers[idx] = { ...localDb.offers[idx], ...offer };
          else localDb.offers.push(offer);
        }
        saveLocalDb(localDb);
        res.json({ success: true, count: offers.length });
        return;
      }

      const batch = db!.batch();
      for (const offer of offers) {
        const docRef = db!.collection('offers').doc(offer.id);
        batch.set(docRef, offer, { merge: true });
      }
      await batch.commit();
      res.json({ success: true, count: offers.length });
      return;
    }

    if (req.method === 'GET' && path === '/orders') {
      if (isUsingRestDb) {
        try {
          const orders = await restGetCollection('orders');
          const sorted = orders.sort(
            (a: any, b: any) => new Date(b.receivedAt ?? b.date).getTime() - new Date(a.receivedAt ?? a.date).getTime()
          );
          res.json({ success: true, orders: sorted });
          return;
        } catch (err) {
          console.warn('REST get orders failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }

      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        const sorted = [...localDb.orders].sort(
          (a: any, b: any) => new Date(b.receivedAt ?? b.date).getTime() - new Date(a.receivedAt ?? a.date).getTime()
        );
        res.json({ success: true, orders: sorted });
        return;
      }

      const snapshot = await db!.collection('orders').orderBy('receivedAt', 'desc').limit(500).get();
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

      if (isUsingRestDb) {
        try {
          await restSetDocument('orders', nextOrder.id, nextOrder);
          res.status(201).json({ success: true, orderId: nextOrder.id });
          return;
        } catch (err) {
          console.warn('REST save order failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }

      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        const idx = localDb.orders.findIndex((o: any) => o.id === nextOrder.id);
        if (idx >= 0) localDb.orders[idx] = { ...localDb.orders[idx], ...nextOrder };
        else localDb.orders.push(nextOrder);
        saveLocalDb(localDb);
        res.status(201).json({ success: true, orderId: nextOrder.id });
        return;
      }

      await db!.collection('orders').doc(nextOrder.id).set(nextOrder, { merge: true });
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
      const orderId = decodeURIComponent(statusMatch[1]);

      if (isUsingRestDb) {
        try {
          const order = await restGetDocument('orders', orderId);
          if (order) {
            order.status = status;
            order.statusUpdatedAt = new Date().toISOString();
            await restSetDocument('orders', orderId, order);
            res.json({ success: true });
            return;
          }
          res.status(404).json({ success: false, message: 'Order not found.' });
          return;
        } catch (err) {
          console.warn('REST update order status failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }
      
      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        const idx = localDb.orders.findIndex((o: any) => o.id === orderId);
        if (idx >= 0) {
          localDb.orders[idx].status = status;
          localDb.orders[idx].statusUpdatedAt = new Date().toISOString();
          saveLocalDb(localDb);
          res.json({ success: true });
          return;
        }
        res.status(404).json({ success: false, message: 'Order not found.' });
        return;
      }

      await db!.collection('orders').doc(orderId).set(
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
      if (isUsingRestDb) {
        try {
          const customers = await restGetCollection('customers');
          const sorted = customers.sort((a: any, b: any) => {
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeB - timeA;
          });
          res.json({ success: true, customers: sorted });
          return;
        } catch (err) {
          console.warn('REST get customers failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }

      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        const sorted = [...localDb.customers].sort((a: any, b: any) => {
          const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return timeB - timeA;
        });
        res.json({ success: true, customers: sorted });
        return;
      }

      const snapshot = await db!.collection('customers').limit(500).get();
      const list = snapshot.docs.map((doc) => doc.data() as CustomerProfile);
      list.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      });
      res.json({ success: true, customers: list });
      return;
    }

    if (req.method === 'POST' && path === '/customers') {
      const profile = req.body as Partial<CustomerProfile>;
      if (!profile.id || !profile.name || !profile.phone) {
        res.status(400).json({ success: false, message: 'Invalid customer profile.' });
        return;
      }

      if (isUsingRestDb) {
        try {
          await restSetDocument('customers', profile.id, profile);
          res.status(201).json({ success: true, customer: profile });
          return;
        } catch (err) {
          console.warn('REST save customer failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }

      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        const idx = localDb.customers.findIndex((c: any) => c.id === profile.id);
        if (idx >= 0) localDb.customers[idx] = { ...localDb.customers[idx], ...profile };
        else localDb.customers.push(profile as CustomerProfile);
        saveLocalDb(localDb);
        res.status(201).json({ success: true, customer: profile });
        return;
      }

      await db!.collection('customers').doc(profile.id).set(profile, { merge: true });
      res.status(201).json({ success: true, customer: profile });
      return;
    }

    const verifyMatch = path.match(/^\/customers\/([^/]+)\/verify$/);
    if (req.method === 'PATCH' && verifyMatch) {
      const customerId = decodeURIComponent(verifyMatch[1]);

      if (isUsingRestDb) {
        try {
          const customerData = await restGetDocument('customers', customerId);
          if (!customerData) {
            res.status(404).json({ success: false, message: 'Customer not found.' });
            return;
          }
          
          const customers = await restGetCollection('customers');
          const cleanPhone = (p: string) => p.replace(/\D/g, '');
          const targetPhone = cleanPhone(customerData.phone);
          const alreadyVerified = customers.some((c: any) => {
            return c.verified && c.id !== customerId && c.phone && cleanPhone(c.phone) === targetPhone;
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
          await restSetDocument('customers', customerId, customer);
          res.json({ success: true, customer });
          return;
        } catch (err) {
          console.warn('REST verify customer failed, falling back:', err);
          isUsingRestDb = false;
          isUsingMemoryDb = true;
        }
      }
      
      if (isUsingMemoryDb) {
        const localDb = loadLocalDb();
        const idx = localDb.customers.findIndex((c: any) => c.id === customerId);
        if (idx === -1) {
          res.status(404).json({ success: false, message: 'Customer not found.' });
          return;
        }
        
        const customerData = localDb.customers[idx];
        const cleanPhone = (p: string) => p.replace(/\D/g, '');
        const targetPhone = cleanPhone(customerData.phone);
        const alreadyVerified = localDb.customers.some((c: any) => {
          return c.verified && c.id !== customerId && c.phone && cleanPhone(c.phone) === targetPhone;
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
        localDb.customers[idx] = customer;
        saveLocalDb(localDb);
        res.json({ success: true, customer });
        return;
      }

      const docRef = db!.collection('customers').doc(customerId);
      const snap = await docRef.get();
      if (!snap.exists) {
        res.status(404).json({ success: false, message: 'Customer not found.' });
        return;
      }
      const customerData = snap.data() as CustomerProfile;

      const allCustomersSnap = await db!.collection('customers').where('verified', '==', true).get();
      const cleanPhone = (p: string) => p.replace(/\D/g, '');
      const targetPhone = cleanPhone(customerData.phone);
      const alreadyVerified = allCustomersSnap.docs.some((doc) => {
        const data = doc.data() as CustomerProfile;
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

    res.status(404).json({ success: false, message: `API route not found: ${path}` });
  } catch (error) {
    sendError(res, error);
  }
}
