import { CustomerProfile, Order, OrderStatus, MenuItem, OutletConfig, OfferCard, WalletTransaction, AppSettings } from '../types';
import {
  collection,
  doc,
  getDoc,
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
  isFirebaseClientConfigured as originalIsFirebaseClientConfigured,
} from './firebaseClient';
import { StorageService } from './storage';

const isFirebaseClientConfigured = () => false;

const API_BASE_URL = (import.meta.env.VITE_ORDER_API_BASE_URL ?? '/api').trim() || '/api';

const originalFetch = window.fetch;
const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const response = await originalFetch(input, init);
  if (response.status === 401) {
    const session = StorageService.getAdminSession();
    if (session) {
      console.warn('Unauthorized API request (401). Clearing session and dispatching logout event.');
      StorageService.clearAdminSession();
      window.dispatchEvent(new CustomEvent('harinos-unauthorized'));
    }
  }
  return response;
};

const getApiBase = (): string | null => API_BASE_URL || null;
export const isOrderApiConfigured = (): boolean => isFirebaseClientConfigured() || Boolean(getApiBase());

const getAuthHeaders = (): Record<string, string> => {
  const session = StorageService.getAdminSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session && session.token) {
    headers['Authorization'] = `Bearer ${session.token}`;
  }
  return headers;
};

const sortOrders = (orders: Order[]): Order[] =>
  [...orders].sort((a, b) => new Date(b.receivedAt ?? b.date).getTime() - new Date(a.receivedAt ?? a.date).getTime());

const saveFullOrderViaApi = async (order: Order): Promise<void> => {
  if (!getApiBase()) throw new Error('Central API is not configured.');
  const response = await fetch(`${getApiBase()}/orders/full`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(order),
  });
  if (!response.ok) throw new Error(`Order sync failed with status ${response.status}.`);
};

