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

async function sendWhatsAppMessage(phone: string, text: string): Promise<{ success: boolean; message: string }> {
  const apiUrl = process.env.WHATSAPP_API_URL || '';
  const apiToken = process.env.WHATSAPP_API_TOKEN || '';

  if (!apiUrl || !apiToken) {
    return { success: false, message: 'WhatsApp Gateway credentials not configured.' };
  }

  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }

  try {
    let response;
    if (apiUrl.toLowerCase().includes('ultramsg')) {
      let url = apiUrl;
      if (!url.endsWith('/messages/chat')) {
        url = url.replace(/\/$/, '') + '/messages/chat';
      }
      const params = new URLSearchParams();
      params.append('token', apiToken);
      params.append('to', cleanPhone);
      params.append('body', text);

      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });
    } else {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          to: cleanPhone,
          body: text,
        }),
      });
    }

    if (response.ok) {
      return { success: true, message: 'Sent successfully.' };
    } else {
      const errorText = await response.text();
      return { success: false, message: `Gateway error ${response.status}: ${errorText.substring(0, 100)}` };
    }
  } catch (error: any) {
    return { success: false, message: `Connection error: ${error.message}` };
  }
}

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
        res.status(404).json({ success: false, message: 'Customer not found.' });
        return;
      }
      const customerData = snap.data() as any;

      const caller = authenticateRequest(req);
      const isStaff = caller && (caller.role === 'admin' || caller.role === 'manager');

      if (!isStaff) {
        const { otp } = req.body as { otp?: string };
        if (!otp) {
          res.status(400).json({ success: false, message: 'OTP is required.' });
          return;
        }
        if (customerData.otp !== otp) {
          res.status(400).json({ success: false, message: 'Incorrect OTP. Please try again.' });
          return;
        }
        if (!customerData.otpExpiry || customerData.otpExpiry < Date.now()) {
          res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
          return;
        }
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
      await trackUsage({ reads: readsCount, writes: 1, customersReads: readsCount });
      
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
          res.status(404).json({ success: false, message: 'Customer not found.' });
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

      if (action === 'send-otp') {
        const caller = authenticateRequest(req);
        if (!caller || (caller.role !== 'admin' && caller.role !== 'manager')) {
          res.status(403).json({ success: false, message: 'Forbidden. Admin/Manager role required.' });
          return;
        }
        const { customerId } = req.body as { customerId?: string };
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
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiry = Date.now() + 10 * 60 * 1000;
        
        await docRef.set({ otp, otpExpiry }, { merge: true });
        
        const otpText = `Your Harino's Pizza verification code is: ${otp}. Valid for 10 minutes.`;
        const waResult = await sendWhatsAppMessage(customerData.phone, otpText);
        
        console.log(`[WhatsApp OTP - Admin Triggered] Sent OTP ${otp} to ${customerData.phone}`);
        
        if (!waResult.success) {
          res.status(502).json({ success: false, message: waResult.message });
          return;
        }
        
        await trackUsage({ reads: 1, writes: 1, customersReads: 1 });
        res.json({ success: true, message: 'OTP sent successfully.' });
        return;
      }

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

      if (action === 'login-init') {
        const { phone, name, isRegistering } = req.body as { phone: string; name?: string; isRegistering?: boolean };
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
          await trackUsage({ reads: 1, customersReads: 1 });
          res.status(403).json({ success: false, message: 'This mobile number is permanently blocked.' });
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

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiry = Date.now() + 10 * 60 * 1000;

        if (existingCustomer) {
          if (existingCustomer.status === 'blocked') {
            await trackUsage({ reads: totalReads, customersReads: totalReads });
            res.status(403).json({ success: false, message: 'This mobile number is permanently blocked.' });
            return;
          }

          await db.collection('customers').doc(existingCustomer.id).set({
            otp,
            otpExpiry
          }, { merge: true });

          const otpText = `Your Harino's Pizza verification code is: ${otp}. Valid for 10 minutes.`;
          const waResult = await sendWhatsAppMessage(phone, otpText);
          
          console.log(`[WhatsApp OTP - Login] Sent OTP ${otp} to ${phone}`);
          
          if (!waResult.success) {
            await trackUsage({ reads: totalReads, customersReads: totalReads });
            res.status(502).json({
              success: false,
              message: 'OTP service temporarily unavailable. Please try again later.'
            });
            return;
          }

          await trackUsage({ reads: totalReads, writes: 1, customersReads: totalReads });

          res.json({
            success: true,
            exists: true,
            customerId: existingCustomer.id,
            message: 'OTP generated successfully.'
          });
          return;
        } else {
          if (!isRegistering) {
            await trackUsage({ reads: totalReads, customersReads: totalReads });
            res.json({
              success: false,
              exists: false,
              message: 'Account does not exist. Please create an account.'
            });
            return;
          }

          const newCustomerId = `cust_${Date.now()}`;
          const newCustomer = {
            id: newCustomerId,
            name: name?.trim() || 'New Customer',
            phone: phone,
            email: '',
            loginMethod: 'phone',
            verified: false,
            createdAt: new Date().toISOString(),
            walletBalance: 0,
            rewardPoints: 0,
            status: 'active',
            referralAttemptsRemaining: 3,
            referralCodeUsed: false,
            referralLocked: false,
            otp,
            otpExpiry
          };

          const otpText = `Your Harino's Pizza verification code is: ${otp}. Valid for 10 minutes.`;
          const waResult = await sendWhatsAppMessage(phone, otpText);
          
          console.log(`[WhatsApp OTP - Register] Sent OTP ${otp} to ${phone}`);
          
          if (!waResult.success) {
            await trackUsage({ reads: totalReads, customersReads: totalReads });
            res.status(502).json({
              success: false,
              message: 'OTP service temporarily unavailable. Please try again later.'
            });
            return;
          }

          await db.collection('customers').doc(newCustomerId).set(newCustomer);
          await trackUsage({ reads: totalReads, writes: 1, customersReads: totalReads });

          res.status(201).json({
            success: true,
            exists: false,
            customerId: newCustomerId,
            message: 'OTP generated for registration.'
          });
          return;
        }
      }

      if (action === 'login-verify') {
        const { customerId, otp } = req.body as { customerId: string; otp: string };
        if (!customerId || !otp) {
          res.status(400).json({ success: false, message: 'Customer ID and OTP are required.' });
          return;
        }

        const customerDocRef = db.collection('customers').doc(customerId);
        const snap = await customerDocRef.get();
        if (!snap.exists) {
          await trackUsage({ reads: 1, customersReads: 1 });
          res.status(404).json({ success: false, message: 'Customer not found.' });
          return;
        }

        const customerData = snap.data() as any;
        if (customerData.status === 'blocked') {
          await trackUsage({ reads: 1, customersReads: 1 });
          res.status(403).json({ success: false, message: 'This account is permanently blocked.' });
          return;
        }

        if (customerData.otp === otp) {
          const generateReferralCode = () => {
            return Math.floor(65536 + Math.random() * 983039).toString(16).toUpperCase();
          };
          const referralCode = customerData.referralCode ?? generateReferralCode();
          
          const updatedCustomer = {
            ...customerData,
            verified: true,
            referralCode,
            otp: admin.firestore.FieldValue.delete(),
            otpExpiry: admin.firestore.FieldValue.delete()
          };

          await customerDocRef.set(updatedCustomer, { merge: true });
          await trackUsage({ reads: 1, writes: 1, customersReads: 1 });

          delete updatedCustomer.otp;
          delete updatedCustomer.otpExpiry;

          res.json({
            success: true,
            customer: {
              ...updatedCustomer,
              verified: true,
              referralCode
            }
          });
          return;
        } else {
          await trackUsage({ reads: 1, customersReads: 1 });
          res.status(400).json({ success: false, message: 'Incorrect OTP. Please try again.' });
          return;
        }
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
