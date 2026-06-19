import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { hashPassword, verifyPassword, generateToken, verifyToken } from './cryptoUtils.js';

const getJWTSecret = (): string => {
  return process.env.JWT_SECRET || 'dev-harinos-pizza-secret-key-32-chars-minimum';
};

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


;

;


let isUsingRestDb = false;

;

;

;

;

;

;

;

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


type NotificationRole = 'admin' | 'manager' | 'staff' | 'customer';
type NotificationEventType = 'NEW_ORDER' | 'PREPARING' | 'READY' | 'OUT_FOR_DELIVERY' | 'DONE' | 'CANCELLED';

const buildNotificationMessage = (
  eventType: NotificationEventType,
  orderId: string,
  additionalData?: Record<string, string>,
) => {
  const baseData = {
    orderId,
    eventType,
    timestamp: new Date().toISOString(),
    ...additionalData,
  };

  switch (eventType) {
    case 'NEW_ORDER':
      return {
        notification: {
          title: '🍕 New Order Received',
          body: `Order #${orderId.split('-')[2] || orderId.slice(-5)} is waiting to be prepared`,
        },
        data: baseData,
      };
    case 'PREPARING':
      return {
        notification: {
          title: 'Order Confirmed',
          body: `Your order #${orderId.split('-')[2] || orderId.slice(-5)} is being prepared`,
        },
        data: baseData,
      };
    case 'READY':
      return {
        notification: {
          title: '✨ Order Ready',
          body: `Your order #${orderId.split('-')[2] || orderId.slice(-5)} is ready for pickup`,
        },
        data: baseData,
      };
    case 'OUT_FOR_DELIVERY':
      return {
        notification: {
          title: '📍 On the Way',
          body: `Your order #${orderId.split('-')[2] || orderId.slice(-5)} is out for delivery`,
        },
        data: baseData,
      };
    case 'DONE':
      return {
        notification: {
          title: '✅ Order Completed',
          body: `Your order #${orderId.split('-')[2] || orderId.slice(-5)} has been completed. Thank you!`,
        },
        data: baseData,
      };
    case 'CANCELLED':
      return {
        notification: {
          title: '❌ Order Cancelled',
          body: `Your order #${orderId.split('-')[2] || orderId.slice(-5)} has been cancelled`,
        },
        data: baseData,
      };
    default:
      return {
        notification: {
          title: 'Order Update',
          body: `Update for order #${orderId.split('-')[2] || orderId.slice(-5)}`,
        },
        data: baseData,
      };
  }
};