const getOrdersViaApi = async (): Promise<Order[]> => {
  if (!getApiBase()) return [];
  const response = await fetch(`${getApiBase()}/orders`, {
    headers: getAuthHeaders(),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error(`Order fetch failed with status ${response.status}.`);
  const data = (await response.json()) as { orders?: Order[] };
  return data.orders ?? [];
};

const updateOrderStatusViaApi = async (orderId: string, status: OrderStatus): Promise<void> => {
  if (!getApiBase()) throw new Error('Central API is not configured.');
  const response = await fetch(`${getApiBase()}/orders/${encodeURIComponent(orderId)}/status`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error(`Status update failed with status ${response.status}.`);
};

const saveCustomerViaApi = async (profile: CustomerProfile): Promise<void> => {
  if (!getApiBase()) throw new Error('Central API is not configured.');
  const response = await fetch(`${getApiBase()}/customers`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(profile),
  });
  if (!response.ok) throw new Error(`Customer sync failed with status ${response.status}.`);
};

export const saveFullOrderToServer = async (order: Omit<Order, 'id'> & { id?: string }): Promise<Order> => {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');

  const response = await fetch(`${apiBase}/orders`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(order),
  });

  if (!response.ok) {
    throw new Error(`Order placement failed with status ${response.status}.`);
  }

  const data = await response.json() as { success: boolean; order: Order };
  if (!data.success || !data.order) {
    throw new Error('Order placement failed: invalid response from server.');
  }

  const localOrders = StorageService.getAdminOrders().filter((o) => o.id !== data.order.id);
  StorageService.saveAdminOrders([data.order, ...localOrders]);

  return data.order;
};

export const getServerOrders = async (): Promise<Order[]> => {
  if (isFirebaseClientConfigured()) {
    try {
      const snapshot = await getDocs(
        query(collection(db(), FIRESTORE_ORDERS_COLLECTION), orderBy('receivedAt', 'desc'), limit(500)),
      );
      const ordersList = sortOrders(snapshot.docs.map((orderDoc) => orderDoc.data() as Order));
      StorageService.saveAdminOrders(ordersList);
      return ordersList;
    } catch (error) {
      if (!getApiBase()) return sortOrders(StorageService.getAdminOrders());
    }
  }

  try {
    const ordersList = await getOrdersViaApi();
    StorageService.saveAdminOrders(ordersList);
    return ordersList;
  } catch (error) {
    console.warn('API get orders failed, using cached orders:', error);
    return sortOrders(StorageService.getAdminOrders());
  }
};

export const getServerOrderById = async (orderId: string): Promise<Order | null> => {
  if (isFirebaseClientConfigured()) {
    try {
      const snap = await getDoc(doc(db(), FIRESTORE_ORDERS_COLLECTION, orderId));
      if (snap.exists()) return snap.data() as Order;
      return null;
    } catch (error) {
      if (!getApiBase()) return StorageService.getAdminOrders().find(o => o.id === orderId) || null;
    }
  }

  try {
    const apiBase = getApiBase();
    if (!apiBase) return StorageService.getAdminOrders().find(o => o.id === orderId) || null;
    const response = await fetch(`${apiBase}/orders/${encodeURIComponent(orderId)}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.order || null;
  } catch (error) {
    console.warn('API get order by id failed, using cached orders:', error);
    return StorageService.getAdminOrders().find(o => o.id === orderId) || null;
  }
};

export const updateServerOrderStatus = async (orderId: string, status: OrderStatus): Promise<void> => {
  const localOrders = StorageService.getAdminOrders();
  const idx = localOrders.findIndex((o) => o.id === orderId);
  if (idx >= 0) {
    localOrders[idx] = { ...localOrders[idx], status, statusUpdatedAt: new Date().toISOString() };
    StorageService.saveAdminOrders(localOrders);
  }

  if (isFirebaseClientConfigured()) {
    try {
      await updateDoc(doc(db(), FIRESTORE_ORDERS_COLLECTION, orderId), {
        status,
        statusUpdatedAt: new Date().toISOString(),
      });
      return;
    } catch (error) {
      if (!getApiBase()) return;
    }
  }

  try {
    await updateOrderStatusViaApi(orderId, status);
  } catch (error) {
    console.warn('API update order status failed:', error);
  }
};

export const saveCustomerToServer = async (profile: CustomerProfile): Promise<void> => {
  const localCusts = StorageService.getAdminCustomers().filter((c) => c.id !== profile.id);
  StorageService.saveAdminCustomers([profile, ...localCusts]);

  if (isFirebaseClientConfigured()) {
    await setDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, profile.id), profile, { merge: true });
    return;
  }

  await saveCustomerViaApi(profile);
};

export const deleteCustomerFromServer = async (customerId: string): Promise<void> => {
  const localCusts = StorageService.getAdminCustomers().filter((c) => c.id !== customerId);
  StorageService.saveAdminCustomers(localCusts);

  try {
    const apiBase = getApiBase();
    if (!apiBase) return;
    const response = await fetch(`${apiBase}/customers?customerId=${encodeURIComponent(customerId)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `Customer delete failed with status ${response.status}.`);
    }
  } catch (error) {
    console.warn('API delete customer failed:', error);
    throw error;
  }
};

const sortCustomers = (customers: CustomerProfile[]): CustomerProfile[] => {
  return [...customers].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  });
};

