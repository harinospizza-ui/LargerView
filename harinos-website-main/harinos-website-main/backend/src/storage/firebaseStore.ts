import admin from 'firebase-admin';
import { config } from '../config.js';
import { CustomerProfile, FullOrderPayload, OrderStatus, MenuItem, OutletConfig, OfferCard, AdminUser, WalletTransaction, AppSettings } from '../types.js';

import { OrderStore, newestOrdersFirst } from './store.js';

let firestore: admin.firestore.Firestore | null = null;

const withTimeout = async <T,>(operation: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out. Confirm Firestore is enabled for project ${config.firebase.projectId}.`));
    }, 10000);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const getFirestore = (): admin.firestore.Firestore => {
  if (!firestore) {
    if (!admin.apps.length) {
      if (!config.firebase.serviceAccount) {
        throw new Error('Firebase storage selected, but FIREBASE_SERVICE_ACCOUNT_BASE64 or FIREBASE_SERVICE_ACCOUNT_JSON is missing.');
      }

      admin.initializeApp({
        credential: admin.credential.cert(config.firebase.serviceAccount as admin.ServiceAccount),
        projectId: config.firebase.projectId || undefined,
      });
    }

    firestore = admin.firestore();
  }

  return firestore;
};

const trackUsage = async (stats: {
  reads?: number;
  writes?: number;
  deletes?: number;
  ordersReads?: number;
  customersReads?: number;
  walletReads?: number;
  menuReads?: number;
  otherReads?: number;
}) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const db = getFirestore();
    const docRef = db.collection('firestore_usage').doc(today);

    const updates: any = {
      timestamp: new Date().toISOString()
    };

    if (stats.reads) updates.reads = admin.firestore.FieldValue.increment(stats.reads);
    if (stats.writes) updates.writes = admin.firestore.FieldValue.increment(stats.writes);
    if (stats.deletes) updates.deletes = admin.firestore.FieldValue.increment(stats.deletes);
    if (stats.ordersReads) updates.ordersReads = admin.firestore.FieldValue.increment(stats.ordersReads);
    if (stats.customersReads) updates.customersReads = admin.firestore.FieldValue.increment(stats.customersReads);
    if (stats.walletReads) updates.walletReads = admin.firestore.FieldValue.increment(stats.walletReads);
    if (stats.menuReads) updates.menuReads = admin.firestore.FieldValue.increment(stats.menuReads);
    if (stats.otherReads) updates.otherReads = admin.firestore.FieldValue.increment(stats.otherReads);

    await docRef.set(updates, { merge: true });
  } catch (err) {
    console.error('Failed to log Firestore usage in store:', err);
  }
};

export const firebaseStore: OrderStore = {
  name: 'firebase',

  async getOrders(options?: { role?: string; outletId?: string; limit?: number; lastVisible?: string }) {
    let queryRef: admin.firestore.Query = getFirestore().collection('orders');
    if (options?.role === 'staff') {
      queryRef = queryRef.where('status', 'in', ['new', 'preparing', 'ready', 'out_for_delivery']);
    } else {
      queryRef = queryRef.orderBy('receivedAt', 'desc');
    }

    const limitVal = options?.limit ?? 50;
    queryRef = queryRef.limit(limitVal);

    let readsCount = 0;

    if (options?.lastVisible && options?.role !== 'staff') {
      const docSnap = await withTimeout(
        getFirestore().collection('orders').doc(decodeURIComponent(options.lastVisible)).get(),
        'Reading cursor document from Firebase'
      );
      readsCount += 1;
      if (docSnap.exists) {
        queryRef = queryRef.startAfter(docSnap);
      }
    }

    const snapshot = await withTimeout(
      queryRef.get(),
      'Fetching orders from Firebase',
    );
    readsCount += snapshot.size;

    await trackUsage({ reads: readsCount, ordersReads: readsCount });

    let list = snapshot.docs.map((doc) => doc.data() as FullOrderPayload);

    if (options?.role === 'staff') {
      list = list.filter(o => !o.isDeleted && (options.outletId ? o.outletId === options.outletId : true));
      list.sort((a, b) => {
        const timeA = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
        const timeB = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
        return timeB - timeA;
      });
    } else if (options?.role === 'manager') {
      list = list.filter(o => !o.isDeleted);
    }

    return list;
  },

  async saveOrder(order) {
    const nextOrder: FullOrderPayload = {
      ...order,
      receivedAt: order.receivedAt ?? new Date().toISOString(),
      status: order.status ?? 'new',
    };
    await withTimeout(
      getFirestore().collection('orders').doc(nextOrder.id).set(nextOrder, { merge: true }),
      'Saving order to Firebase',
    );
    await trackUsage({ writes: 1 });
  },

  async updateOrderStatus(orderId: string, status: OrderStatus) {
    await withTimeout(
      getFirestore().collection('orders').doc(orderId).set({ status }, { merge: true }),
      'Updating order status in Firebase',
    );
    await trackUsage({ writes: 1 });
  },

  async getCustomers() {
    const snapshot = await withTimeout(
      getFirestore().collection('customers').get(),
      'Fetching customers from Firebase',
    );
    await trackUsage({ reads: snapshot.size, customersReads: snapshot.size });
    const list = snapshot.docs.map((doc) => doc.data() as CustomerProfile);
    return list.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });
  },

  async getCustomer(customerId) {
    const docRef = getFirestore().collection('customers').doc(customerId);
    const snap = await withTimeout(docRef.get(), 'Fetching single customer from Firebase');
    await trackUsage({ reads: 1, customersReads: 1 });
    if (!snap.exists) return null;
    return snap.data() as CustomerProfile;
  },

  async saveCustomer(profile) {
    await withTimeout(
      getFirestore().collection('customers').doc(profile.id).set(profile, { merge: true }),
      'Saving customer to Firebase',
    );
    await trackUsage({ writes: 1 });
  },

  async verifyCustomer(customerId) {
    const ref = getFirestore().collection('customers').doc(customerId);
    const snap = await withTimeout(ref.get(), 'Reading customer from Firebase');
    if (!snap.exists) {
      await trackUsage({ reads: 1, customersReads: 1 });
      return null;
    }
    const customerData = snap.data() as CustomerProfile;

    const cleanPhone = (p: string) => p.replace(/\D/g, '');
    const targetPhone = cleanPhone(customerData.phone);

    // Optimized phone query instead of reading entire collection
    const phoneQuerySnap = await withTimeout(
      getFirestore().collection('customers')
        .where('phone', '==', customerData.phone)
        .where('verified', '==', true)
        .get(),
      'Checking verified customers by raw phone'
    );

    const cleanPhoneQuerySnap = await withTimeout(
      getFirestore().collection('customers')
        .where('phone', '==', targetPhone)
        .where('verified', '==', true)
        .get(),
      'Checking verified customers by clean phone'
    );

    const combinedDocs = [...phoneQuerySnap.docs, ...cleanPhoneQuerySnap.docs];
    const alreadyVerified = combinedDocs.some((doc) => {
      const data = doc.data() as CustomerProfile;
      return data.id !== customerId && data.phone && cleanPhone(data.phone) === targetPhone;
    });

    const readsCount = 1 + phoneQuerySnap.size + cleanPhoneQuerySnap.size;

    if (alreadyVerified) {
      await trackUsage({ reads: readsCount, customersReads: readsCount });
      throw new Error('This phone number is already verified under another profile.');
    }

    const generateReferralCode = () => {
      return Math.floor(65536 + Math.random() * 983039).toString(16).toUpperCase();
    };
    const referralCode = customerData.referralCode ?? generateReferralCode();

    const customer = { ...customerData, verified: true, referralCode };
    await withTimeout(ref.set(customer, { merge: true }), 'Verifying customer in Firebase');
    await trackUsage({ reads: readsCount, writes: 1, customersReads: readsCount });
    return customer;
  },

  async getMenuItems() {
    const snapshot = await withTimeout(
      getFirestore().collection('menu_items').get(),
      'Fetching menu items from Firebase',
    );
    await trackUsage({ reads: snapshot.size, menuReads: snapshot.size });
    return snapshot.docs.map((doc) => doc.data() as MenuItem);
  },

  async saveMenuItem(item) {
    await withTimeout(
      getFirestore().collection('menu_items').doc(item.id).set(item, { merge: true }),
      'Saving menu item to Firebase',
    );
    await withTimeout(
      getFirestore().collection('settings').doc('app').set({ menuVersion: Date.now().toString() }, { merge: true }),
      'Saving settings in Firebase',
    );
    await trackUsage({ writes: 2 });
  },

  async getOutlets() {
    const snapshot = await withTimeout(
      getFirestore().collection('outlets').get(),
      'Fetching outlets from Firebase',
    );
    await trackUsage({ reads: snapshot.size, otherReads: snapshot.size });
    return snapshot.docs.map((doc) => doc.data() as OutletConfig);
  },

  async saveOutlet(outlet) {
    await withTimeout(
      getFirestore().collection('outlets').doc(outlet.id).set(outlet, { merge: true }),
      'Saving outlet to Firebase',
    );
    await withTimeout(
      getFirestore().collection('settings').doc('app').set({ menuVersion: Date.now().toString() }, { merge: true }),
      'Saving settings in Firebase',
    );
    await trackUsage({ writes: 2 });
  },

  async getOffers() {
    const snapshot = await withTimeout(
      getFirestore().collection('offers').get(),
      'Fetching offers from Firebase',
    );
    await trackUsage({ reads: snapshot.size, otherReads: snapshot.size });
    return snapshot.docs.map((doc) => doc.data() as OfferCard);
  },

  async saveOffer(offer) {
    await withTimeout(
      getFirestore().collection('offers').doc(offer.id).set(offer, { merge: true }),
      'Saving offer to Firebase',
    );
    await withTimeout(
      getFirestore().collection('settings').doc('app').set({ menuVersion: Date.now().toString() }, { merge: true }),
      'Saving settings in Firebase',
    );
    await trackUsage({ writes: 2 });
  },

  async getStaffUsers() {
    const snapshot = await withTimeout(
      getFirestore().collection('users').get(),
      'Fetching staff users from Firebase',
    );
    await trackUsage({ reads: snapshot.size, otherReads: snapshot.size });
    return snapshot.docs.map((doc) => doc.data() as AdminUser);
  },

  async saveStaffUser(user) {
    await withTimeout(
      getFirestore().collection('users').doc(user.username).set(user, { merge: true }),
      'Saving staff user to Firebase',
    );
    await trackUsage({ writes: 1 });
  },

  async getWalletTransactions() {
    const snapshot = await withTimeout(
      getFirestore().collection('wallet_transactions').orderBy('createdAt', 'desc').get(),
      'Fetching transactions from Firebase',
    );
    await trackUsage({ reads: snapshot.size, walletReads: snapshot.size });
    return snapshot.docs.map((doc) => doc.data() as WalletTransaction);
  },

  async saveWalletTransaction(transaction) {
    await withTimeout(
      getFirestore().collection('wallet_transactions').doc(transaction.id).set(transaction, { merge: true }),
      'Saving transaction to Firebase',
    );
    await trackUsage({ writes: 1 });
  },

  async getSettings() {
    const doc = await withTimeout(
      getFirestore().collection('settings').doc('app').get(),
      'Fetching settings from Firebase',
    );
    await trackUsage({ reads: 1, otherReads: 1 });
    if (!doc.exists) return {};
    return doc.data() as AppSettings;
  },

  async saveSettings(settings) {
    await withTimeout(
      getFirestore().collection('settings').doc('app').set(settings, { merge: true }),
      'Saving settings to Firebase',
    );
    await trackUsage({ writes: 1 });
  },
};
