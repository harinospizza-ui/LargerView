import { 
  CustomerProfile, 
  Order, 
  OrderStatus, 
  MenuItem, 
  OutletConfig, 
  OfferCard, 
  WalletTransaction, 
  AppSettings, 
  VerificationRequest,
  AdminSession,
  Category
} from '../types';
import { StorageService } from './storage';
import {
  db,
  auth,
  storage,
  FIRESTORE_ORDERS_COLLECTION,
  FIRESTORE_CUSTOMERS_COLLECTION,
  FIRESTORE_MENU_ITEMS_COLLECTION,
  FIRESTORE_OUTLETS_COLLECTION,
  FIRESTORE_OFFERS_COLLECTION,
  FIRESTORE_WALLET_TRANSACTIONS_COLLECTION,
  FIRESTORE_VERIFICATION_REQUESTS_COLLECTION
} from './firebaseClient';
import { 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  deleteDoc, 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot, 
  updateDoc, 
  getCountFromServer,
  runTransaction
} from 'firebase/firestore';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  updatePassword as updateAuthPassword, 
  signOut 
} from 'firebase/auth';
import { 
  ref, 
  uploadString, 
  listAll, 
  getMetadata, 
  getBytes 
} from 'firebase/storage';
import { hashPasswordClient } from './hashUtils';

export type Unsubscribe = () => void;

export interface BackupDetail {
  filename: string;
  size: string;
  date: string;
  status: string;
  location: string;
}

export interface BackupStatusResponse {
  success: boolean;
  backups: BackupDetail[];
  lastBackupTime?: string;
  lastBackupSize?: string;
  lastBackupStatus?: string;
  lastBackupLocation?: string;
}

export interface NotificationDashboardData {
  success: boolean;
  totalDevices: number;
  stats: any[];
}

export const checkBusinessHours = (): boolean => {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const ist = new Date(utc + (3600000 * 5.5)); // IST is UTC+5.5
  const hours = ist.getHours();
  return hours >= 11 && hours < 21;
};

export const isOrderApiConfigured = (): boolean => true;

const sortOrders = (orders: Order[]): Order[] =>
  [...orders].sort((a, b) => new Date(b.receivedAt ?? b.date).getTime() - new Date(a.receivedAt ?? a.date).getTime());

const sortCustomers = (customers: CustomerProfile[]): CustomerProfile[] => {
  return [...customers].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  });
};

const DEFAULT_STAFF = [
  { role: 'admin', username: 'Admin_Harinos', password: 'Harinos_Admin', collection: 'admins', email: 'admin@harinos.local', dbPass: 'AdminDBAccessPass1!' },
  { role: 'manager', username: 'Manager_Harinos', password: 'Harinos_Manager', collection: 'managers', email: 'manager@harinos.local', dbPass: 'ManagerDBAccessPass1!' },
  { role: 'staff', username: 'Staff_Harinos', password: 'Harinos_Staff', collection: 'staff', email: 'staff@harinos.local', dbPass: 'StaffDBAccessPass1!' },
];

export const reauthenticateStaffSession = async (): Promise<void> => {
  const session = StorageService.getAdminSession();
  if (!session) return;
  
  const authInstance = auth();
  if (authInstance.currentUser) return;
  
  const def = DEFAULT_STAFF.find(d => d.role === session.role);
  if (def) {
    try {
      await signInWithEmailAndPassword(authInstance, def.email, def.dbPass);
      console.log('Automatically re-authenticated staff session in Firebase Auth.');
    } catch (err) {
      console.warn('Failed to auto-login staff to Firebase Auth:', err);
    }
  }
};

export const reauthenticateCustomerSession = async (): Promise<void> => {
  // Customers do not use Firebase Auth anymore; customer access is independent of Firebase Auth.
};