export const getServerCustomers = async (): Promise<CustomerProfile[]> => {
  if (isFirebaseClientConfigured()) {
    try {
      const snapshot = await getDocs(
        query(collection(db(), FIRESTORE_CUSTOMERS_COLLECTION), limit(500)),
      );
      const list = snapshot.docs.map((customerDoc) => customerDoc.data() as CustomerProfile);
      const sorted = sortCustomers(list);
      StorageService.saveAdminCustomers(sorted);
      return sorted;
    } catch (error) {
      return sortCustomers(StorageService.getAdminCustomers());
    }
  }

  try {
    if (!getApiBase()) return sortCustomers(StorageService.getAdminCustomers());
    const response = await fetch(`${getApiBase()}/customers`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Customer fetch failed with status ${response.status}.`);
    const data = (await response.json()) as { customers?: CustomerProfile[] };
    const sorted = sortCustomers(data.customers ?? []);
    StorageService.saveAdminCustomers(sorted);
    return sorted;
  } catch (error) {
    console.warn('API get customers failed, using cache:', error);
    return sortCustomers(StorageService.getAdminCustomers());
  }
};

export const getServerCustomerById = async (customerId: string): Promise<CustomerProfile | null> => {
  try {
    const apiBase = getApiBase();
    if (!apiBase) return StorageService.getAdminCustomers().find(c => c.id === customerId) || null;
    const response = await fetch(`${apiBase}/customers?customerId=${encodeURIComponent(customerId)}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = (await response.json()) as { customer?: CustomerProfile };
    return data.customer ?? null;
  } catch (error) {
    console.warn('API get customer by id failed:', error);
    return StorageService.getAdminCustomers().find(c => c.id === customerId) || null;
  }
};

export const initCustomerLogin = async (
  phone: string,
  name?: string,
  isRegistering?: boolean
): Promise<{ success: boolean; exists: boolean; customerId?: string; otp?: string; message?: string }> => {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');
  
  const response = await fetch(`${apiBase}/customers?action=login-init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, name, isRegistering }),
  });
  
  const data = await response.json();
  return data;
};

export const verifyCustomerLogin = async (
  customerId: string,
  otp: string
): Promise<{ success: boolean; customer?: CustomerProfile; message?: string }> => {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');
  
  const response = await fetch(`${apiBase}/customers?action=login-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId, otp }),
  });
  
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.message || 'OTP verification failed.');
  }
  
  const data = await response.json();
  return data;
};

export const verifyServerCustomer = async (customerId: string): Promise<CustomerProfile | null> => {
  const localCusts = StorageService.getAdminCustomers();
  const targetIdx = localCusts.findIndex((c) => c.id === customerId);
  const target = targetIdx >= 0 ? localCusts[targetIdx] : null;

  const cleanPhone = (p: string) => p.replace(/\D/g, '');
  const generateReferralCode = () => {
    return Math.floor(65536 + Math.random() * 983039).toString(16).toUpperCase();
  };

  const localVerify = (): CustomerProfile | null => {
    if (!target) return null;
    const targetPhone = cleanPhone(target.phone);
    const alreadyVerified = localCusts.some(
      (c) => c.verified && c.id !== customerId && c.phone && cleanPhone(c.phone) === targetPhone
    );
    if (alreadyVerified) {
      throw new Error(`Verification rejected: The mobile number ${target.phone} is already verified under another customer profile.`);
    }
    const referralCode = target.referralCode ?? generateReferralCode();
    const updated = { ...target, verified: true, referralCode };
    localCusts[targetIdx] = updated;
    StorageService.saveAdminCustomers(localCusts);
    return updated;
  };

  if (isFirebaseClientConfigured()) {
    try {
      const docRef = doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, customerId);
      const snap = await getDocs(collection(db(), FIRESTORE_CUSTOMERS_COLLECTION));
      const allCustomers = snap.docs.map((customerDoc) => customerDoc.data() as CustomerProfile);
      const dbTarget = allCustomers.find((c) => c.id === customerId);
      if (!dbTarget) throw new Error('Customer not found.');

      const targetPhone = cleanPhone(dbTarget.phone);
      const alreadyVerified = allCustomers.some(
        (c) => c.verified && c.id !== customerId && c.phone && cleanPhone(c.phone) === targetPhone
      );

      if (alreadyVerified) {
        throw new Error(`Verification rejected: The mobile number ${dbTarget.phone} is already verified under another customer profile.`);
      }

      const referralCode = dbTarget.referralCode ?? generateReferralCode();
      await updateDoc(docRef, { verified: true, referralCode });
      
      const updated = { ...dbTarget, verified: true, referralCode };
      localCusts[targetIdx] = updated;
      StorageService.saveAdminCustomers(localCusts);
      return updated;
    } catch (error) {
      if (!getApiBase()) return localVerify();
    }
  }

  try {
    if (!getApiBase()) return localVerify();
    const response = await fetch(`${getApiBase()}/customers/${encodeURIComponent(customerId)}/verify`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `Customer verification failed with status ${response.status}.`);
    }
    const data = (await response.json()) as { customer?: CustomerProfile };
    const updated = data.customer ?? null;
    if (updated) {
      const idx = localCusts.findIndex((c) => c.id === customerId);
      if (idx >= 0) {
        localCusts[idx] = updated;
      } else {
        localCusts.push(updated);
      }
      StorageService.saveAdminCustomers(localCusts);
    }
    return updated;
  } catch (error) {
    console.warn('API verify customer failed, using local verify:', error);
    return localVerify();
  }
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
    query(collection(db(), FIRESTORE_CUSTOMERS_COLLECTION), limit(500)),
    (snapshot) => {
      const list = snapshot.docs.map((customerDoc) => customerDoc.data() as CustomerProfile);
      onCustomers(sortCustomers(list));
    },
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

