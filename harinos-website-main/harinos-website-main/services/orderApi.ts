import { CustomerProfile, Order, OrderStatus, MenuItem, OutletConfig, OfferCard, WalletTransaction } from '../types';
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  Unsubscribe,
} from 'firebase/firestore';
import {
  db,
  FIRESTORE_CUSTOMERS_COLLECTION,
  FIRESTORE_ORDERS_COLLECTION,
  FIRESTORE_MENU_ITEMS_COLLECTION,
  FIRESTORE_OUTLETS_COLLECTION,
  FIRESTORE_OFFERS_COLLECTION,
  FIRESTORE_WALLET_TRANSACTIONS_COLLECTION,
  isFirebaseClientConfigured,
} from './firebaseClient';

const API_BASE_URL = (import.meta.env.VITE_ORDER_API_BASE_URL ?? '/api').trim() || '/api';

const getApiBase = (): string | null => API_BASE_URL || null;
export const isOrderApiConfigured = (): boolean => isFirebaseClientConfigured() || Boolean(getApiBase());

const sortOrders = (orders: Order[]): Order[] =>
  [...orders].sort((a, b) => new Date(b.receivedAt ?? b.date).getTime() - new Date(a.receivedAt ?? a.date).getTime());

const saveFullOrderViaApi = async (order: Order): Promise<void> => {
  if (!getApiBase()) throw new Error('Central API is not configured.');
  const response = await fetch(`${getApiBase()}/orders/full`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  });
  if (!response.ok) throw new Error(`Order sync failed with status ${response.status}.`);
};