export const initializeFirebaseCollections = async (): Promise<void> => {
  try {
    // 1. Initialize staff accounts (admins, managers, staff)
    for (const staff of DEFAULT_STAFF) {
      try {
        const staffRef = doc(db(), staff.collection, staff.username);
        const snap = await getDoc(staffRef);
        if (!snap.exists()) {
          const hash = await hashPasswordClient(staff.password);
          await setDoc(staffRef, {
            uid: staff.username,
            username: staff.username,
            role: staff.role,
            passwordHash: hash,
            outletId: null,
            active: true,
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString()
          });
          console.log(`Auto-created default ${staff.role} document in Firestore.`);
        }
      } catch (err) {
        console.warn(`Failsafe staff init failed for ${staff.username}:`, err);
      }
    }

    // 2. Initialize settings and storeConfiguration documents if missing
    try {
      const settingsRef = doc(db(), 'settings', 'app');
      const settingsSnap = await getDoc(settingsRef);
      if (!settingsSnap.exists()) {
        await setDoc(settingsRef, {
          instagramUrl: 'https://instagram.com/harinospizza',
          menuVersion: '1.0',
          createdAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn('Failsafe settings init failed:', err);
    }

    try {
      const configRef = doc(db(), 'storeConfiguration', 'app');
      const configSnap = await getDoc(configRef);
      if (!configSnap.exists()) {
        await setDoc(configRef, {
          instagramUrl: 'https://instagram.com/harinospizza',
          menuVersion: '1.0',
          createdAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn('Failsafe storeConfiguration init failed:', err);
    }

    // 3. Auto-verify existence of remaining collections by creating placeholder docs if empty
    const collectionsToVerify = [
      'customers', 'customerProfiles', 'customerVerification', 'wallets', 
      'walletTransactions', 'orders', 'orderHistory', 'customerHistory', 
      'offers', 'menuItems', 'outlets', 'analytics', 'notifications', 
      'businessData', 'referrals', 'customerVerificationRequests', 'wallet_transactions'
    ];

    for (const col of collectionsToVerify) {
      try {
        const placeholderRef = doc(db(), col, '_init_placeholder');
        const snap = await getDoc(placeholderRef);
        if (!snap.exists()) {
          await setDoc(placeholderRef, {
            initialized: true,
            createdAt: new Date().toISOString()
          });
        }
      } catch (err) {
        console.warn(`Failsafe verify failed for collection ${col}:`, err);
      }
    }

  } catch (globalErr) {
    console.error('Failsafe global collection initialization failed:', globalErr);
  }
};

export const recoverMenuItems = async (defaultItems: MenuItem[]): Promise<void> => {
  try {
    const menuColl = collection(db(), FIRESTORE_MENU_ITEMS_COLLECTION);
    const snap = await getDocs(menuColl);
    const serverItemsMap = new Map(snap.docs.map(docDoc => [docDoc.id, docDoc.data() as MenuItem]));

    for (const defItem of defaultItems) {
      const serverItem = serverItemsMap.get(defItem.id);
      if (!serverItem) {
        await setDoc(doc(db(), FIRESTORE_MENU_ITEMS_COLLECTION, defItem.id), defItem);
        console.log(`Recovered missing menu item: ${defItem.name}`);
      } else {
        let needsUpdate = false;
        const updatedFields: any = {};

        if (!serverItem.category) {
          updatedFields.category = defItem.category;
          needsUpdate = true;
        }
        if (!serverItem.image || serverItem.image === '' || (serverItem.image.startsWith('/') && !serverItem.image.includes('.'))) {
          updatedFields.image = defItem.image;
          needsUpdate = true;
        }
        if (serverItem.price === undefined || serverItem.price === null) {
          updatedFields.price = defItem.price;
          needsUpdate = true;
        }
        if (serverItem.vegetarian === undefined) {
          updatedFields.vegetarian = defItem.vegetarian;
          needsUpdate = true;
        }
        if (serverItem.available === undefined) {
          updatedFields.available = defItem.available ?? true;
          needsUpdate = true;
        }

        if (needsUpdate) {
          await updateDoc(doc(db(), FIRESTORE_MENU_ITEMS_COLLECTION, defItem.id), updatedFields);
          console.log(`Repaired menu item fields for: ${serverItem.name}`);
        }
      }
    }
  } catch (err) {
    console.warn('Failsafe: failed to recover/repair menu items:', err);
  }
};

export const saveFullOrderToServer = async (order: Omit<Order, 'id'> & { id?: string }): Promise<Order> => {
  if (!checkBusinessHours()) {
    throw new Error("Harino's online ordering is available between 11:00 AM and 9:00 PM.");
  }

  if (order.orderType !== 'dinein') {
    const hasBeverages = order.items.some(item => item.category === Category.BEVERAGES || item.category === 'Beverages');
    if (hasBeverages) {
      throw new Error("Beverages are available for Dine-In only.");
    }
  }

  if (order.orderType === 'delivery') {
    if (order.distanceKm && order.distanceKm > 5) {
      throw new Error("Delivery is only available within 5 KM.");
    }
  }

  if (order.customerPhone) {
    const cleanPhone = order.customerPhone.replace(/\D/g, '');
    const customerSnap = await getDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, cleanPhone));
    if (customerSnap.exists()) {
      const customerData = customerSnap.data() as CustomerProfile;
      if (customerData.status === 'blocked' || customerData.active === false) {
        throw new Error("Forbidden. Blocked customer cannot place orders.");
      }
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayFormatted = todayStr.replace(/-/g, '');
  const startOfDay = new Date(todayStr + 'T00:00:00.000Z');

  const q = query(
    collection(db(), FIRESTORE_ORDERS_COLLECTION),
    where('receivedAt', '>=', startOfDay.toISOString())
  );
  const snapshot = await getDocs(q);
  const dailySeq = snapshot.size + 1;
  const orderId = `HRN-${todayFormatted}-${dailySeq}`;

  const nextOrder: Order = {
    ...order,
    id: orderId,
    receivedAt: new Date().toISOString(),
    date: new Date().toLocaleString(),
    status: 'new',
    auditTrail: [{
      timestamp: new Date().toISOString(),
      updatedBy: order.customerName ? String(order.customerName) : 'customer',
      action: 'Order placed'
    }]
  } as Order;

  await setDoc(doc(db(), FIRESTORE_ORDERS_COLLECTION, orderId), nextOrder);

  // Auto-update orderHistory
  try {
    await setDoc(doc(db(), 'orderHistory', orderId), nextOrder);
  } catch (err) {}

  try {
    const { notifyCustomerStatusChange } = await import('./notificationService');
    void notifyCustomerStatusChange(nextOrder, 'new');
  } catch (err) {
    console.warn('FCM order placement notify failed:', err);
  }

  const localOrders = StorageService.getAdminOrders().filter((o) => o.id !== orderId);
  StorageService.saveAdminOrders([nextOrder, ...localOrders]);

  return nextOrder;
};

export const getServerOrders = async (): Promise<Order[]> => {
  try {
    const session = StorageService.getAdminSession();
    let q;
    if (session && session.role === 'staff') {
      q = query(
        collection(db(), FIRESTORE_ORDERS_COLLECTION),
        where('status', 'in', ['new', 'preparing', 'ready', 'out_for_delivery'])
      );
    } else {
      q = query(
        collection(db(), FIRESTORE_ORDERS_COLLECTION),
        orderBy('receivedAt', 'desc'),
        limit(500)
      );
    }

    const snapshot = await getDocs(q);
    let ordersList = snapshot.docs
      .map((docDoc) => docDoc.data() as Order)
      .filter(o => o.id !== '_init_placeholder');

    if (session) {
      if (session.role === 'staff') {
        ordersList = ordersList.filter(o => !o.isDeleted && (session.outletId ? o.outletId === session.outletId : true));
        ordersList.sort((a, b) => {
          const timeA = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
          const timeB = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
          return timeB - timeA;
        });

        ordersList = ordersList.map(o => {
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
      } else if (session.role === 'manager') {
        ordersList = ordersList.filter(o => !o.isDeleted);
      }
    }

    StorageService.saveAdminOrders(ordersList);
    return ordersList;
  } catch (error) {
    console.warn('Direct Firestore get orders failed, using cached orders:', error);
    return sortOrders(StorageService.getAdminOrders());
  }
};

export const getServerOrderById = async (orderId: string): Promise<Order | null> => {
  try {
    const snap = await getDoc(doc(db(), FIRESTORE_ORDERS_COLLECTION, orderId));
    if (!snap.exists()) return null;
    const order = snap.data() as Order;
    if (order.isDeleted) return null;

    const session = StorageService.getAdminSession();
    if (session && session.role === 'staff') {
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
    return order;
  } catch (error) {
    console.warn('Direct Firestore get order by id failed, using cached orders:', error);
    return StorageService.getAdminOrders().find(o => o.id === orderId) || null;
  }
};

export const updateServerOrderStatus = async (orderId: string, status: OrderStatus, reason?: string): Promise<void> => {
  const session = StorageService.getAdminSession();
  const callerName = session ? session.username : 'system';

  if (status === 'cancelled' && session?.role === 'staff') {
    throw new Error('Forbidden. Staff cannot cancel orders.');
  }

  const cleanId = orderId.trim();
  const orderRef = doc(db(), FIRESTORE_ORDERS_COLLECTION, cleanId);
  const snap = await getDoc(orderRef);

  if (!snap.exists()) {
    throw new Error('Order not found.');
  }

  const orderData = snap.data() as Order;
  if (orderData.status === 'cancelled') {
    throw new Error('Cancelled orders cannot be modified.');
  }

  if (status === 'cancelled') {
    await deleteDoc(orderRef);
    try {
      await deleteDoc(doc(db(), 'orderHistory', cleanId));
    } catch (err) {}

    const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await setDoc(doc(db(), 'security_logs', logId), {
      id: logId,
      timestamp: new Date().toISOString(),
      action: 'ORDER_CANCELLED',
      username: callerName,
      details: `Permanently deleted order: ${cleanId}, Reason: ${reason || ''}`
    });

    try {
      const { notifyCustomerStatusChange } = await import('./notificationService');
      void notifyCustomerStatusChange({ ...orderData, status }, status);
    } catch (err) {
      console.warn('FCM status notify failed:', err);
    }
  } else {
    const auditTrail = orderData.auditTrail || [];
    auditTrail.push({
      timestamp: new Date().toISOString(),
      updatedBy: callerName,
      action: `Status updated to ${status}`,
      previousStatus: orderData.status,
      newStatus: status,
      reason: reason || ''
    });

    await updateDoc(orderRef, {
      status,
      statusUpdatedAt: new Date().toISOString(),
      auditTrail
    });
    try {
      await updateDoc(doc(db(), 'orderHistory', cleanId), { status, statusUpdatedAt: new Date().toISOString(), auditTrail });
    } catch (err) {}

    const localOrders = StorageService.getAdminOrders();
    const idx = localOrders.findIndex((o) => o.id === cleanId);
    if (idx >= 0) {
      localOrders[idx] = {
        ...localOrders[idx],
        status,
        statusUpdatedAt: new Date().toISOString(),
        auditTrail
      };
      StorageService.saveAdminOrders(localOrders);
    }

    try {
      const { notifyCustomerStatusChange } = await import('./notificationService');
      void notifyCustomerStatusChange({ ...orderData, status }, status);
    } catch (err) {
      console.warn('FCM status notify failed:', err);
    }
  }
};

export const deleteOrderFromServer = async (orderId: string): Promise<void> => {
  const session = StorageService.getAdminSession();
  if (!session || (session.role !== 'admin' && session.role !== 'manager')) {
    throw new Error('Forbidden. Admin/Manager role required.');
  }

  const cleanId = orderId.trim();
  const orderDocRef = doc(db(), FIRESTORE_ORDERS_COLLECTION, cleanId);

  const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  await setDoc(doc(db(), 'security_logs', logId), {
    id: logId,
    timestamp: new Date().toISOString(),
    action: 'ORDER_DELETED',
    username: session.username,
    details: `Permanently deleted order: ${cleanId}`
  });

  await deleteDoc(orderDocRef);
  try {
    await deleteDoc(doc(db(), 'orderHistory', cleanId));
  } catch (err) {}

  const localOrders = StorageService.getAdminOrders().filter((o) => o.id !== cleanId);
  StorageService.saveAdminOrders(localOrders);
};

export const saveCustomerToServer = async (profile: CustomerProfile): Promise<void> => {
  const localCusts = StorageService.getAdminCustomers().filter((c) => c.id !== profile.id);
  StorageService.saveAdminCustomers([profile, ...localCusts]);

  try {
    await setDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, profile.id), profile, { merge: true });
    await setDoc(doc(db(), 'customerProfiles', profile.id), profile, { merge: true });
  } catch (error) {
    console.warn('Direct Firestore save customer failed:', error);
    throw error;
  }
};

export const deleteCustomerFromServer = async (customerId: string): Promise<void> => {
  const cleanId = customerId.trim();
  await deleteDoc(doc(db(), 'customers', cleanId));
  await deleteDoc(doc(db(), 'customerProfiles', cleanId));
  await deleteDoc(doc(db(), 'wallets', cleanId));
  await deleteDoc(doc(db(), 'customerVerificationRequests', cleanId));
  await deleteDoc(doc(db(), 'customerVerification', cleanId));
  await deleteDoc(doc(db(), 'customerHistory', cleanId));
  
  const txQuery = query(collection(db(), 'wallet_transactions'), where('customerId', '==', cleanId));
  const txSnap = await getDocs(txQuery);
  for (const docDoc of txSnap.docs) {
    await deleteDoc(docDoc.ref);
  }
  
  const txQuery2 = query(collection(db(), 'walletTransactions'), where('customerId', '==', cleanId));
  const txSnap2 = await getDocs(txQuery2);
  for (const docDoc of txSnap2.docs) {
    await deleteDoc(docDoc.ref);
  }

  const localCusts = StorageService.getAdminCustomers().filter((c) => c.id !== cleanId);
  StorageService.saveAdminCustomers(localCusts);
};

export const getServerCustomers = async (): Promise<CustomerProfile[]> => {
  try {
    const snapshot = await getDocs(
      query(collection(db(), FIRESTORE_CUSTOMERS_COLLECTION), orderBy('createdAt', 'desc'), limit(500))
    );
    const sorted = sortCustomers(
      snapshot.docs
        .map((docDoc) => docDoc.data() as CustomerProfile)
        .filter(c => c.id !== '_init_placeholder')
    );
    StorageService.saveAdminCustomers(sorted);
    return sorted;
  } catch (error) {
    console.warn('Direct Firestore get customers failed, using cache:', error);
    return sortCustomers(StorageService.getAdminCustomers());
  }
};

export const getServerCustomerById = async (customerId: string): Promise<CustomerProfile | null> => {
  try {
    const snap = await getDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, customerId));
    if (!snap.exists()) return null;
    return snap.data() as CustomerProfile;
  } catch (error) {
    console.warn('Direct Firestore get customer by id failed:', error);
    return StorageService.getAdminCustomers().find(c => c.id === customerId) || null;
  }
};

export const registerCustomer = async (
  phone: string,
  name: string
): Promise<{ success: boolean; customer: CustomerProfile; requestId: string; message?: string }> => {
  if (!checkBusinessHours()) {
    throw new Error("Harino's online ordering is available between 11:00 AM and 9:00 PM.");
  }

  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length !== 10) {
    throw new Error('Please enter a valid 10-digit mobile number.');
  }

  const blockedSnap = await getDoc(doc(db(), 'blocked_customers', cleanPhone));
  if (blockedSnap.exists()) {
    throw new Error('This mobile number is permanently blocked.');
  }

  // Load existing customer data immediately if they are already registered
  const existingSnap = await getDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, cleanPhone));
  if (existingSnap.exists()) {
    const customerData = existingSnap.data() as CustomerProfile;
    const updatedProfile = { ...customerData, lastLogin: new Date().toISOString() };
    await setDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, cleanPhone), updatedProfile);
    await setDoc(doc(db(), 'customerProfiles', cleanPhone), updatedProfile);
    return {
      success: true,
      customer: updatedProfile,
      requestId: cleanPhone,
      message: 'Welcome back!'
    };
  }

  const referralCode = Math.floor(65536 + Math.random() * 983039).toString(16).toUpperCase();
  const nowStr = new Date().toISOString();

  const customerProfile: CustomerProfile = {
    id: cleanPhone,
    customerId: cleanPhone,
    name: name.trim(),
    fullName: name.trim(),
    phone: cleanPhone,
    mobileNumber: cleanPhone,
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
    referralCode: referralCode
  };

  await setDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, cleanPhone), customerProfile);
  await setDoc(doc(db(), 'customerProfiles', cleanPhone), customerProfile);
  await setDoc(doc(db(), 'wallets', cleanPhone), { customerId: cleanPhone, balance: 0, createdAt: nowStr });
  await setDoc(doc(db(), 'customerHistory', cleanPhone), { customerId: cleanPhone, createdAt: nowStr });
  await setDoc(doc(db(), 'customerVerificationRequests', cleanPhone), {
    requestId: cleanPhone,
    customerId: cleanPhone,
    customerName: name.trim(),
    mobileNumber: cleanPhone,
    otp: 'NO_OTP',
    status: 'pending',
    createdAt: nowStr,
    verifiedAt: null,
    verifiedBy: null
  });

  return {
    success: true,
    customer: customerProfile,
    requestId: cleanPhone,
    message: 'Account created successfully!'
  };
};

