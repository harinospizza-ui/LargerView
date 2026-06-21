import { CustomerProfile, Order, OrderStatus, MenuItem, OutletConfig, OfferCard, WalletTransaction, AppSettings } from '../types';
import { StorageService } from './storage';
import {
  db,
  FIRESTORE_ORDERS_COLLECTION,
  FIRESTORE_CUSTOMERS_COLLECTION,
  FIRESTORE_MENU_ITEMS_COLLECTION,
  FIRESTORE_OUTLETS_COLLECTION,
  FIRESTORE_OFFERS_COLLECTION,
  FIRESTORE_WALLET_TRANSACTIONS_COLLECTION,
  FIRESTORE_NOTIFICATION_TOKENS_COLLECTION
} from './firebaseClient';
import { doc, getDoc, getDocs, setDoc, deleteDoc, collection, query, where, orderBy, limit, startAfter, onSnapshot, updateDoc, getCountFromServer } from 'firebase/firestore';

export type Unsubscribe = () => void;

let dynamicApiUrl = (import.meta.env.VITE_ORDER_API_BASE_URL ?? '/api').trim() || '/api';

const originalFetch = window.fetch;
const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  let targetInput = input;
  if (typeof input === 'string' && input.startsWith('/api') && dynamicApiUrl.startsWith('http')) {
    targetInput = dynamicApiUrl + input.substring(4);
  }
  const response = await originalFetch(targetInput, init);
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

const getApiBase = (): string | null => dynamicApiUrl || null;
export const isOrderApiConfigured = (): boolean => Boolean(getApiBase());

const getAuthHeaders = (): Record<string, string> => {
  const session = StorageService.getAdminSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session) {
    if (session.token) {
      headers['Authorization'] = `Bearer ${session.token}`;
    }
    if (session.sessionId) {
      headers['X-Session-Id'] = session.sessionId;
    }
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
    let ordersList = snapshot.docs.map((docDoc) => docDoc.data() as Order);

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

export const updateServerOrderStatus = async (orderId: string, status: OrderStatus): Promise<void> => {
  const localOrders = StorageService.getAdminOrders();
  const idx = localOrders.findIndex((o) => o.id === orderId);
  if (idx >= 0) {
    localOrders[idx] = { ...localOrders[idx], status, statusUpdatedAt: new Date().toISOString() };
    StorageService.saveAdminOrders(localOrders);
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

  try {
    await setDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, profile.id), profile, { merge: true });
  } catch (error) {
    console.warn('Direct Firestore save customer failed:', error);
    throw error;
  }
};

export const deleteCustomerFromServer = async (customerId: string): Promise<void> => {
  const localCusts = StorageService.getAdminCustomers().filter((c) => c.id !== customerId);
  StorageService.saveAdminCustomers(localCusts);

  try {
    await deleteDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, customerId));
  } catch (error) {
    console.warn('Direct Firestore delete customer failed:', error);
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
  try {
    const snapshot = await getDocs(
      query(collection(db(), FIRESTORE_CUSTOMERS_COLLECTION), orderBy('createdAt', 'desc'), limit(500))
    );
    const sorted = sortCustomers(snapshot.docs.map((docDoc) => docDoc.data() as CustomerProfile));
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

export const verifyServerCustomer = async (customerId: string, otp?: string): Promise<CustomerProfile | null> => {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');

  const response = await fetch(`${apiBase}/customers/${encodeURIComponent(customerId)}/verify`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ otp }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Customer verification failed with status ${response.status}.`);
  }

  const data = (await response.json()) as { customer?: CustomerProfile };
  const updated = data.customer ?? null;
  if (updated) {
    const localCusts = StorageService.getAdminCustomers();
    const idx = localCusts.findIndex((c) => c.id === customerId);
    if (idx >= 0) {
      localCusts[idx] = updated;
    } else {
      localCusts.push(updated);
    }
    StorageService.saveAdminCustomers(localCusts);
  }
  return updated;
};

export const sendOtpToCustomer = async (customerId: string): Promise<any> => {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');

  const response = await fetch(`${apiBase}/customers?action=send-otp`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ customerId }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Failed to send OTP.`);
  }

  return await response.json();
};

export const blockCustomerOnServer = async (customerId: string, blocked: boolean): Promise<any> => {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');

  const response = await fetch(`${apiBase}/customers?action=block`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ customerId, blocked }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Failed to update block status.`);
  }

  return await response.json();
};

export const bulkRemoveCustomersFromServer = async (customerIds: string[]): Promise<any> => {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');

  const response = await fetch(`${apiBase}/customers?action=bulk-remove`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ customerIds }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Failed bulk delete operation.`);
  }

  return await response.json();
};

export const mergeCustomersOnServer = async (primaryId: string, secondaryId: string): Promise<any> => {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('Central API is not configured.');

  const response = await fetch(`${apiBase}/customers?action=merge`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ primaryId, secondaryId }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Failed merge operation.`);
  }

  return await response.json();
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
      let ordersList = snapshot.docs.map((docDoc) => docDoc.data() as Order);
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
      const customers = snapshot.docs.map((docDoc) => docDoc.data() as CustomerProfile);
      onCustomers(customers);
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
        token: data.token,
        sessionId: data.sessionId,
        firebaseToken: data.firebaseToken,
      };
    } else {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.message || 'Invalid credentials.');
    }
  }
  throw new Error('API is not configured. Admin authentication unavailable offline.');
};

export const getServerMenuItems = async (): Promise<MenuItem[]> => {
  try {
    const snapshot = await getDocs(collection(db(), FIRESTORE_MENU_ITEMS_COLLECTION));
    const items = snapshot.docs.map((docDoc) => docDoc.data() as MenuItem);
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
      const items = snapshot.docs.map((docDoc) => docDoc.data() as MenuItem);
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
    const list = snapshot.docs.map((docDoc) => docDoc.data() as OutletConfig);
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
      const outlets = snapshot.docs.map((docDoc) => docDoc.data() as OutletConfig);
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
    const list = snapshot.docs.map((docDoc) => docDoc.data() as OfferCard);
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
      const offers = snapshot.docs.map((docDoc) => docDoc.data() as OfferCard);
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
  try {
    const snapshot = await getDocs(
      query(collection(db(), FIRESTORE_WALLET_TRANSACTIONS_COLLECTION), orderBy('createdAt', 'desc'), limit(500))
    );
    const list = snapshot.docs.map((docDoc) => docDoc.data() as WalletTransaction);
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
      const txs = snapshot.docs.map((docDoc) => docDoc.data() as WalletTransaction);
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
    console.warn('Direct Firestore get settings failed:', error);
    return {};
  }
};

export const saveSettingsToServer = async (settings: AppSettings): Promise<void> => {
  try {
    await setDoc(doc(db(), 'settings', 'app'), settings, { merge: true });
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
