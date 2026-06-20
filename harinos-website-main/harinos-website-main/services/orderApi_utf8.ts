import { CustomerProfile, Order, OrderStatus } from '../types';
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
    await updateDoc(doc(db(), FIRESTORE_CUSTOMERS_COLLECTION, customerId), { verified: true });
    return null;
  }

  if (!getApiBase()) return null;
  const response = await fetch(`${getApiBase()}/customers/${encodeURIComponent(customerId)}/verify`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(`Customer verification failed with status ${response.status}.`);
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