export const initCustomerLogin = async (
  phone: string,
  name?: string,
  isRegistering?: boolean
): Promise<{ success: boolean; exists: boolean; customer?: CustomerProfile; requestId?: string; message?: string }> => {
  if (!checkBusinessHours()) {
    throw new Error("Harino's online ordering is available between 11:00 AM and 9:00 PM.");
  }

  const cleanPhone = phone.replace(/\D/g, '');
  const customerSnap = await getDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, cleanPhone));
  
  if (!customerSnap.exists()) {
    const defaultName = name ? name.trim() : `Customer_${cleanPhone.slice(-4)}`;
    const referralCode = Math.floor(65536 + Math.random() * 983039).toString(16).toUpperCase();
    const nowStr = new Date().toISOString();

    const customerProfile: CustomerProfile = {
      id: cleanPhone,
      customerId: cleanPhone,
      name: defaultName,
      fullName: defaultName,
      phone: cleanPhone,
      mobileNumber: cleanPhone,
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
      referralCode: referralCode
    };

    await setDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, cleanPhone), customerProfile);
    await setDoc(doc(db(), 'customerProfiles', cleanPhone), customerProfile);
    await setDoc(doc(db(), 'wallets', cleanPhone), { customerId: cleanPhone, balance: 0, createdAt: nowStr });
    await setDoc(doc(db(), 'customerHistory', cleanPhone), { customerId: cleanPhone, createdAt: nowStr });
    await setDoc(doc(db(), 'customerVerificationRequests', cleanPhone), {
      requestId: cleanPhone,
      customerId: cleanPhone,
      customerName: defaultName,
      mobileNumber: cleanPhone,
      otp: 'NO_OTP',
      status: 'pending',
      createdAt: nowStr,
      verifiedAt: null,
      verifiedBy: null
    });

    return {
      success: true,
      exists: true,
      customer: customerProfile,
      requestId: cleanPhone,
      message: 'Account created automatically!'
    };
  }

  const customerData = customerSnap.data() as CustomerProfile;
  if (customerData.active === false || customerData.status === 'blocked') {
    return { success: false, exists: true, message: 'Account disabled' };
  }

  const updatedProfile = { ...customerData, lastLogin: new Date().toISOString() };
  await setDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, cleanPhone), updatedProfile);
  await setDoc(doc(db(), 'customerProfiles', cleanPhone), updatedProfile);

  return {
    success: true,
    exists: true,
    customer: updatedProfile,
    requestId: cleanPhone,
    message: 'Login successful!'
  };
};