export const authenticateAdminViaApi = async (username: string, password: string): Promise<any> => {
  const apiBase = getApiBase();
  if (apiBase) {
    const response = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (response.ok) {
      const data = await response.json();
      return {
        ...data.user,
        token: data.token
      };
    } else {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || 'Invalid credentials.');
    }
  }
  throw new Error('API is not configured. Admin authentication unavailable offline.');
};

// Dynamic Menu Items
export const getServerMenuItems = async (): Promise<MenuItem[]> => {
  if (isFirebaseClientConfigured()) {
    try {
      const snapshot = await getDocs(collection(db(), FIRESTORE_MENU_ITEMS_COLLECTION));
      const items = snapshot.docs.map((doc) => doc.data() as MenuItem);
      StorageService.saveAdminMenuItems(items);
      return items;
    } catch (error) {
      if (!getApiBase()) return StorageService.getAdminMenuItems();
    }
  }

  try {
    const apiBase = getApiBase();
    if (!apiBase) return StorageService.getAdminMenuItems();
    const response = await fetch(`${apiBase}/menu-items`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Menu items fetch failed with status ${response.status}.`);
    const data = (await response.json()) as { menuItems?: MenuItem[] };
    const items = data.menuItems ?? [];
    StorageService.saveAdminMenuItems(items);
    return items;
  } catch (error) {
    console.warn('API get menu items failed, using cache:', error);
    return StorageService.getAdminMenuItems();
  }
};

export const saveMenuItemToServer = async (item: MenuItem): Promise<void> => {
  const localItems = StorageService.getAdminMenuItems().filter((i) => i.id !== item.id);
  StorageService.saveAdminMenuItems([item, ...localItems]);

  if (isFirebaseClientConfigured()) {
    try {
      await setDoc(doc(db(), FIRESTORE_MENU_ITEMS_COLLECTION, item.id), item, { merge: true });
      return;
    } catch (error) {
      if (!getApiBase()) return;
    }
  }

  try {
    const apiBase = getApiBase();
    if (!apiBase) return;
    const response = await fetch(`${apiBase}/menu-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    if (!response.ok) throw new Error(`Menu item save failed with status ${response.status}.`);
  } catch (error) {
    console.warn('API save menu item failed:', error);
  }
};

export const seedMenuItemsToServer = async (items: MenuItem[]): Promise<void> => {
  StorageService.saveAdminMenuItems(items);

  if (isFirebaseClientConfigured()) {
    try {
      for (const item of items) {
        await setDoc(doc(db(), FIRESTORE_MENU_ITEMS_COLLECTION, item.id), item, { merge: true });
      }
      return;
    } catch (error) {
      if (!getApiBase()) return;
    }
  }

  try {
    const apiBase = getApiBase();
    if (!apiBase) return;
    const response = await fetch(`${apiBase}/menu-items/seed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    });
    if (!response.ok) throw new Error(`Menu items seed failed with status ${response.status}.`);
  } catch (error) {
    console.warn('API seed menu items failed:', error);
  }
};

export const subscribeServerMenuItems = (
  onItems: (items: MenuItem[]) => void,
  onError: (error: Error) => void,
): Unsubscribe | null => {
  if (!isFirebaseClientConfigured()) return null;

  return onSnapshot(
    collection(db(), FIRESTORE_MENU_ITEMS_COLLECTION),
    (snapshot) => {
      const items = snapshot.docs.map((doc) => doc.data() as MenuItem);
      StorageService.saveAdminMenuItems(items);
      onItems(items);
    },
    (error) => onError(error),
  );
};

// Dynamic Outlets
export const getServerOutlets = async (): Promise<OutletConfig[]> => {
  if (isFirebaseClientConfigured()) {
    try {
      const snapshot = await getDocs(collection(db(), FIRESTORE_OUTLETS_COLLECTION));
      const list = snapshot.docs.map((doc) => doc.data() as OutletConfig);
      StorageService.saveAdminOutlets(list);
      return list;
    } catch (error) {
      if (!getApiBase()) return StorageService.getAdminOutlets();
    }
  }

  try {
    const apiBase = getApiBase();
    if (!apiBase) return StorageService.getAdminOutlets();
    const response = await fetch(`${apiBase}/outlets`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Outlets fetch failed with status ${response.status}.`);
    const data = (await response.json()) as { outlets?: OutletConfig[] };
    const list = data.outlets ?? [];
    StorageService.saveAdminOutlets(list);
    return list;
  } catch (error) {
    console.warn('API get outlets failed, using cache:', error);
    return StorageService.getAdminOutlets();
  }
};

export const saveOutletToServer = async (outlet: OutletConfig): Promise<void> => {
  const localList = StorageService.getAdminOutlets().filter((o) => o.id !== outlet.id);
  StorageService.saveAdminOutlets([outlet, ...localList]);

  if (isFirebaseClientConfigured()) {
    try {
      await setDoc(doc(db(), FIRESTORE_OUTLETS_COLLECTION, outlet.id), outlet, { merge: true });
      return;
    } catch (error) {
      if (!getApiBase()) return;
    }
  }

  try {
    const apiBase = getApiBase();
    if (!apiBase) return;
    const response = await fetch(`${apiBase}/outlets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outlet),
    });
    if (!response.ok) throw new Error(`Outlet save failed with status ${response.status}.`);
  } catch (error) {
    console.warn('API save outlet failed:', error);
  }
};

export const deleteOutletFromServer = async (outletId: string): Promise<void> => {
  const localList = StorageService.getAdminOutlets().filter((o) => o.id !== outletId);
  StorageService.saveAdminOutlets(localList);

  try {
    const apiBase = getApiBase();
    if (!apiBase) return;
    const response = await fetch(`${apiBase}/outlets?outletId=${encodeURIComponent(outletId)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || `Outlet delete failed with status ${response.status}.`);
    }
  } catch (error) {
    console.warn('API delete outlet failed:', error);
    throw error;
  }
};

export const seedOutletsToServer = async (outlets: OutletConfig[]): Promise<void> => {
  StorageService.saveAdminOutlets(outlets);

  if (isFirebaseClientConfigured()) {
    try {
      for (const outlet of outlets) {
        await setDoc(doc(db(), FIRESTORE_OUTLETS_COLLECTION, outlet.id), outlet, { merge: true });
      }
      return;
    } catch (error) {
      if (!getApiBase()) return;
    }
  }

  try {
    const apiBase = getApiBase();
    if (!apiBase) return;
    const response = await fetch(`${apiBase}/outlets/seed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outlets),
    });
    if (!response.ok) throw new Error(`Outlets seed failed with status ${response.status}.`);
  } catch (error) {
    console.warn('API seed outlets failed:', error);
  }
};

export const subscribeServerOutlets = (
  onOutlets: (outlets: OutletConfig[]) => void,
  onError: (error: Error) => void,
): Unsubscribe | null => {
  if (!isFirebaseClientConfigured()) return null;

  return onSnapshot(
    collection(db(), FIRESTORE_OUTLETS_COLLECTION),
    (snapshot) => {
      const list = snapshot.docs.map((doc) => doc.data() as OutletConfig);
      StorageService.saveAdminOutlets(list);
      onOutlets(list);
    },
    (error) => onError(error),
  );
};

// Dynamic Offers
export const getServerOffers = async (): Promise<OfferCard[]> => {
  if (isFirebaseClientConfigured()) {
    try {
      const snapshot = await getDocs(collection(db(), FIRESTORE_OFFERS_COLLECTION));
      const list = snapshot.docs.map((doc) => doc.data() as OfferCard);
      StorageService.saveAdminOffers(list);
      return list;
    } catch (error) {
      if (!getApiBase()) return StorageService.getAdminOffers();
    }
  }

  try {
    const apiBase = getApiBase();
    if (!apiBase) return StorageService.getAdminOffers();
    const response = await fetch(`${apiBase}/offers`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Offers fetch failed with status ${response.status}.`);
    const data = (await response.json()) as { offers?: OfferCard[] };
    const list = data.offers ?? [];
    StorageService.saveAdminOffers(list);
    return list;
  } catch (error) {
    console.warn('API get offers failed, using cache:', error);
    return StorageService.getAdminOffers();
  }
};

export const saveOfferToServer = async (offer: OfferCard): Promise<void> => {
  const localList = StorageService.getAdminOffers().filter((o) => o.id !== offer.id);
  StorageService.saveAdminOffers([offer, ...localList]);

  if (isFirebaseClientConfigured()) {
    try {
      await setDoc(doc(db(), FIRESTORE_OFFERS_COLLECTION, offer.id), offer, { merge: true });
      return;
    } catch (error) {
      if (!getApiBase()) return;
    }
  }

  try {
    const apiBase = getApiBase();
    if (!apiBase) return;
    const response = await fetch(`${apiBase}/offers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(offer),
    });
    if (!response.ok) throw new Error(`Offer save failed with status ${response.status}.`);
  } catch (error) {
    console.warn('API save offer failed:', error);
  }
};

export const seedOffersToServer = async (offers: OfferCard[]): Promise<void> => {
  StorageService.saveAdminOffers(offers);

  if (isFirebaseClientConfigured()) {
    try {
      for (const offer of offers) {
        await setDoc(doc(db(), FIRESTORE_OFFERS_COLLECTION, offer.id), offer, { merge: true });
      }
      return;
    } catch (error) {
      if (!getApiBase()) return;
    }
  }

  try {
    const apiBase = getApiBase();
    if (!apiBase) return;
    const response = await fetch(`${apiBase}/offers/seed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(offers),
    });
    if (!response.ok) throw new Error(`Offers seed failed with status ${response.status}.`);
  } catch (error) {
    console.warn('API seed offers failed:', error);
  }
};

