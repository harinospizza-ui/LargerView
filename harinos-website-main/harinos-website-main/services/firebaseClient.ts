import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getMessaging } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY ?? '').trim(),
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim(),
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '').trim(),
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '').trim(),
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '').trim(),
  appId: (import.meta.env.VITE_FIREBASE_APP_ID ?? '').trim(),
};

export const FIRESTORE_ORDERS_COLLECTION = 'orders';
export const FIRESTORE_CUSTOMERS_COLLECTION = 'customers';
export const FIRESTORE_NOTIFICATION_TOKENS_COLLECTION = 'notification_tokens';
export const FIRESTORE_MENU_ITEMS_COLLECTION = 'menu_items';
export const FIRESTORE_OUTLETS_COLLECTION = 'outlets';
export const FIRESTORE_OFFERS_COLLECTION = 'offers';
export const FIRESTORE_STAFF_USERS_COLLECTION = 'staff_users';
export const FIRESTORE_WALLET_TRANSACTIONS_COLLECTION = 'wallet_transactions';


export const isFirebaseClientConfigured = (): boolean =>
  Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);

export const getFirebaseApp = (): FirebaseApp => {
  if (!isFirebaseClientConfigured()) {
    throw new Error('Firebase client is not configured. Add VITE_FIREBASE_* environment variables in Vercel.');
  }

  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
};

export const db = () => getFirestore(getFirebaseApp());