export const verifyCustomerLogin = async (
  requestId: string,
  otp: string
): Promise<{ success: boolean; customer?: CustomerProfile; message?: string }> => {
  return { success: true };
};

export const verifyServerCustomer = async (customerId: string, otp?: string): Promise<CustomerProfile | null> => {
  const cleanId = customerId.trim();
  const customerRef = doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, cleanId);
  const profileRef = doc(db(), 'customerProfiles', cleanId);
  const verifyRef = doc(db(), 'customerVerificationRequests', cleanId);

  await updateDoc(customerRef, { verified: true });
  try {
    await updateDoc(profileRef, { verified: true });
  } catch (err) {}
  try {
    await updateDoc(verifyRef, {
      status: 'verified',
      verifiedAt: new Date().toISOString(),
      verifiedBy: 'admin'
    });
  } catch (err) {}

  const snap = await getDoc(customerRef);
  return snap.exists() ? (snap.data() as CustomerProfile) : null;
};

export const blockCustomerOnServer = async (customerId: string, blocked: boolean): Promise<any> => {
  const cleanId = customerId.trim();
  const status = blocked ? 'blocked' : 'active';
  const active = !blocked;

  await updateDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, cleanId), { status, active });
  try {
    await updateDoc(doc(db(), 'customerProfiles', cleanId), { status, active });
  } catch (err) {}

  if (blocked) {
    await setDoc(doc(db(), 'blocked_customers', cleanId), {
      phone: cleanId,
      blockedAt: new Date().toISOString(),
      customerId: cleanId
    });
  } else {
    await deleteDoc(doc(db(), 'blocked_customers', cleanId));
  }

  return { success: true };
};