export const subscribeServerOffers = (
  onOffers: (offers: OfferCard[]) => void,
  onError: (error: Error) => void,
): Unsubscribe | null => {
  if (!isFirebaseClientConfigured()) return null;

  return onSnapshot(
    collection(db(), FIRESTORE_OFFERS_COLLECTION),
    (snapshot) => {
      const list = snapshot.docs.map((doc) => doc.data() as OfferCard);
      StorageService.saveAdminOffers(list);
      onOffers(list);
    },
    (error) => onError(error),
  );
};

export const changeStaffPassword = async (
  username: string,
  newPassword: string
): Promise<void> => {
  const apiBase = getApiBase();
  if (apiBase) {
    const response = await fetch(`${apiBase}/auth/change-password`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ username, newPassword }),
    });
    if (response.ok) return;
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
      const list = snapshot.docs.map((doc) => doc.data() as WalletTransaction);
      StorageService.saveAdminTransactions(list);
      return list;
    } catch (error) {
      if (!getApiBase()) return StorageService.getAdminTransactions();
    }
  }

  try {
    const apiBase = getApiBase();
    if (!apiBase) return StorageService.getAdminTransactions();
    const response = await fetch(`${apiBase}/wallet/transactions`, {
      headers: getAuthHeaders(),
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`Transactions fetch failed with status ${response.status}.`);
    const data = (await response.json()) as { transactions?: WalletTransaction[] };
    const list = data.transactions ?? [];
    StorageService.saveAdminTransactions(list);
    return list;
  } catch (error) {
    console.warn('API get transactions failed, using cache:', error);
    return StorageService.getAdminTransactions();
  }
};

