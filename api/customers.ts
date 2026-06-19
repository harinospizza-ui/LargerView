import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { customerId, action } = req.query as { customerId?: string; action?: string };

  try {
    const db = getFirestore();

    // 1. PATCH verification (/api/customers/:customerId/verify)
    if (req.method === 'PATCH' && customerId && action === 'verify') {
      const docRef = db.collection('customers').doc(decodeURIComponent(customerId));
      const snap = await docRef.get();
      if (!snap.exists) {
        res.status(404).json({ success: false, message: 'Customer not found.' });
        return;
      }
      const customerData = snap.data() as any;

      const allCustomersSnap = await db.collection('customers').where('verified', '==', true).get();
      const cleanPhone = (p: string) => p.replace(/\D/g, '');
      const targetPhone = cleanPhone(customerData.phone);
      const alreadyVerified = allCustomersSnap.docs.some((docDoc) => {
        const data = docDoc.data() as any;
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

    // 2. GET single customer, search by phone, or all customers (/api/customers)
    if (req.method === 'GET') {
      const { customerId, phone } = req.query as { customerId?: string; phone?: string };
      if (customerId) {
        const docRef = db.collection('customers').doc(decodeURIComponent(customerId));
        const snap = await docRef.get();
        if (!snap.exists) {
          res.status(404).json({ success: false, message: 'Customer not found.' });
          return;
        }
        res.json({ success: true, customer: snap.data() });
        return;
      }
      if (phone) {
        const rawPhone = decodeURIComponent(phone);
        const cleanPhone = (p: string) => p.replace(/\D/g, '');
        const targetPhoneDigits = cleanPhone(rawPhone);

        // Try querying exactly by the raw input
        let querySnap = await db.collection('customers').where('phone', '==', rawPhone).get();
        
        // If not found and input is different from cleaned digits, try query by digits
        if (querySnap.empty && targetPhoneDigits && targetPhoneDigits !== rawPhone) {
          querySnap = await db.collection('customers').where('phone', '==', targetPhoneDigits).get();
        }

        if (querySnap.empty) {
          // fallback scan
          const snapshot = await db.collection('customers').limit(500).get();
          const match = snapshot.docs.find(doc => {
            const data = doc.data() as any;
            return data.phone && cleanPhone(data.phone) === targetPhoneDigits;
          });
          if (match) {
            res.json({ success: true, customer: match.data() });
            return;
          }
          res.json({ success: true, customer: null });
          return;
        }

        res.json({ success: true, customer: querySnap.docs[0].data() });
        return;
      }

      const snapshot = await db.collection('customers').limit(500).get();
      const list = snapshot.docs.map((doc) => doc.data() as any);
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
          res.status(403).json({ success: false, message: 'This mobile number is permanently blocked.' });
          return;
        }

        // Search for existing customer
        let existingCustomer: any = null;
        let querySnap = await db.collection('customers').where('phone', '==', phone).get();
        if (querySnap.empty && targetPhone !== phone) {
          querySnap = await db.collection('customers').where('phone', '==', targetPhone).get();
        }

        if (!querySnap.empty) {
          existingCustomer = querySnap.docs[0].data();
        } else {
          // fallback scan
          const snapshot = await db.collection('customers').limit(500).get();
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
          // If customer exists, we generate OTP and return it (login flow)
          await db.collection('customers').doc(existingCustomer.id).set({
            otp,
            otpExpiry
          }, { merge: true });

          res.json({
            success: true,
            exists: true,
            customerId: existingCustomer.id,
            otp, // return OTP so client can alert it for testing/login
            message: 'OTP generated successfully.'
          });
          return;
        } else {
          // Customer does not exist
          if (!isRegistering) {
            res.json({
              success: false,
              exists: false,
              message: 'Account does not exist. Please create an account.'
            });
            return;
          }

          // Registration flow: create user with verified: false, save otp
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

          await db.collection('customers').doc(newCustomerId).set(newCustomer);
          res.status(201).json({
            success: true,
            exists: false,
            customerId: newCustomerId,
            otp,
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
          res.status(404).json({ success: false, message: 'Customer not found.' });
          return;
        }

        const customerData = snap.data() as any;
        if (customerData.otp === otp) {
          // Success: clear OTP and mark verified (since they successfully entered OTP!)
          // Also generate referral code if not already verified/present
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
          // remove firestoreFieldValue items for JSON response
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
      if (blockedSnap.exists) {
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
      } else {
        await blockedRef.delete();
      }

      await db.collection('customers').doc(profile.id).set(profile, { merge: true });
      res.status(201).json({ success: true, customer: profile });
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
      if (snap.exists) {
        const customerData = snap.data() as any;
        const cleanPhone = (p: string) => p.replace(/\D/g, '');
        const targetPhone = cleanPhone(customerData.phone);

        // Permanently block the phone number
        await db.collection('blocked_customers').doc(targetPhone).set({
          phone: targetPhone,
          blockedAt: new Date().toISOString(),
          customerId: customerId,
          name: customerData.name
        });

        // Set status to removed
        await docRef.set({ ...customerData, status: 'removed' }, { merge: true });
      }

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