export const bulkRemoveCustomersFromServer = async (customerIds: string[]): Promise<any> => {
  for (const id of customerIds) {
    await deleteCustomerFromServer(id);
  }
  return { success: true };
};

export const mergeCustomersOnServer = async (primaryId: string, secondaryId: string): Promise<any> => {
  const pId = primaryId.trim();
  const sId = secondaryId.trim();
  if (pId === sId) {
    throw new Error('Primary and secondary profiles cannot be the same.');
  }

  const primaryRef = doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, pId);
  const secondaryRef = doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, sId);

  await runTransaction(db(), async (transaction) => {
    const primarySnap = await transaction.get(primaryRef);
    const secondarySnap = await transaction.get(secondaryRef);

    if (!primarySnap.exists()) {
      throw new Error('Primary customer not found.');
    }
    if (!secondarySnap.exists()) {
      throw new Error('Secondary customer not found.');
    }

    const primaryData = primarySnap.data() as CustomerProfile;
    const secondaryData = secondarySnap.data() as CustomerProfile;

    const mergedBalance = (primaryData.walletBalance || 0) + (secondaryData.walletBalance || 0);
    const mergedPoints = (primaryData.rewardPoints || primaryData.loyaltyPoints || 0) + (secondaryData.rewardPoints || secondaryData.loyaltyPoints || 0);

    transaction.update(primaryRef, {
      walletBalance: mergedBalance,
      rewardPoints: mergedPoints,
      loyaltyPoints: mergedPoints
    });

    transaction.delete(secondaryRef);

    const txId = `tx_merge_${Date.now()}`;
    const txRef = doc(db(), FIRESTORE_WALLET_TRANSACTIONS_COLLECTION, txId);
    transaction.set(txRef, {
      id: txId,
      customerId: pId,
      customerName: primaryData.name || primaryData.fullName || 'Customer',
      customerPhone: primaryData.phone || primaryData.mobileNumber || '',
      amount: secondaryData.walletBalance || 0,
      type: 'credit',
      status: 'completed',
      createdAt: new Date().toISOString(),
      description: `Merged profile ${sId}. Transferred Rs ${secondaryData.walletBalance || 0} and ${mergedPoints} points.`
    });
  });

  return { success: true };
};