const getOrdersViaApi = async (): Promise<Order[]> => {
  if (!getApiBase()) return [];
  const response = await fetch(`${getApiBase()}/orders`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Order fetch failed with status ${response.status}.`);
  const data = (await response.json()) as { orders?: Order[] };
  return data.orders ?? [];
};

const updateOrderStatusViaApi = async (orderId: string, status: OrderStatus): Promise<void> => {
  if (!getApiBase()) throw new Error('Central API is not configured.');
  const response = await fetch(`${getApiBase()}/orders/${encodeURIComponent(orderId)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error(`Status update failed with status ${response.status}.`);
};

const saveCustomerViaApi = async (profile: CustomerProfile): Promise<void> => {
  if (!getApiBase()) throw new Error('Central API is not configured.');
  const response = await fetch(`${getApiBase()}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (!response.ok) throw new Error(`Customer sync failed with status ${response.status}.`);
};

export const saveFullOrderToServer = async (order: Order): Promise<void> => {
  if (isFirebaseClientConfigured()) {
    const nextOrder: Order = {
      ...order,
      receivedAt: order.receivedAt ?? new Date().toISOString(),
      status: order.status ?? 'new',
    };
    try {
      await setDoc(doc(db(), FIRESTORE_ORDERS_COLLECTION, nextOrder.id), nextOrder, { merge: true });
      return;
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  await saveFullOrderViaApi(order);
};

export const getServerOrders = async (): Promise<Order[]> => {
  if (isFirebaseClientConfigured()) {
    try {
      const snapshot = await getDocs(
        query(collection(db(), FIRESTORE_ORDERS_COLLECTION), orderBy('receivedAt', 'desc'), limit(500)),
      );
      return sortOrders(snapshot.docs.map((orderDoc) => orderDoc.data() as Order));
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  return getOrdersViaApi();
};

export const updateServerOrderStatus = async (orderId: string, status: OrderStatus): Promise<void> => {
  if (isFirebaseClientConfigured()) {
    try {
      await updateDoc(doc(db(), FIRESTORE_ORDERS_COLLECTION, orderId), {
        status,
        statusUpdatedAt: new Date().toISOString(),
      });
      return;
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  await updateOrderStatusViaApi(orderId, status);
};

export const saveCustomerToServer = async (profile: CustomerProfile): Promise<void> => {
  if (isFirebaseClientConfigured()) {
    try {
      await setDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, profile.id), profile, { merge: true });
      return;
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  await saveCustomerViaApi(profile);
};

export const getServerCustomers = async (): Promise<CustomerProfile[]> => {
  if (isFirebaseClientConfigured()) {
    const snapshot = await getDocs(
      query(collection(db(), FIRESTORE_CUSTOMERS_COLLECTION), orderBy('createdAt', 'desc'), limit(500)),
    );
    return snapshot.docs.map((customerDoc) => customerDoc.data() as CustomerProfile);
  }

  if (!getApiBase()) return [];
  const response = await fetch(`${getApiBase()}/customers`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Customer fetch failed with status ${response.status}.`);
  const data = (await response.json()) as { customers?: CustomerProfile[] };
  return data.customers ?? [];
};

export const verifyServerCustomer = async (customerId: string): Promise<CustomerProfile | null> => {
  if (isFirebaseClientConfigured()) {
    const docRef = doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, customerId);
    const snap = await getDocs(collection(db(), FIRESTORE_CUSTOMERS_COLLECTION));
    const allCustomers = snap.docs.map((customerDoc) => customerDoc.data() as CustomerProfile);
    const target = allCustomers.find((c) => c.id === customerId);
    if (!target) throw new Error('Customer not found.');

    const cleanPhone = (p: string) => p.replace(/\D/g, '');
    const targetPhone = cleanPhone(target.phone);
    const alreadyVerified = allCustomers.some(
      (c) => c.verified && c.id !== customerId && c.phone && cleanPhone(c.phone) === targetPhone
    );

    if (alreadyVerified) {
      throw new Error(`Verification rejected: The mobile number ${target.phone} is already verified under another customer profile.`);
    }

    const generateReferralCode = () => {
      return Math.floor(65536 + Math.random() * 983039).toString(16).toUpperCase();
    };
    const referralCode = target.referralCode ?? generateReferralCode();

    await updateDoc(docRef, { verified: true, referralCode });
    return { ...target, verified: true, referralCode };
  }

  if (!getApiBase()) return null;
  const response = await fetch(`${getApiBase()}/customers/${encodeURIComponent(customerId)}/verify`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Customer verification failed with status ${response.status}.`);
  }
  const data = (await response.json()) as { customer?: CustomerProfile };
  return data.customer ?? null;
};

export const subscribeServerOrders = (onOrders: (orders: Order[]) => void, onError: (error: Error) => void): Unsubscribe | null => {
  if (!isFirebaseClientConfigured()) return null;

  return onSnapshot(
    query(collection(db(), FIRESTORE_ORDERS_COLLECTION), orderBy('receivedAt', 'desc'), limit(500)),
    (snapshot) => onOrders(sortOrders(snapshot.docs.map((orderDoc) => orderDoc.data() as Order))),
    (error) => onError(error),
  );
};

export const subscribeServerCustomers = (
  onCustomers: (customers: CustomerProfile[]) => void,
  onError: (error: Error) => void,
): Unsubscribe | null => {
  if (!isFirebaseClientConfigured()) return null;

  return onSnapshot(
    query(collection(db(), FIRESTORE_CUSTOMERS_COLLECTION), orderBy('createdAt', 'desc'), limit(500)),
    (snapshot) => onCustomers(snapshot.docs.map((customerDoc) => customerDoc.data() as CustomerProfile)),
    (error) => onError(error),
  );
};

export const subscribeServerOrder = (
  orderId: string,
  onOrder: (order: Order | null) => void,
  onError: (error: Error) => void,
): Unsubscribe | null => {
  if (!isFirebaseClientConfigured()) return null;

  return onSnapshot(
    doc(db(), FIRESTORE_ORDERS_COLLECTION, orderId),
    (snapshot) => onOrder(snapshot.exists() ? (snapshot.data() as Order) : null),
    (error) => onError(error),
  );
};

// Authentication
export const authenticateAdminViaApi = async (username: string, password: string): Promise<any> => {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');
  const response = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'Invalid credentials.');
  }
  const data = await response.json();
  return data.user;
};

// Dynamic Menu Items
export const getServerMenuItems = async (): Promise<MenuItem[]> => {
  if (isFirebaseClientConfigured()) {
    try {
      const snapshot = await getDocs(collection(db(), FIRESTORE_MENU_ITEMS_COLLECTION));
      return snapshot.docs.map((doc) => doc.data() as MenuItem);
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  const apiBase = getApiBase();
  if (!apiBase) return [];
  const response = await fetch(`${apiBase}/menu-items`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Menu items fetch failed with status ${response.status}.`);
  const data = (await response.json()) as { menuItems?: MenuItem[] };
  return data.menuItems ?? [];
};

export const saveMenuItemToServer = async (item: MenuItem): Promise<void> => {
  if (isFirebaseClientConfigured()) {
    try {
      await setDoc(doc(db(), FIRESTORE_MENU_ITEMS_COLLECTION, item.id), item, { merge: true });
      return;
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');
  const response = await fetch(`${apiBase}/menu-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!response.ok) throw new Error(`Menu item save failed with status ${response.status}.`);
};

export const seedMenuItemsToServer = async (items: MenuItem[]): Promise<void> => {
  if (isFirebaseClientConfigured()) {
    try {
      for (const item of items) {
        await setDoc(doc(db(), FIRESTORE_MENU_ITEMS_COLLECTION, item.id), item, { merge: true });
      }
      return;
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');
  const response = await fetch(`${apiBase}/menu-items/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(items),
  });
  if (!response.ok) throw new Error(`Menu items seed failed with status ${response.status}.`);
};

export const subscribeServerMenuItems = (
  onItems: (items: MenuItem[]) => void,
  onError: (error: Error) => void,
): Unsubscribe | null => {
  if (!isFirebaseClientConfigured()) return null;

  return onSnapshot(
    collection(db(), FIRESTORE_MENU_ITEMS_COLLECTION),
    (snapshot) => onItems(snapshot.docs.map((doc) => doc.data() as MenuItem)),
    (error) => onError(error),
  );
};

// Dynamic Outlets
export const getServerOutlets = async (): Promise<OutletConfig[]> => {
  if (isFirebaseClientConfigured()) {
    try {
      const snapshot = await getDocs(collection(db(), FIRESTORE_OUTLETS_COLLECTION));
      return snapshot.docs.map((doc) => doc.data() as OutletConfig);
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  const apiBase = getApiBase();
  if (!apiBase) return [];
  const response = await fetch(`${apiBase}/outlets`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Outlets fetch failed with status ${response.status}.`);
  const data = (await response.json()) as { outlets?: OutletConfig[] };
  return data.outlets ?? [];
};

export const saveOutletToServer = async (outlet: OutletConfig): Promise<void> => {
  if (isFirebaseClientConfigured()) {
    try {
      await setDoc(doc(db(), FIRESTORE_OUTLETS_COLLECTION, outlet.id), outlet, { merge: true });
      return;
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');
  const response = await fetch(`${apiBase}/outlets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(outlet),
  });
  if (!response.ok) throw new Error(`Outlet save failed with status ${response.status}.`);
};

export const seedOutletsToServer = async (outlets: OutletConfig[]): Promise<void> => {
  if (isFirebaseClientConfigured()) {
    try {
      for (const outlet of outlets) {
        await setDoc(doc(db(), FIRESTORE_OUTLETS_COLLECTION, outlet.id), outlet, { merge: true });
      }
      return;
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');
  const response = await fetch(`${apiBase}/outlets/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(outlets),
  });
  if (!response.ok) throw new Error(`Outlets seed failed with status ${response.status}.`);
};

export const subscribeServerOutlets = (
  onOutlets: (outlets: OutletConfig[]) => void,
  onError: (error: Error) => void,
): Unsubscribe | null => {
  if (!isFirebaseClientConfigured()) return null;

  return onSnapshot(
    collection(db(), FIRESTORE_OUTLETS_COLLECTION),
    (snapshot) => onOutlets(snapshot.docs.map((doc) => doc.data() as OutletConfig)),
    (error) => onError(error),
  );
};

// Dynamic Offers
export const getServerOffers = async (): Promise<OfferCard[]> => {
  if (isFirebaseClientConfigured()) {
    try {
      const snapshot = await getDocs(collection(db(), FIRESTORE_OFFERS_COLLECTION));
      return snapshot.docs.map((doc) => doc.data() as OfferCard);
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  const apiBase = getApiBase();
  if (!apiBase) return [];
  const response = await fetch(`${apiBase}/offers`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Offers fetch failed with status ${response.status}.`);
  const data = (await response.json()) as { offers?: OfferCard[] };
  return data.offers ?? [];
};

export const saveOfferToServer = async (offer: OfferCard): Promise<void> => {
  if (isFirebaseClientConfigured()) {
    try {
      await setDoc(doc(db(), FIRESTORE_OFFERS_COLLECTION, offer.id), offer, { merge: true });
      return;
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');
  const response = await fetch(`${apiBase}/offers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(offer),
  });
  if (!response.ok) throw new Error(`Offer save failed with status ${response.status}.`);
};

export const seedOffersToServer = async (offers: OfferCard[]): Promise<void> => {
  if (isFirebaseClientConfigured()) {
    try {
      for (const offer of offers) {
        await setDoc(doc(db(), FIRESTORE_OFFERS_COLLECTION, offer.id), offer, { merge: true });
      }
      return;
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');
  const response = await fetch(`${apiBase}/offers/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(offers),
  });
  if (!response.ok) throw new Error(`Offers seed failed with status ${response.status}.`);
};

export const subscribeServerOffers = (
  onOffers: (offers: OfferCard[]) => void,
  onError: (error: Error) => void,
): Unsubscribe | null => {
  if (!isFirebaseClientConfigured()) return null;

  return onSnapshot(
    collection(db(), FIRESTORE_OFFERS_COLLECTION),
    (snapshot) => onOffers(snapshot.docs.map((doc) => doc.data() as OfferCard)),
    (error) => onError(error),
  );
};

export const changeStaffPassword = async (
  username: string,
  newPassword: string,
  requesterUsername?: string,
  requesterPassword?: string
): Promise<void> => {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');
  const response = await fetch(`${apiBase}/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, newPassword, requesterUsername, requesterPassword }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'Password update failed.');
  }
};

export const getServerWalletTransactions = async (): Promise<WalletTransaction[]> => {
  if (isFirebaseClientConfigured()) {
    try {
      const snapshot = await getDocs(
        query(collection(db(), FIRESTORE_WALLET_TRANSACTIONS_COLLECTION), orderBy('createdAt', 'desc')),
      );
      return snapshot.docs.map((doc) => doc.data() as WalletTransaction);
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  const apiBase = getApiBase();
  if (!apiBase) return [];
  const response = await fetch(`${apiBase}/wallet/transactions`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Transactions fetch failed with status ${response.status}.`);
  const data = (await response.json()) as { transactions?: WalletTransaction[] };
  return data.transactions ?? [];
};

export const saveWalletTransactionToServer = async (transaction: WalletTransaction): Promise<void> => {
  if (isFirebaseClientConfigured()) {
    try {
      await setDoc(doc(db(), FIRESTORE_WALLET_TRANSACTIONS_COLLECTION, transaction.id), transaction, { merge: true });
      return;
    } catch (error) {
      if (!getApiBase()) throw error;
    }
  }

  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');
  const response = await fetch(`${apiBase}/wallet/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(transaction),
  });
  if (!response.ok) throw new Error(`Transaction save failed with status ${response.status}.`);
};

export const subscribeServerWalletTransactions = (
  onTransactions: (transactions: WalletTransaction[]) => void,
  onError: (error: Error) => void,
): Unsubscribe | null => {
  if (!isFirebaseClientConfigured()) return null;

  return onSnapshot(
    query(collection(db(), FIRESTORE_WALLET_TRANSACTIONS_COLLECTION), orderBy('createdAt', 'desc')),
    (snapshot) => onTransactions(snapshot.docs.map((doc) => doc.data() as WalletTransaction)),
    (error) => onError(error),
  );
};