export const saveWalletTransactionToServer = async (transaction: WalletTransaction): Promise<void> => {
  const localList = StorageService.getAdminTransactions().filter((t) => t.id !== transaction.id);
  StorageService.saveAdminTransactions([transaction, ...localList]);

  if (isFirebaseClientConfigured()) {
    try {
      await setDoc(doc(db(), FIRESTORE_WALLET_TRANSACTIONS_COLLECTION, transaction.id), transaction, { merge: true });
      return;
    } catch (error) {
      if (!getApiBase()) return;
    }
  }

  try {
    const apiBase = getApiBase();
    if (!apiBase) return;
    const response = await fetch(`${apiBase}/wallet/transactions`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(transaction),
    });
    if (!response.ok) throw new Error(`Transaction save failed with status ${response.status}.`);
  } catch (error) {
    console.warn('API save transaction failed:', error);
  }
};

export const subscribeServerWalletTransactions = (
  onTransactions: (transactions: WalletTransaction[]) => void,
  onError: (error: Error) => void,
): Unsubscribe | null => {
  if (!isFirebaseClientConfigured()) return null;

  return onSnapshot(
    query(collection(db(), FIRESTORE_WALLET_TRANSACTIONS_COLLECTION), orderBy('createdAt', 'desc')),
    (snapshot) => {
      const list = snapshot.docs.map((doc) => doc.data() as WalletTransaction);
      StorageService.saveAdminTransactions(list);
      onTransactions(list);
    },
    (error) => onError(error),
  );
};