export const subscribeServerOrders = (
  onOrders: (orders: Order[]) => void,
  onError: (error: Error) => void,
): Unsubscribe => {
  const session = StorageService.getAdminSession();
  let q;
  if (session && session.role === 'staff') {
    q = query(
      collection(db(), FIRESTORE_ORDERS_COLLECTION),
      where('status', 'in', ['new', 'preparing', 'ready', 'out_for_delivery'])
    );
  } else {
    q = query(
      collection(db(), FIRESTORE_ORDERS_COLLECTION),
      orderBy('receivedAt', 'desc'),
      limit(500)
    );
  }

  return onSnapshot(
    q,
    (snapshot) => {
      let ordersList = snapshot.docs
        .map((docDoc) => docDoc.data() as Order)
        .filter(o => o.id !== '_init_placeholder');
      if (session) {
        if (session.role === 'staff') {
          ordersList = ordersList.filter(o => !o.isDeleted && (session.outletId ? o.outletId === session.outletId : true));
          ordersList.sort((a, b) => {
            const timeA = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
            const timeB = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
            return timeB - timeA;
          });
          ordersList = ordersList.map(o => {
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
        } else if (session.role === 'manager') {
          ordersList = ordersList.filter(o => !o.isDeleted);
        }
      }
      onOrders(ordersList);
    },
    (error) => {
      onError(error);
    }
  );
};

export const subscribeServerCustomers = (
  onCustomers: (customers: CustomerProfile[]) => void,
  onError: (error: Error) => void,
): Unsubscribe => {
  return onSnapshot(
    query(collection(db(), FIRESTORE_CUSTOMERS_COLLECTION), orderBy('createdAt', 'desc'), limit(500)),
    (snapshot) => {
      const customers = snapshot.docs
        .map((docDoc) => docDoc.data() as CustomerProfile)
        .filter(c => c.id !== '_init_placeholder');
      onCustomers(customers);
    },
    (error) => {
      onError(error);
    }
  );
};

export const subscribeServerVerificationRequests = (
  onRequests: (requests: VerificationRequest[]) => void,
  onError: (error: Error) => void,
): Unsubscribe => {
  return onSnapshot(
    query(collection(db(), FIRESTORE_VERIFICATION_REQUESTS_COLLECTION), orderBy('createdAt', 'desc'), limit(500)),
    (snapshot) => {
      const requests = snapshot.docs
        .map((docDoc) => docDoc.data() as VerificationRequest)
        .filter(r => r.requestId !== '_init_placeholder');
      onRequests(requests);
    },
    (error) => {
      onError(error);
    }
  );
};

export const subscribeServerOrder = (
  orderId: string,
  onOrder: (order: Order | null) => void,
  onError: (error: Error) => void,
): Unsubscribe => {
  const session = StorageService.getAdminSession();
  return onSnapshot(
    doc(db(), FIRESTORE_ORDERS_COLLECTION, orderId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onOrder(null);
        return;
      }
      const order = snapshot.data() as Order;
      if (order.isDeleted) {
        onOrder(null);
        return;
      }
      if (session && session.role === 'staff') {
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
      onOrder(order);
    },
    (error) => {
      onError(error);
    }
  );
};

export const authenticateAdminViaApi = async (username: string, password: string): Promise<any> => {
  let role: AdminSession['role'] | null = null;
  let collectionName = '';
  let userDoc: any = null;

  const docSnapAdmins = await getDoc(doc(db(), 'admins', username));
  if (docSnapAdmins.exists()) {
    role = 'admin';
    collectionName = 'admins';
    userDoc = docSnapAdmins.data();
  } else {
    const docSnapManagers = await getDoc(doc(db(), 'managers', username));
    if (docSnapManagers.exists()) {
      role = 'manager';
      collectionName = 'managers';
      userDoc = docSnapManagers.data();
    } else {
      const docSnapStaff = await getDoc(doc(db(), 'staff', username));
      if (docSnapStaff.exists()) {
        role = 'staff';
        collectionName = 'staff';
        userDoc = docSnapStaff.data();
      }
    }
  }

  const def = DEFAULT_STAFF.find(d => d.username === username);
  if (!userDoc) {
    if (def && password === def.password) {
      const hash = await hashPasswordClient(password);
      userDoc = {
        uid: username,
        username: username,
        role: def.role,
        passwordHash: hash,
        outletId: null,
        active: true,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };
      await setDoc(doc(db(), def.collection, username), userDoc);
      role = def.role as any;
      collectionName = def.collection;
    } else {
      throw new Error('Invalid credentials.');
    }
  } else {
    const hash = await hashPasswordClient(password);
    let isPasswordCorrect = false;

    if (userDoc.passwordHash === hash) {
      isPasswordCorrect = true;
    } else if (userDoc.password === password || userDoc.passwordHash === password) {
      isPasswordCorrect = true;
      await updateDoc(doc(db(), collectionName, username), { passwordHash: hash });
    } else if (def && password === def.password) {
      isPasswordCorrect = true;
      await updateDoc(doc(db(), collectionName, username), { passwordHash: hash });
    }

    if (!isPasswordCorrect) {
      throw new Error('Invalid credentials.');
    }

    if (userDoc.active === false) {
      throw new Error('Account disabled');
    }
  }

  const currentRoleDef = DEFAULT_STAFF.find(d => d.role === role);
  if (!currentRoleDef) {
    throw new Error('System error: invalid role configuration.');
  }

  let userCredential;
  try {
    userCredential = await signInWithEmailAndPassword(auth(), currentRoleDef.email, currentRoleDef.dbPass);
  } catch (err: any) {
    if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
      userCredential = await createUserWithEmailAndPassword(auth(), currentRoleDef.email, currentRoleDef.dbPass);
    } else {
      throw err;
    }
  }

  await updateDoc(doc(db(), collectionName, username), { lastLogin: new Date().toISOString() });

  return {
    role: role,
    username: username,
    outletId: userDoc.outletId || null,
    token: userCredential.user.uid,
    firebaseToken: undefined,
    sessionId: `session_${Date.now()}`
  };
};

export const getServerMenuItems = async (): Promise<MenuItem[]> => {
  try {
    const snapshot = await getDocs(collection(db(), FIRESTORE_MENU_ITEMS_COLLECTION));
    const items = snapshot.docs
      .map((docDoc) => docDoc.data() as MenuItem)
      .filter(i => i.id !== '_init_placeholder');
    StorageService.saveAdminMenuItems(items);
    return items;
  } catch (error) {
    console.warn('Direct Firestore get menu items failed, using cache:', error);
    return StorageService.getAdminMenuItems();
  }
};

export const saveMenuItemToServer = async (item: MenuItem): Promise<void> => {
  const localItems = StorageService.getAdminMenuItems().filter((i) => i.id !== item.id);
  StorageService.saveAdminMenuItems([item, ...localItems]);

  try {
    await setDoc(doc(db(), FIRESTORE_MENU_ITEMS_COLLECTION, item.id), item, { merge: true });
  } catch (error) {
    console.warn('Direct Firestore save menu item failed:', error);
    throw error;
  }
};

export const seedMenuItemsToServer = async (items: MenuItem[]): Promise<void> => {
  StorageService.saveAdminMenuItems(items);

  try {
    const promises = items.map(item =>
      setDoc(doc(db(), FIRESTORE_MENU_ITEMS_COLLECTION, item.id), item, { merge: true })
    );
    await Promise.all(promises);
  } catch (error) {
    console.warn('Direct Firestore seed menu items failed:', error);
    throw error;
  }
};

export const subscribeServerMenuItems = (
  onItems: (items: MenuItem[]) => void,
  onError: (error: Error) => void,
): Unsubscribe => {
  return onSnapshot(
    collection(db(), FIRESTORE_MENU_ITEMS_COLLECTION),
    (snapshot) => {
      const items = snapshot.docs
        .map((docDoc) => docDoc.data() as MenuItem)
        .filter(i => i.id !== '_init_placeholder');
      onItems(items);
    },
    (error) => {
      onError(error);
    }
  );
};

export const getServerOutlets = async (): Promise<OutletConfig[]> => {
  try {
    const snapshot = await getDocs(collection(db(), FIRESTORE_OUTLETS_COLLECTION));
    const list = snapshot.docs
      .map((docDoc) => docDoc.data() as OutletConfig)
      .filter(o => o.id !== '_init_placeholder');
    StorageService.saveAdminOutlets(list);
    return list;
  } catch (error) {
    console.warn('Direct Firestore get outlets failed, using cache:', error);
    return StorageService.getAdminOutlets();
  }
};

export const saveOutletToServer = async (outlet: OutletConfig): Promise<void> => {
  const localList = StorageService.getAdminOutlets().filter((o) => o.id !== outlet.id);
  StorageService.saveAdminOutlets([outlet, ...localList]);

  try {
    await setDoc(doc(db(), FIRESTORE_OUTLETS_COLLECTION, outlet.id), outlet, { merge: true });
  } catch (error) {
    console.warn('Direct Firestore save outlet failed:', error);
    throw error;
  }
};

export const deleteOutletFromServer = async (outletId: string): Promise<void> => {
  const localList = StorageService.getAdminOutlets().filter((o) => o.id !== outletId);
  StorageService.saveAdminOutlets(localList);

  try {
    await deleteDoc(doc(db(), FIRESTORE_OUTLETS_COLLECTION, outletId));
  } catch (error) {
    console.warn('Direct Firestore delete outlet failed:', error);
    throw error;
  }
};

export const seedOutletsToServer = async (outlets: OutletConfig[]): Promise<void> => {
  StorageService.saveAdminOutlets(outlets);

  try {
    const promises = outlets.map(outlet =>
      setDoc(doc(db(), FIRESTORE_OUTLETS_COLLECTION, outlet.id), outlet, { merge: true })
    );
    await Promise.all(promises);
  } catch (error) {
    console.warn('Direct Firestore seed outlets failed:', error);
    throw error;
  }
};

export const subscribeServerOutlets = (
  onOutlets: (outlets: OutletConfig[]) => void,
  onError: (error: Error) => void,
): Unsubscribe => {
  return onSnapshot(
    collection(db(), FIRESTORE_OUTLETS_COLLECTION),
    (snapshot) => {
      const outlets = snapshot.docs
        .map((docDoc) => docDoc.data() as OutletConfig)
        .filter(o => o.id !== '_init_placeholder');
      onOutlets(outlets);
    },
    (error) => {
      onError(error);
    }
  );
};

export const getServerOffers = async (): Promise<OfferCard[]> => {
  try {
    const snapshot = await getDocs(collection(db(), FIRESTORE_OFFERS_COLLECTION));
    const list = snapshot.docs
      .map((docDoc) => docDoc.data() as OfferCard)
      .filter(o => o.id !== '_init_placeholder');
    StorageService.saveAdminOffers(list);
    return list;
  } catch (error) {
    console.warn('Direct Firestore get offers failed, using cache:', error);
    return StorageService.getAdminOffers();
  }
};

export const saveOfferToServer = async (offer: OfferCard): Promise<void> => {
  const localList = StorageService.getAdminOffers().filter((o) => o.id !== offer.id);
  StorageService.saveAdminOffers([offer, ...localList]);

  try {
    await setDoc(doc(db(), FIRESTORE_OFFERS_COLLECTION, offer.id), offer, { merge: true });
  } catch (error) {
    console.warn('Direct Firestore save offer failed:', error);
    throw error;
  }
};

export const seedOffersToServer = async (offers: OfferCard[]): Promise<void> => {
  StorageService.saveAdminOffers(offers);

  try {
    const promises = offers.map(offer =>
      setDoc(doc(db(), FIRESTORE_OFFERS_COLLECTION, offer.id), offer, { merge: true })
    );
    await Promise.all(promises);
  } catch (error) {
    console.warn('Direct Firestore seed offers failed:', error);
    throw error;
  }
};

export const subscribeServerOffers = (
  onOffers: (offers: OfferCard[]) => void,
  onError: (error: Error) => void,
): Unsubscribe => {
  return onSnapshot(
    collection(db(), FIRESTORE_OFFERS_COLLECTION),
    (snapshot) => {
      const offers = snapshot.docs
        .map((docDoc) => docDoc.data() as OfferCard)
        .filter(o => o.id !== '_init_placeholder');
      onOffers(offers);
    },
    (error) => {
      onError(error);
    }
  );
};

export const changeStaffPassword = async (
  username: string,
  newPassword: string
): Promise<void> => {
  let collectionName = '';
  const snapAdmins = await getDoc(doc(db(), 'admins', username));
  if (snapAdmins.exists()) collectionName = 'admins';
  else {
    const snapManagers = await getDoc(doc(db(), 'managers', username));
    if (snapManagers.exists()) collectionName = 'managers';
    else {
      const snapStaff = await getDoc(doc(db(), 'staff', username));
      if (snapStaff.exists()) collectionName = 'staff';
    }
  }

  if (!collectionName) {
    throw new Error('User not found.');
  }

  const hash = await hashPasswordClient(newPassword);
  await updateDoc(doc(db(), collectionName, username), { passwordHash: hash });

  const session = StorageService.getAdminSession();
  if (session && session.username === username) {
    const authInstance = auth();
    if (authInstance.currentUser) {
      await updateAuthPassword(authInstance.currentUser, newPassword);
    }
  }
};

export const getServerWalletTransactions = async (): Promise<WalletTransaction[]> => {
  try {
    const snapshot = await getDocs(
      query(collection(db(), FIRESTORE_WALLET_TRANSACTIONS_COLLECTION), orderBy('createdAt', 'desc'), limit(500))
    );
    const list = snapshot.docs
      .map((docDoc) => docDoc.data() as WalletTransaction)
      .filter(t => t.id !== '_init_placeholder');
    StorageService.saveAdminTransactions(list);
    return list;
  } catch (error) {
    console.warn('Direct Firestore get transactions failed, using cache:', error);
    return StorageService.getAdminTransactions();
  }
};

export const saveWalletTransactionToServer = async (transaction: WalletTransaction): Promise<void> => {
  const localList = StorageService.getAdminTransactions().filter((t) => t.id !== transaction.id);
  StorageService.saveAdminTransactions([transaction, ...localList]);

  try {
    await setDoc(doc(db(), FIRESTORE_WALLET_TRANSACTIONS_COLLECTION, transaction.id), transaction, { merge: true });
    
    const custRef = doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, transaction.customerId);
    const custSnap = await getDoc(custRef);
    if (custSnap.exists()) {
      const custData = custSnap.data() as CustomerProfile;
      const currentBalance = custData.walletBalance || 0;
      let newBalance = currentBalance;
      if (transaction.status === 'completed') {
        if (transaction.type === 'topup' || transaction.type === 'credit' || transaction.type === 'reward' || transaction.type === 'admin_adjustment') {
          newBalance += transaction.amount;
        } else if (transaction.type === 'debit') {
          newBalance -= transaction.amount;
        }
      }
      await updateDoc(custRef, { walletBalance: newBalance });
      await updateDoc(doc(db(), 'customerProfiles', transaction.customerId), { walletBalance: newBalance });
      await setDoc(doc(db(), 'wallets', transaction.customerId), { customerId: transaction.customerId, balance: newBalance }, { merge: true });
    }
  } catch (error) {
    console.warn('Direct Firestore save transaction failed:', error);
  }
};

