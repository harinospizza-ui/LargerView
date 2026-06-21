import admin from 'firebase-admin';

export const trackUsage = async (stats: {
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
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    
    if (!admin.apps.length) {
      let serviceAccount: admin.ServiceAccount;
      if (encoded) {
        serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as admin.ServiceAccount;
      } else if (raw) {
        serviceAccount = JSON.parse(raw) as admin.ServiceAccount;
      } else {
        throw new Error('Missing service account credentials.');
      }
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID || 'harinos-12902',
      });
    }

    const db = admin.firestore();
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
    console.error('Failed to log Firestore usage:', err);
  }
};