export const getServerSettings = async (): Promise<AppSettings> => {
  const apiBase = getApiBase();
  if (!apiBase) return {};
  const response = await fetch(`${apiBase}/settings`);
  if (!response.ok) throw new Error('Failed to load settings.');
  const data = await response.json();
  return data.settings || {};
};

export const saveSettingsToServer = async (settings: AppSettings): Promise<void> => {
  const apiBase = getApiBase();
  if (!apiBase) return;
  const response = await fetch(`${apiBase}/settings`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error('Failed to save settings.');
};

export const getFirestoreUsage = async (): Promise<any[]> => {
  const apiBase = getApiBase();
  if (!apiBase) return [];
  const response = await fetch(`${apiBase}/customers?action=usage`, {
    headers: getAuthHeaders(),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error('Failed to load usage stats.');
  const data = await response.json();
  return data.usage || [];
};

export interface BackupDetail {
  filename: string;
  size: string;
  createdAt: string;
  location: string;
  status: string;
}

export interface BackupStatusResponse {
  success: boolean;
  backups: BackupDetail[];
  lastBackupTime: string;
  lastBackupSize: string;
  lastBackupStatus: string;
  lastBackupLocation: string;
}

export const getBackupStatus = async (): Promise<BackupStatusResponse> => {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('API is not configured.');
  const response = await fetch(`${apiBase}/admin/backup`, {
    headers: getAuthHeaders(),
    cache: 'no-store'
  });
  if (!response.ok) throw new Error('Failed to load backup status.');
  return (await response.json()) as BackupStatusResponse;
};

export const triggerDatabaseBackup = async (): Promise<any> => {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('API is not configured.');
  const response = await fetch(`${apiBase}/admin/backup`, {
    method: 'POST',
    headers: getAuthHeaders()
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to trigger database backup.');
  }
  return await response.json();
};

export const triggerDatabaseRestore = async (filename: string): Promise<any> => {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('API is not configured.');
  const response = await fetch(`${apiBase}/admin/restore`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ filename })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message || 'Failed to restore database from backup.');
  }
  return await response.json();
};