export const subscribeServerWalletTransactions = (
  onTransactions: (transactions: WalletTransaction[]) => void,
  onError: (error: Error) => void,
): Unsubscribe => {
  return onSnapshot(
    query(collection(db(), FIRESTORE_WALLET_TRANSACTIONS_COLLECTION), orderBy('createdAt', 'desc'), limit(500)),
    (snapshot) => {
      const txs = snapshot.docs
        .map((docDoc) => docDoc.data() as WalletTransaction)
        .filter(t => t.id !== '_init_placeholder');
      onTransactions(txs);
    },
    (error) => {
      onError(error);
    }
  );
};

export const getServerSettings = async (): Promise<AppSettings> => {
  try {
    const snap = await getDoc(doc(db(), 'settings', 'app'));
    if (!snap.exists()) return {};
    return snap.data() as AppSettings;
  } catch (error) {
    console.warn('Direct Firestore get settings failed, using cache:', error);
    return {};
  }
};

export const saveSettingsToServer = async (settings: AppSettings): Promise<void> => {
  try {
    await setDoc(doc(db(), 'settings', 'app'), settings, { merge: true });
    await setDoc(doc(db(), 'storeConfiguration', 'app'), settings, { merge: true });
  } catch (error) {
    console.warn('Direct Firestore save settings failed:', error);
    throw error;
  }
};