const logNotificationEvent = async (
  eventType: NotificationEventType,
  orderId: string,
  role: NotificationRole,
  outletId: string | undefined,
  sent: number,
  failed: number,
) => {
  try {
    const db = getFirestore();
    await db.collection('notification_log').add({
      eventType,
      orderId,
      role,
      outletId: outletId || 'all',
      sent,
      failed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('Warning: Failed to log notification event', error);
  }
};

const sendNotificationToRole = async (
  eventType: NotificationEventType,
  orderId: string,
  role: NotificationRole,
  outletId?: string,
  additionalData?: Record<string, string>,
) => {
  try {
    const db = getFirestore();
    const messaging = admin.messaging();

    let query: admin.firestore.Query = db
      .collection('notification_tokens')
      .where('role', '==', role)
      .where('isActive', '==', true);

    if (outletId) {
      query = query.where('outletId', '==', outletId);
    }

    const tokensSnapshot = await query.get();
    const tokens = tokensSnapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as any);

    if (tokens.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const message = buildNotificationMessage(eventType, orderId, additionalData);
    let sent = 0;
    let failed = 0;

    for (const token of tokens) {
      try {
        await messaging.send({
          token: token.fcmToken,
          ...message,
        });
        sent++;
      } catch (error) {
        failed++;
        const errorMsg = error instanceof Error ? error.message : '';
        if (
          errorMsg.includes('unregistered') ||
          errorMsg.includes('invalid') ||
          errorMsg.includes('not-registered')
        ) {
          if (token.id) {
            await db.collection('notification_tokens').doc(token.id).update({ isActive: false });
          }
        }
      }
    }

    await logNotificationEvent(eventType, orderId, role, outletId, sent, failed);
    return { sent, failed };
  } catch (error) {
    console.error('Error sending notifications:', error);
    return { sent: 0, failed: 0 };
  }
};

const sendNotificationToCustomer = async (
  eventType: NotificationEventType,
  orderId: string,
  customerId: string,
  additionalData?: Record<string, string>,
) => {
  try {
    const db = getFirestore();
    const messaging = admin.messaging();

    const tokensSnapshot = await db
      .collection('notification_tokens')
      .where('userId', '==', customerId)
      .where('role', '==', 'customer')
      .where('isActive', '==', true)
      .get();

    const tokens = tokensSnapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as any);

    if (tokens.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const message = buildNotificationMessage(eventType, orderId, additionalData);
    let sent = 0;
    let failed = 0;

    for (const token of tokens) {
      try {
        await messaging.send({
          token: token.fcmToken,
          ...message,
        });
        sent++;
      } catch (error) {
        failed++;
        const errorMsg = error instanceof Error ? error.message : '';
        if (
          errorMsg.includes('unregistered') ||
          errorMsg.includes('invalid') ||
          errorMsg.includes('not-registered')
        ) {
          if (token.id) {
            await db.collection('notification_tokens').doc(token.id).update({ isActive: false });
          }
        }
      }
    }

    return { sent, failed };
  } catch (error) {
    console.error('Error sending customer notification:', error);
    return { sent: 0, failed: 0 };
  }
};

const sendNewOrderNotifications = async (order: any) => {
  try {
    const db = getFirestore();
    const items = order.items || [];
    const itemSummary = items.slice(0, 2).map((it: any) => `${it.quantity || 1}x ${it.name}`).join(', ');
    const additional = items.length > 2 ? ` +${items.length - 2} more` : '';
    const itemText = `${itemSummary}${additional}`;

    // Get active/pending order counts from Firestore
    const activeOrdersSnap = await db.collection('orders')
      .where('status', 'in', ['new', 'preparing', 'ready', 'out_for_delivery'])
      .get();

    const activeOrders = activeOrdersSnap.docs.map(doc => doc.data());
    const adminPendingCount = activeOrders.length;
    const outletPendingCount = order.outletId ? activeOrders.filter(o => o.outletId === order.outletId).length : adminPendingCount;

    // Send notifications to admins, managers, and staff
    await sendNotificationToRole('NEW_ORDER', order.id, 'admin', undefined, {
      itemSummary: itemText,
      orderType: order.orderType || 'takeaway',
      total: String(Math.round(order.total || 0)),
      pendingCount: String(adminPendingCount),
    });

    if (order.outletId) {
      await sendNotificationToRole('NEW_ORDER', order.id, 'manager', order.outletId, {
        itemSummary: itemText,
        orderType: order.orderType || 'takeaway',
        pendingCount: String(outletPendingCount),
      });

      await sendNotificationToRole('NEW_ORDER', order.id, 'staff', order.outletId, {
        itemSummary: itemText,
        orderType: order.orderType || 'takeaway',
        pendingCount: String(outletPendingCount),
      });
    }
  } catch (err) {
    console.error('Error sending new order notifications:', err);
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

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

      const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';

      const handleUserAuth = async (user: any, updatePasswordCallback: (hashed: string) => Promise<void>) => {
        if (!verifyPassword(password, user.password)) {
          await logSecurityEvent('FAILED_LOGIN', username, 'Invalid password attempt', clientIp);
          res.status(401).json({ success: false, message: 'Invalid username or password.' });
          return;
        }

        // Auto hash password if stored as plaintext
        if (!user.password.startsWith('pbkdf2$')) {
          const hashed = hashPassword(password);
          await updatePasswordCallback(hashed);
          user.password = hashed;
          await logSecurityEvent('PASSWORD_UPGRADED_TO_HASH', username, 'Migrated plaintext password to pbkdf2 hash', clientIp);
        }

        const token = generateToken({ username: user.username, role: user.role, outletId: user.outletId }, getJWTSecret());
        await logSecurityEvent('SUCCESSFUL_LOGIN', username, `Role: ${user.role}`, clientIp);
        res.json({
          success: true,
          token,
          user: { role: user.role, username: user.username, outletId: user.outletId },
        });
      };





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

      const user = userDoc.data() as AdminUser;
      await handleUserAuth(user, async (hashed) => {
        await staffRef.doc(username).update({ password: hashed });
      });
      return;
    }

    if (req.method === 'POST' && path === '/auth/change-password') {
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

    if (req.method === 'GET' && path === '/menu-items') {
      const snapshot = await db.collection('menu_items').get();
      if (snapshot.empty) {
        const batch = db.batch();
        for (const item of DEFAULT_MENU_ITEMS) {
          const docRef = db.collection('menu_items').doc(item.id);
          batch.set(docRef, item);
        }
        await batch.commit();
        const seededSnapshot = await db.collection('menu_items').get();
        res.json({ success: true, menuItems: seededSnapshot.docs.map((doc) => doc.data()) });
        return;
      }
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
      res.json({ success: true, transactions: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    if (req.method === 'POST' && path === '/wallet/transactions') {
      const caller = authenticateRequest(req);
      if (!caller) {
        res.status(401).json({ success: false, message: 'Unauthorized.' });
        return;
      }
      if (caller.role !== 'admin' && caller.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Forbidden.' });
        return;
      }

      const transaction = req.body as WalletTransaction;





      await db.collection('wallet_transactions').doc(transaction.id).set(transaction, { merge: true });
      res.json({ success: true });
      return;
    }

    if (req.method === 'GET' && path === '/outlets') {
      const snapshot = await db.collection('outlets').get();
      if (snapshot.empty) {
        const batch = db.batch();
        for (const outlet of DEFAULT_OUTLETS) {
          const docRef = db.collection('outlets').doc(outlet.id);
          batch.set(docRef, outlet);
        }
        await batch.commit();
        const seededSnapshot = await db.collection('outlets').get();
        res.json({ success: true, outlets: seededSnapshot.docs.map((doc) => doc.data()) });
        return;
      }
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
      const caller = authenticateRequest(req);
      if (!caller) {
        res.status(401).json({ success: false, message: 'Unauthorized.' });
        return;
      }

      const filterOrdersByRole = (ordersList: any[]) => {
        let result = ordersList;
        if (caller.role === 'staff') {
          result = result.filter(o => !o.isDeleted && (caller.outletId ? o.outletId === caller.outletId : true));
          // Strip financial info for staff callers
          result = result.map(o => {
            const sanitized = { ...o };
            delete sanitized.total;
            delete sanitized.deliveryFee;
            delete sanitized.walletAmountRedeemed;
            delete sanitized.rewardPointsRedeemed;
            if (Array.isArray(sanitized.items)) {
              sanitized.items = sanitized.items.map((it: any) => {
                const cleanIt = { ...it };
                delete cleanIt.price;
                delete cleanIt.totalPrice;
                return cleanIt;
              });
            }
            return sanitized;
          });
        } else if (caller.role === 'manager') {
          result = result.filter(o => !o.isDeleted);
        }
        // Admin can see everything including soft deleted
        return result;
      };





      const snapshot = await db.collection('orders').orderBy('receivedAt', 'desc').limit(500).get();
      const rawOrders = snapshot.docs.map((doc) => doc.data());
      const filtered = filterOrdersByRole(rawOrders);
      res.json({ success: true, orders: filtered });
      return;
    }

    if (req.method === 'POST' && path === '/orders') {
      const order = req.body as Partial<OrderPayload>;
      if (!Array.isArray(order.items)) {
        res.status(400).json({ success: false, message: 'Invalid order payload: items list is required.' });
        return;
      }

      // Generate server-side order ID using a sequential number matching today's date
      const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const todayFormatted = todayStr.replace(/-/g, ''); // YYYYMMDD
      const startOfDay = new Date(todayStr + 'T00:00:00.000Z');

      const snapshot = await db.collection('orders')
        .where('receivedAt', '>=', startOfDay.toISOString())
        .get();
      const dailySeq = snapshot.size + 1;
      const orderId = `HRN-${todayFormatted}-${dailySeq}`;

      const nextOrder: OrderPayload = {
        ...(order as OrderPayload),
        id: orderId,
        receivedAt: new Date().toISOString(),
        date: new Date().toLocaleString(),
        status: 'new',
        auditTrail: [{
          timestamp: new Date().toISOString(),
          updatedBy: order.customerName ? String(order.customerName) : 'customer',
          action: 'Order placed'
        }]
      };

      await db.collection('orders').doc(orderId).set(nextOrder);

      // Send background new order FCM alerts to admin/manager/staff
      void sendNewOrderNotifications(nextOrder).catch((err) => console.error('Error notifying new order:', err));

      res.status(201).json({ success: true, order: nextOrder });
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
    const getOrderMatch = path.match(/^\/orders\/([^/]+)$/);

    if (req.method === 'GET' && getOrderMatch) {
      const orderId = decodeURIComponent(getOrderMatch[1]);





      const snap = await db.collection('orders').doc(orderId).get();
      if (!snap.exists) {
        res.status(404).json({ success: false, message: 'Order not found.' });
        return;
      }
      const order = snap.data() as any;
      if (order.isDeleted) {
        res.status(404).json({ success: false, message: 'Order not found.' });
        return;
      }

      // Strip financial info for staff callers
      const caller = authenticateRequest(req);
      if (caller && caller.role === 'staff') {
        delete order.total;
        delete order.deliveryFee;
        delete order.walletAmountRedeemed;
        delete order.rewardPointsRedeemed;
        if (Array.isArray(order.items)) {
          order.items = order.items.map((it: any) => {
            const cleanIt = { ...it };
            delete cleanIt.price;
            delete cleanIt.totalPrice;
            return cleanIt;
          });
        }
      }

      res.json({ success: true, order });
      return;
    }

    if (req.method === 'PATCH' && statusMatch) {
      const caller = authenticateRequest(req);
      if (!caller) {
        res.status(401).json({ success: false, message: 'Unauthorized.' });
        return;
      }

      const { status, reason } = req.body as { status?: OrderStatus; reason?: string };
      if (!status) {
        res.status(400).json({ success: false, message: 'Missing status.' });
        return;
      }
      if (status === 'cancelled' && !reason) {
        res.status(400).json({ success: false, message: 'Cancellation reason is required.' });
        return;
      }

      // Staff cannot cancel orders
      if (status === 'cancelled' && caller.role !== 'admin' && caller.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Forbidden. Staff cannot cancel orders.' });
        return;
      }

      const orderId = decodeURIComponent(statusMatch[1]);

      const processOrderStatusUpdate = (order: any) => {
        const previousStatus = order.status || 'new';
        order.status = status;
        order.statusUpdatedAt = new Date().toISOString();
        order.updatedBy = caller.username;
        if (status === 'cancelled') {
          order.cancelledBy = caller.username;
          order.cancellationReason = reason;
        }
        if (!order.auditTrail) order.auditTrail = [];
        order.auditTrail.push({
          timestamp: new Date().toISOString(),
          updatedBy: caller.username,
          action: `Status changed from ${previousStatus} to ${status}`,
          previousStatus,
          newStatus: status,
          reason: reason || ''
        });
        return order;
      };

      const orderRef = db.collection('orders').doc(orderId);
      const snap = await orderRef.get();
      if (!snap.exists) {
        res.status(404).json({ success: false, message: 'Order not found.' });
        return;
      }
      const order = snap.data();
      const updated = processOrderStatusUpdate(order);
      await orderRef.set(updated, { merge: true });
      if (status === 'cancelled') {
        await logSecurityEvent('ORDER_CANCELLED', caller.username, `Order: ${orderId}, Reason: ${reason}`);
      }

      // Dispatch FCM notifications
      const customerNotifiableStatuses = ['preparing', 'ready', 'out_for_delivery', 'done', 'cancelled'];
      if (customerNotifiableStatuses.includes(status)) {
        const customerId = updated.customerPhone || updated.customerEmail || updated.customerName;
        const eventTypeMap = {
          preparing: 'PREPARING',
          ready: 'READY',
          out_for_delivery: 'OUT_FOR_DELIVERY',
          done: 'DONE',
          cancelled: 'CANCELLED',
        };
        const eventType = eventTypeMap[status];
        if (eventType && customerId) {
          const addData = status === 'cancelled' ? { reason: reason || '' } : undefined;
          void sendNotificationToCustomer(eventType, orderId, customerId, addData).catch((err) =>
            console.error('Error sending customer status FCM:', err)
          );
        }
      }

      if (status === 'cancelled') {
        void sendNotificationToRole('CANCELLED', orderId, 'admin', undefined, { reason: reason || '' }).catch((err) =>
          console.error('Error notifying admin of cancellation:', err)
        );
        if (updated.outletId) {
          void sendNotificationToRole('CANCELLED', orderId, 'manager', updated.outletId, { reason: reason || '' }).catch((err) =>
            console.error('Error notifying manager of cancellation:', err)
          );
        }
      }

      res.json({ success: true });
      return;
    }

    const orderIdMatch = path.match(/^\/orders\/([^/]+)$/);
    if (req.method === 'DELETE' && orderIdMatch) {
      const caller = authenticateRequest(req);
      if (!caller) {
        res.status(401).json({ success: false, message: 'Unauthorized.' });
        return;
      }

      if (caller.role !== 'admin' && caller.role !== 'manager') {
        res.status(403).json({ success: false, message: 'Forbidden. Admin or Manager role required to delete.' });
        return;
      }

      const orderId = decodeURIComponent(orderIdMatch[1]);

      const processOrderSoftDelete = (order: any) => {
        order.isDeleted = true;
        order.deletedBy = caller.username;
        order.deletedAt = new Date().toISOString();
        if (!order.auditTrail) order.auditTrail = [];
        order.auditTrail.push({
          timestamp: new Date().toISOString(),
          updatedBy: caller.username,
          action: 'Order soft deleted'
        });
        return order;
      };





      const orderRef = db.collection('orders').doc(orderId);
      const snap = await orderRef.get();
      if (!snap.exists) {
        res.status(404).json({ success: false, message: 'Order not found.' });
        return;
      }
      const order = snap.data();
      const updated = processOrderSoftDelete(order);
      await orderRef.set(updated, { merge: true });
      await logSecurityEvent('ORDER_DELETED', caller.username, `Soft deleted order: ${orderId}`);
      res.json({ success: true, message: 'Order deleted successfully.' });
      return;
    }


    if (req.method === 'POST' && path === '/notifications/token') {
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

      res.status(201).json({
        success: true,
        message: 'Token registered successfully',
        tokenId: docId,
      });
      return;
    }

    if (req.method === 'GET' && path === '/customers') {




      const snapshot = await db.collection('customers').limit(500).get();
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





      await db.collection('customers').doc(profile.id).set(profile, { merge: true });
      res.status(201).json({ success: true, customer: profile });
      return;
    }

    const verifyMatch = path.match(/^\/customers\/([^/]+)\/verify$/);
    if (req.method === 'PATCH' && verifyMatch) {
      const customerId = decodeURIComponent(verifyMatch[1]);





      const docRef = db.collection('customers').doc(customerId);
      const snap = await docRef.get();
      if (!snap.exists) {
        res.status(404).json({ success: false, message: 'Customer not found.' });
        return;
      }
      const customerData = snap.data() as CustomerProfile;

      const allCustomersSnap = await db.collection('customers').where('verified', '==', true).get();
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
