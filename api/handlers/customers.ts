import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import { verifyToken } from './cryptoUtils.js';
import { trackUsage } from './firestoreUsage.js';
import { validateSession } from './sessionUtils.js';

const getJWTSecret = (): string => {
  return process.env.JWT_SECRET || 'dev-harinos-pizza-secret-key-32-chars-minimum';
};

const authenticateRequest = (req: VercelRequest): any => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  return verifyToken(token, getJWTSecret());
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

const sanitizeCustomer = (customer: any) => {
  if (!customer) return customer;
  const sanitized = { ...customer };
  delete sanitized.otp;
  delete sanitized.otpExpiry;
  return sanitized;
};

const checkBusinessHours = (): boolean => {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const ist = new Date(utc + (3600000 * 5.5)); // IST is UTC + 5.5
  const hours = ist.getHours();
  return hours >= 11 && hours < 21;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { customerId, action } = req.query as { customerId?: string; action?: string };

  try {
    const db = getFirestore();

    const sessionCheck = await validateSession(req, res, db);
    if (!sessionCheck.success) return;

    // 1. PATCH verification (/api/customers/:customerId/verify)
    if (req.method === 'PATCH' && customerId && action === 'verify') {
      const docRef = db.collection('customers').doc(decodeURIComponent(customerId));
      const snap = await docRef.get();
      if (!snap.exists) {
        res.status(404).json({ success: false, message: 'Customer profile missing' });
        return;
      }
      const customerData = snap.data() as any;

      const caller = authenticateRequest(req);
      const isStaff = caller && (caller.role === 'admin' || caller.role === 'manager');

      if (!isStaff) {
        res.status(403).json({ success: false, message: 'Forbidden. Admin or Manager role required.' });
        return;
      }

      const cleanPhone = (p: string) => p.replace(/\D/g, '');
      const targetPhone = cleanPhone(customerData.phone);

      // Optimized query: search verified customers with the same raw phone number
      const phoneQuerySnap = await db.collection('customers')
        .where('phone', '==', customerData.phone)
        .where('verified', '==', true)
        .get();

      const cleanPhoneQuerySnap = await db.collection('customers')
        .where('phone', '==', targetPhone)
        .where('verified', '==', true)
        .get();

      const combinedDocs = [...phoneQuerySnap.docs, ...cleanPhoneQuerySnap.docs];
      const alreadyVerified = combinedDocs.some(docDoc => {
        const data = docDoc.data() as any;
        return data.id !== customerId && data.phone && cleanPhone(data.phone) === targetPhone;
      });

      const readsCount = 1 + phoneQuerySnap.size + cleanPhoneQuerySnap.size;

      if (alreadyVerified) {
        await trackUsage({ reads: readsCount, customersReads: readsCount });
        res.status(400).json({ success: false, message: 'This phone number is already verified under another profile.' });
        return;
      }

      const generateReferralCode = () => {
        return Math.floor(65536 + Math.random() * 983039).toString(16).toUpperCase();
      };
      const referralCode = customerData.referralCode ?? generateReferralCode();

      const customer = {
        ...customerData,
        verified: true,
        referralCode,
        otp: admin.firestore.FieldValue.delete(),
        otpExpiry: admin.firestore.FieldValue.delete()
      };

      await docRef.set(customer, { merge: true });

      // Mark associated verification requests as verified
      const reqSnap = await db.collection('customerVerificationRequests')
        .where('mobileNumber', '==', customerData.phone)
        .where('status', '==', 'pending')
        .get();

      const batch = db.batch();
      reqSnap.docs.forEach(docDoc => {
        batch.update(docDoc.ref, {
          status: 'verified',
          verifiedAt: new Date().toISOString(),
          verifiedBy: caller.username || 'Admin_Harinos'
        });
      });
      await batch.commit();

      const totalWrites = 1 + reqSnap.size;
      await trackUsage({ reads: readsCount + reqSnap.size, writes: totalWrites, customersReads: readsCount });
      
      const responseCustomer = { ...customer };
      delete responseCustomer.otp;
      delete responseCustomer.otpExpiry;

      res.json({ success: true, customer: responseCustomer });
      return;
    }

    // 2. GET single customer, search by phone, all customers, or usage stats (/api/customers)
    if (req.method === 'GET') {
      const { customerId, phone } = req.query as { customerId?: string; phone?: string };

      // 2a. Action usage check (Admin only)
      if (action === 'usage') {
        const caller = authenticateRequest(req);
        if (!caller || caller.role !== 'admin') {
          res.status(403).json({ success: false, message: 'Forbidden. Admin access required.' });
          return;
        }
        const snapshot = await db.collection('firestore_usage').get();
        const usageData = snapshot.docs.map(doc => ({
          date: doc.id,
          ...doc.data()
        }));
        usageData.sort((a, b) => b.date.localeCompare(a.date));
        res.json({ success: true, usage: usageData });
        return;
      }

      if (customerId) {
        const docRef = db.collection('customers').doc(decodeURIComponent(customerId));
        const snap = await docRef.get();
        await trackUsage({ reads: 1, customersReads: 1 });
        if (!snap.exists) {
          res.status(404).json({ success: false, message: 'Customer profile missing' });
          return;
        }
        res.json({ success: true, customer: sanitizeCustomer(snap.data()) });
        return;
      }

      if (phone) {
        const rawPhone = decodeURIComponent(phone);
        const cleanPhone = (p: string) => p.replace(/\D/g, '');
        const targetPhoneDigits = cleanPhone(rawPhone);

        let querySnap = await db.collection('customers').where('phone', '==', rawPhone).get();
        let totalReads = querySnap.size || 1;
        
        if (querySnap.empty && targetPhoneDigits && targetPhoneDigits !== rawPhone) {
          querySnap = await db.collection('customers').where('phone', '==', targetPhoneDigits).get();
          totalReads += querySnap.size || 1;
        }

        if (querySnap.empty) {
          // fallback scan
          const snapshot = await db.collection('customers').limit(500).get();
          totalReads += snapshot.size;
          await trackUsage({ reads: totalReads, customersReads: totalReads });
          const match = snapshot.docs.find(doc => {
            const data = doc.data() as any;
            return data.phone && cleanPhone(data.phone) === targetPhoneDigits;
          });
          if (match) {
            res.json({ success: true, customer: sanitizeCustomer(match.data()) });
            return;
          }
          res.json({ success: true, customer: null });
          return;
        }

        await trackUsage({ reads: totalReads, customersReads: totalReads });
        res.json({ success: true, customer: sanitizeCustomer(querySnap.docs[0].data()) });
        return;
      }

      // Restrict GET all customers to Admin / Manager
      const caller = authenticateRequest(req);
      if (!caller || (caller.role !== 'admin' && caller.role !== 'manager')) {
        res.status(403).json({ success: false, message: 'Forbidden. Admin or Manager role required.' });
        return;
      }

      const snapshot = await db.collection('customers').limit(500).get();
      await trackUsage({ reads: snapshot.size, customersReads: snapshot.size });
      const list = snapshot.docs.map((doc) => sanitizeCustomer(doc.data()));
      list.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      });
      res.json({ success: true, customers: list });
      return;
    }

    // 3. POST save customer or auth actions (/api/customers)
    if (req.method === 'POST') {
      const { action } = req.query as { action?: string };



      if (action === 'block') {
        const caller = authenticateRequest(req);
        if (!caller || (caller.role !== 'admin' && caller.role !== 'manager')) {
          res.status(403).json({ success: false, message: 'Forbidden. Admin/Manager role required.' });
          return;
        }
        const { customerId, blocked } = req.body as { customerId?: string; blocked?: boolean };
        if (!customerId) {
          res.status(400).json({ success: false, message: 'Missing customerId.' });
          return;
        }
        const docRef = db.collection('customers').doc(decodeURIComponent(customerId));
        const snap = await docRef.get();
        if (!snap.exists) {
          res.status(404).json({ success: false, message: 'Customer not found.' });
          return;
        }
        const customerData = snap.data() as any;
        const cleanPhone = (p: string) => p.replace(/\D/g, '');
        const targetPhone = cleanPhone(customerData.phone);
        
        const blockedRef = db.collection('blocked_customers').doc(targetPhone);
        
        let writeCount = 1;
        if (blocked) {
          await docRef.set({ status: 'blocked' }, { merge: true });
          await blockedRef.set({
            phone: targetPhone,
            blockedAt: new Date().toISOString(),
            customerId: customerData.id,
            name: customerData.name
          });
          writeCount++;
        } else {
          await docRef.set({ status: 'active' }, { merge: true });
          await blockedRef.delete();
          writeCount++;
        }
        
        await trackUsage({ reads: 1, writes: writeCount, customersReads: 1 });
        res.json({ success: true });
        return;
      }

      if (action === 'bulk-remove') {
        const caller = authenticateRequest(req);
        if (!caller || (caller.role !== 'admin' && caller.role !== 'manager')) {
          res.status(403).json({ success: false, message: 'Forbidden. Admin/Manager role required.' });
          return;
        }
        const { customerIds } = req.body as { customerIds?: string[] };
        if (!Array.isArray(customerIds) || customerIds.length === 0) {
          res.status(400).json({ success: false, message: 'Missing or invalid customerIds array.' });
          return;
        }

        const batch = db.batch();
        const cleanPhone = (p: string) => p.replace(/\D/g, '');

        let readsCount = 0;
        for (const cid of customerIds) {
          const docRef = db.collection('customers').doc(cid);
          const snap = await docRef.get();
          readsCount++;
          if (snap.exists) {
            const data = snap.data() as any;
            const targetPhone = cleanPhone(data.phone);
            
            batch.delete(docRef);
            
            const blockedRef = db.collection('blocked_customers').doc(targetPhone);
            batch.set(blockedRef, {
              phone: targetPhone,
              blockedAt: new Date().toISOString(),
              customerId: cid,
              name: data.name
            });
          }
        }

        await batch.commit();
        await trackUsage({ reads: readsCount, writes: customerIds.length * 2, customersReads: readsCount });
        res.json({ success: true, message: 'Customers deleted and blocked successfully.' });
        return;
      }

      if (action === 'merge') {
        const caller = authenticateRequest(req);
        if (!caller || (caller.role !== 'admin' && caller.role !== 'manager')) {
          res.status(403).json({ success: false, message: 'Forbidden. Admin/Manager role required.' });
          return;
        }
        const { primaryCustomerId, secondaryCustomerId, primaryId, secondaryId } = req.body as any;
        const pId = primaryCustomerId || primaryId;
        const sId = secondaryCustomerId || secondaryId;
        if (!pId || !sId) {
          res.status(400).json({ success: false, message: 'Missing primaryCustomerId or secondaryCustomerId.' });
          return;
        }
        if (pId === sId) {
          res.status(400).json({ success: false, message: 'Primary and secondary profiles cannot be the same.' });
          return;
        }

        const primaryRef = db.collection('customers').doc(pId);
        const secondaryRef = db.collection('customers').doc(sId);

        await db.runTransaction(async (transaction) => {
          const primarySnap = await transaction.get(primaryRef);
          const secondarySnap = await transaction.get(secondaryRef);

          if (!primarySnap.exists) {
            throw new Error('Primary customer not found.');
          }
          if (!secondarySnap.exists) {
            throw new Error('Secondary customer not found.');
          }

          const primaryData = primarySnap.data() as any;
          const secondaryData = secondarySnap.data() as any;

          const mergedBalance = (primaryData.walletBalance || 0) + (secondaryData.walletBalance || 0);
          const mergedPoints = (primaryData.rewardPoints || 0) + (secondaryData.rewardPoints || 0);

          transaction.update(primaryRef, {
            walletBalance: mergedBalance,
            rewardPoints: mergedPoints
          });

          transaction.delete(secondaryRef);

          const txId = `tx_merge_${Date.now()}`;
          const txRef = db.collection('wallet_transactions').doc(txId);
          transaction.set(txRef, {
            id: txId,
            customerId: pId,
            customerName: primaryData.name,
            customerPhone: primaryData.phone,
            amount: secondaryData.walletBalance || 0,
            type: 'merge',
            status: 'completed',
            createdAt: new Date().toISOString(),
            description: `Merged profile ${sId} (${secondaryData.phone}). Transferred Rs ${secondaryData.walletBalance || 0} and ${secondaryData.rewardPoints || 0} points.`
          });
        });

        await trackUsage({ reads: 3, writes: 3, customersReads: 2 });
        res.json({ success: true, message: 'Profiles merged successfully.' });
        return;
      }

      if (action === 'register') {
        if (!checkBusinessHours()) {
          res.status(403).json({
            success: false,
            message: "Harino's online ordering is available between 11:00 AM and 9:00 PM."
          });
          return;
        }

        const { phone, name } = req.body as { phone: string; name: string };
        if (!phone || !name) {
          res.status(400).json({ success: false, message: 'Name and phone number are required.' });
          return;
        }

        const cleanPhone = (p: string) => p.replace(/\D/g, '');
        const targetPhone = cleanPhone(phone);

        // Check if phone is blocked
        const blockedRef = db.collection('blocked_customers').doc(targetPhone);
        const blockedSnap = await blockedRef.get();
        if (blockedSnap.exists) {
          await trackUsage({ reads: 1 });
          res.status(403).json({ success: false, message: 'This mobile number is permanently blocked.' });
          return;
        }

        // Check if customer already exists
        const existingQuery = await db.collection('customers').where('phone', '==', phone).get();
        if (!existingQuery.empty) {
          await trackUsage({ reads: existingQuery.size });
          res.status(400).json({ success: false, message: 'This phone number is already registered. Please login instead.' });
          return;
        }

        const customerId = `cust_${Date.now()}`;
        const referralCode = Math.floor(65536 + Math.random() * 983039).toString(16).toUpperCase();
        const nowStr = new Date().toISOString();

        const newCustomer = {
          id: customerId,
          customerId: customerId,
          name: name.trim(),
          fullName: name.trim(),
          phone: phone,
          mobileNumber: phone,
          email: '',
          loginMethod: 'phone',
          verified: false,
          walletBalance: 0,
          loyaltyPoints: 0,
          rewardPoints: 0,
          active: true,
          status: 'active',
          createdAt: nowStr,
          lastLogin: nowStr,
          referralAttemptsRemaining: 3,
          referralCodeUsed: false,
          referralLocked: false,
          referralCode
        };

        // Write customer profile immediately
        await db.collection('customers').doc(customerId).set(newCustomer);

        // Generate initial verification request
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const requestId = `req_${Date.now()}`;
        await db.collection('customerVerificationRequests').doc(requestId).set({
          requestId,
          customerId,
          customerName: name.trim(),
          mobileNumber: phone,
          otp,
          status: 'pending',
          createdAt: nowStr,
          verifiedAt: null,
          verifiedBy: null
        });

        await trackUsage({ reads: existingQuery.size + 1, writes: 2 });

        res.json({
          success: true,
          customer: newCustomer,
          requestId,
          message: 'Account created successfully!'
        });
        return;
      }

      if (action === 'login-init') {
        if (!checkBusinessHours()) {
          res.status(403).json({
            success: false,
            message: "Harino's online ordering is available between 11:00 AM and 9:00 PM."
          });
          return;
        }

        const { phone } = req.body as { phone: string };
        if (!phone) {
          res.status(400).json({ success: false, message: 'Phone number is required.' });
          return;
        }

        const cleanPhone = (p: string) => p.replace(/\D/g, '');
        const targetPhone = cleanPhone(phone);

        // Check if phone is blocked
        const blockedRef = db.collection('blocked_customers').doc(targetPhone);
        const blockedSnap = await blockedRef.get();
        if (blockedSnap.exists) {
          await trackUsage({ reads: 1 });
          res.status(403).json({ success: false, message: 'Account disabled' });
          return;
        }

        // Search for existing customer
        let existingCustomer: any = null;
        let querySnap = await db.collection('customers').where('phone', '==', phone).get();
        let totalReads = 1 + (querySnap.size || 1);
        if (querySnap.empty && targetPhone !== phone) {
          querySnap = await db.collection('customers').where('phone', '==', targetPhone).get();
          totalReads += querySnap.size || 1;
        }

        if (!querySnap.empty) {
          existingCustomer = querySnap.docs[0].data();
        } else {
          // fallback scan
          const snapshot = await db.collection('customers').limit(500).get();
          totalReads += snapshot.size;
          const match = snapshot.docs.find(doc => {
            const data = doc.data() as any;
            return data.phone && cleanPhone(data.phone) === targetPhone;
          });
          if (match) {
            existingCustomer = match.data();
          }
        }

        if (!existingCustomer) {
          await trackUsage({ reads: totalReads });
          res.status(404).json({ success: false, message: 'User not found' });
          return;
        }

        if (existingCustomer.active === false || existingCustomer.status === 'blocked') {
          await trackUsage({ reads: totalReads });
          res.status(403).json({ success: false, message: 'Account disabled' });
          return;
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const requestId = `req_${Date.now()}`;

        // Store verification request in Firestore
        try {
          const requestDocRef = db.collection('customerVerificationRequests').doc(requestId);
          await requestDocRef.set({
            requestId,
            customerId: existingCustomer.customerId || existingCustomer.id,
            customerName: existingCustomer.fullName || existingCustomer.name || 'Customer',
            mobileNumber: phone,
            otp,
            status: 'pending',
            createdAt: new Date().toISOString(),
            verifiedAt: null,
            verifiedBy: null
          });
        } catch (err: any) {
          console.error('Firestore write error for verification request:', err);
          const isPermissionDenied = err.code === 7 || err.message?.toLowerCase().includes('permission');
          res.status(500).json({
            success: false,
            message: isPermissionDenied ? 'Firestore permission denied' : 'Verification failed'
          });
          return;
        }

        await trackUsage({ reads: totalReads, writes: 1 });

        res.json({
          success: true,
          requestId,
          message: 'Verification request submitted. Please wait while we verify your number.'
        });
        return;
      }

      if (action === 'login-verify') {
        if (!checkBusinessHours()) {
          res.status(403).json({
            success: false,
            message: "Harino's online ordering is available between 11:00 AM and 9:00 PM."
          });
          return;
        }

        const { requestId, otp } = req.body as { requestId: string; otp: string };
        if (!requestId || !otp) {
          res.status(400).json({ success: false, message: 'Request ID and OTP are required.' });
          return;
        }

        const requestDocRef = db.collection('customerVerificationRequests').doc(requestId);
        const requestSnap = await requestDocRef.get();
        if (!requestSnap.exists) {
          await trackUsage({ reads: 1 });
          res.status(404).json({ success: false, message: 'Verification failed' });
          return;
        }

        const verificationRequest = requestSnap.data() as any;
        if (verificationRequest.otp !== otp) {
          await trackUsage({ reads: 1 });
          res.status(400).json({ success: false, message: 'Verification failed' });
          return;
        }

        // OTP matches: mark request verified
        await requestDocRef.update({
          status: 'verified',
          verifiedAt: new Date().toISOString(),
          verifiedBy: 'customer'
        });

        const customerId = verificationRequest.customerId;
        const customerRef = db.collection('customers').doc(customerId);
        const customerSnap = await customerRef.get();

        if (!customerSnap.exists) {
          await trackUsage({ reads: 2, writes: 1 });
          res.status(404).json({ success: false, message: 'User not found' });
          return;
        }

        const customerData = customerSnap.data() as any;
        if (customerData.active === false || customerData.status === 'blocked') {
          await trackUsage({ reads: 2, writes: 1 });
          res.status(403).json({ success: false, message: 'Account disabled' });
          return;
        }

        const responseCustomer = {
          ...customerData,
          verified: true,
          lastLogin: new Date().toISOString(),
          otp: admin.firestore.FieldValue.delete(),
          otpExpiry: admin.firestore.FieldValue.delete()
        };

        await customerRef.set(responseCustomer, { merge: true });
        await trackUsage({ reads: 2, writes: 2 });

        res.json({
          success: true,
          customer: responseCustomer
        });
        return;
      }

      // Default: save customer profile (existing POST logic)
      const profile = req.body as any;
      if (!profile.id || !profile.name || !profile.phone) {
        res.status(400).json({ success: false, message: 'Invalid customer profile.' });
        return;
      }

      const cleanPhone = (p: string) => p.replace(/\D/g, '');
      const targetPhone = cleanPhone(profile.phone);

      const blockedRef = db.collection('blocked_customers').doc(targetPhone);
      const blockedSnap = await blockedRef.get();
      let writeCount = 1;
      if (blockedSnap.exists) {
        await trackUsage({ reads: 1, customersReads: 1 });
        res.status(403).json({ success: false, message: 'This mobile number is permanently blocked.' });
        return;
      }

      if (profile.status === 'blocked') {
        await blockedRef.set({
          phone: targetPhone,
          blockedAt: new Date().toISOString(),
          customerId: profile.id,
          name: profile.name
        });
        writeCount++;
      } else {
        await blockedRef.delete();
        writeCount++;
      }

      await db.collection('customers').doc(profile.id).set(profile, { merge: true });
      await trackUsage({ reads: 1, writes: writeCount, customersReads: 1 });

      res.status(201).json({ success: true, customer: sanitizeCustomer(profile) });
      return;
    }

    // 4. DELETE remove customer (/api/customers)
    if (req.method === 'DELETE') {
      const { customerId } = req.query as { customerId?: string };
      if (!customerId) {
        res.status(400).json({ success: false, message: 'Missing customerId parameter.' });
        return;
      }

      const docRef = db.collection('customers').doc(decodeURIComponent(customerId));
      const snap = await docRef.get();
      let writeCount = 0;
      if (snap.exists) {
        const customerData = snap.data() as any;
        const cleanPhone = (p: string) => p.replace(/\D/g, '');
        const targetPhone = cleanPhone(customerData.phone);

        await db.collection('blocked_customers').doc(targetPhone).set({
          phone: targetPhone,
          blockedAt: new Date().toISOString(),
          customerId: customerId,
          name: customerData.name
        });

        await docRef.set({ ...customerData, status: 'removed' }, { merge: true });
        writeCount += 2;
      }

      await trackUsage({ reads: 1, writes: writeCount, customersReads: 1 });
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