export const getFirestoreUsage = async (): Promise<any[]> => {
  try {
    const snapshot = await getDocs(collection(db(), 'firestore_usage'));
    const usageData = snapshot.docs.map(docDoc => ({
      date: docDoc.id,
      ...docDoc.data()
    }));
    usageData.sort((a, b) => b.date.localeCompare(a.date));
    return usageData;
  } catch (error) {
    console.warn('Direct Firestore get usage failed:', error);
    return [];
  }
};

export const getBackupStatus = async (): Promise<BackupStatusResponse> => {
  try {
    const backupsRef = ref(storage(), 'backups');
    const res = await listAll(backupsRef);
    const backupsList: BackupDetail[] = [];
    for (const itemRef of res.items) {
      try {
        const metadata = await getMetadata(itemRef);
        backupsList.push({
          filename: itemRef.name,
          size: `${Math.round(metadata.size / 1024)} KB`,
          date: metadata.timeCreated,
          status: 'completed',
          location: 'Firebase Storage'
        });
      } catch (err) {
        console.warn('Metadata fetch failed for backup item:', itemRef.name, err);
      }
    }
    backupsList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const lastBackup = backupsList[0];
    return {
      success: true,
      backups: backupsList,
      lastBackupTime: lastBackup ? new Date(lastBackup.date).toLocaleString() : 'Never',
      lastBackupSize: lastBackup ? lastBackup.size : '0 KB',
      lastBackupStatus: lastBackup ? 'completed' : 'N/A',
      lastBackupLocation: lastBackup ? 'Firebase Storage' : 'N/A'
    };
  } catch (error: any) {
    console.error('Backup listing failed:', error);
    throw new Error(error.message || 'Failed to list backups.');
  }
};

export const triggerDatabaseBackup = async (): Promise<any> => {
  try {
    const collectionsToBackup = [
      'admins', 'managers', 'staff', 'customers', 'customerProfiles',
      'customerVerification', 'wallets', 'walletTransactions', 'orders',
      'orderHistory', 'customerHistory', 'offers', 'menuItems', 'outlets',
      'analytics', 'notifications', 'storeConfiguration', 'businessData',
      'referrals', 'customerVerificationRequests', 'wallet_transactions',
      'settings'
    ];

    const backupData: Record<string, any[]> = {};
    for (const col of collectionsToBackup) {
      try {
        const snap = await getDocs(collection(db(), col));
        backupData[col] = snap.docs.map(docDoc => ({ id: docDoc.id, ...docDoc.data() }));
      } catch (err) {
        console.warn(`Could not fetch collection ${col} during backup:`, err);
      }
    }

    const jsonStr = JSON.stringify(backupData);
    const filename = `backup_${Date.now()}.json`;
    const storageRef = ref(storage(), `backups/${filename}`);
    
    await uploadString(storageRef, jsonStr, 'raw', { contentType: 'application/json' });
    
    return {
      success: true,
      backup: {
        filename,
        location: 'Firebase Storage'
      }
    };
  } catch (error: any) {
    console.error('Database backup failed:', error);
    throw new Error(error.message || 'Failed to create backup.');
  }
};

export const triggerDatabaseRestore = async (filename: string): Promise<any> => {
  try {
    const storageRef = ref(storage(), `backups/${filename}`);
    const bytes = await getBytes(storageRef);
    const decoder = new TextDecoder('utf-8');
    const jsonStr = decoder.decode(bytes);
    const backupData = JSON.parse(jsonStr) as Record<string, any[]>;

    for (const colName of Object.keys(backupData)) {
      const docs = backupData[colName];
      try {
        const oldSnap = await getDocs(collection(db(), colName));
        for (const oldDoc of oldSnap.docs) {
          if (oldDoc.id !== '_init_placeholder') {
            await deleteDoc(oldDoc.ref);
          }
        }
        for (const docData of docs) {
          const { id, ...data } = docData;
          if (id && id !== '_init_placeholder') {
            await setDoc(doc(db(), colName, id), data);
          }
        }
      } catch (err) {
        console.warn(`Restore error in collection ${colName}:`, err);
      }
    }

    return { success: true };
  } catch (error: any) {
    console.error('Database restore failed:', error);
    throw new Error(error.message || 'Failed to restore database from backup.');
  }
};

export const getNotificationDashboardData = async (): Promise<NotificationDashboardData> => {
  try {
    const tokensColl = collection(db(), FIRESTORE_NOTIFICATION_TOKENS_COLLECTION);
    const countSnapshot = await getCountFromServer(tokensColl);
    const totalDevices = countSnapshot.data().count;

    const statsColl = collection(db(), 'notification_stats');
    const statsQuery = query(statsColl, orderBy('updatedAt', 'desc'), limit(30));
    const statsSnapshot = await getDocs(statsQuery);
    const stats = statsSnapshot.docs.map(docDoc => ({
      date: docDoc.id,
      sent: docDoc.data().sent || 0,
      failed: docDoc.data().failed || 0,
      removedTokens: docDoc.data().removedTokens || 0,
      updatedAt: docDoc.data().updatedAt || ''
    }));

    return {
      success: true,
      totalDevices,
      stats
    };
  } catch (error) {
    console.warn('Direct Firestore get notification dashboard failed:', error);
    throw error;
  }
};

export const logoutAdmin = async (): Promise<void> => {
  try {
    const authInstance = auth();
    await signOut(authInstance);
  } catch (err) {
    console.warn('Firebase Auth sign out failed:', err);
  }
  StorageService.clearAdminSession();
};
