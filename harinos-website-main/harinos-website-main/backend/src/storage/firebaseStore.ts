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

export const firebaseStore: OrderStore = {
  name: 'firebase',

  async getOrders() {
    const snapshot = await withTimeout(
      getFirestore().collection('orders').orderBy('receivedAt', 'desc').get(),
      'Fetching orders from Firebase',
    );
    return newestOrdersFirst(snapshot.docs.map((doc) => doc.data() as FullOrderPayload));
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
  },

  async updateOrderStatus(orderId: string, status: OrderStatus) {
    await withTimeout(
      getFirestore().collection('orders').doc(orderId).set({ status }, { merge: true }),
      'Updating order status in Firebase',
    );
  },

  async getCustomers() {
    const snapshot = await withTimeout(
      getFirestore().collection('customers').get(),
      'Fetching customers from Firebase',
    );
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
    if (!snap.exists) return null;
    return snap.data() as CustomerProfile;
  },

  async saveCustomer(profile) {
    await withTimeout(
      getFirestore().collection('customers').doc(profile.id).set(profile, { merge: true }),
      'Saving customer to Firebase',
    );
  },

  async verifyCustomer(customerId) {
    const ref = getFirestore().collection('customers').doc(customerId);
    const snap = await withTimeout(ref.get(), 'Reading customer from Firebase');
    if (!snap.exists) return null;
    const customerData = snap.data() as CustomerProfile;

    const allCustomersSnap = await withTimeout(
      getFirestore().collection('customers').where('verified', '==', true).get(),
      'Checking verified customers'
    );
    const cleanPhone = (p: string) => p.replace(/\D/g, '');
    const targetPhone = cleanPhone(customerData.phone);
    const alreadyVerified = allCustomersSnap.docs.some((doc) => {
      const data = doc.data() as CustomerProfile;
      return data.id !== customerId && data.phone && cleanPhone(data.phone) === targetPhone;
    });

    if (alreadyVerified) {
      throw new Error('This phone number is already verified under another profile.');
    }

    const generateReferralCode = () => {
      return Math.floor(65536 + Math.random() * 983039).toString(16).toUpperCase();
    };
    const referralCode = customerData.referralCode ?? generateReferralCode();

    const customer = { ...customerData, verified: true, referralCode };
    await withTimeout(ref.set(customer, { merge: true }), 'Verifying customer in Firebase');
    return customer;
  },

  async getMenuItems() {
    const snapshot = await withTimeout(
      getFirestore().collection('menu_items').get(),
      'Fetching menu items from Firebase',
    );
    return snapshot.docs.map((doc) => doc.data() as MenuItem);
  },

  async saveMenuItem(item) {
    await withTimeout(
      getFirestore().collection('menu_items').doc(item.id).set(item, { merge: true }),
      'Saving menu item to Firebase',
    );
  },

  async getOutlets() {
    const snapshot = await withTimeout(
      getFirestore().collection('outlets').get(),
      'Fetching outlets from Firebase',
    );
    return snapshot.docs.map((doc) => doc.data() as OutletConfig);
  },

  async saveOutlet(outlet) {
    await withTimeout(
      getFirestore().collection('outlets').doc(outlet.id).set(outlet, { merge: true }),
      'Saving outlet to Firebase',
    );
  },

  async getOffers() {
    const snapshot = await withTimeout(
      getFirestore().collection('offers').get(),
      'Fetching offers from Firebase',
    );
    return snapshot.docs.map((doc) => doc.data() as OfferCard);
  },

  async saveOffer(offer) {
    await withTimeout(
      getFirestore().collection('offers').doc(offer.id).set(offer, { merge: true }),
      'Saving offer to Firebase',
    );
  },

  async getStaffUsers() {
    const snapshot = await withTimeout(
      getFirestore().collection('users').get(),
      'Fetching staff users from Firebase',
    );
    return snapshot.docs.map((doc) => doc.data() as AdminUser);
  },

  async saveStaffUser(user) {
    await withTimeout(
      getFirestore().collection('users').doc(user.username).set(user, { merge: true }),
      'Saving staff user to Firebase',
    );
  },

  async getWalletTransactions() {
    const snapshot = await withTimeout(
      getFirestore().collection('wallet_transactions').orderBy('createdAt', 'desc').get(),
      'Fetching transactions from Firebase',
    );
    return snapshot.docs.map((doc) => doc.data() as WalletTransaction);
  },

  async saveWalletTransaction(transaction) {
    await withTimeout(
      getFirestore().collection('wallet_transactions').doc(transaction.id).set(transaction, { merge: true }),
      'Saving transaction to Firebase',
    );
  },

  async getSettings() {
    const doc = await withTimeout(
      getFirestore().collection('settings').doc('app').get(),
      'Fetching settings from Firebase',
    );
    if (!doc.exists) return {};
    return doc.data() as AppSettings;
  },

  async saveSettings(settings) {
    await withTimeout(
      getFirestore().collection('settings').doc('app').set(settings, { merge: true }),
      'Saving settings to Firebase',
    );
  },
};


