
import { AdminSession, CustomerProfile, Order, WalletTransaction, MenuItem, OutletConfig, OfferCard } from '../types';
import { safeStorage } from './browserSupport';

const KEYS = {
  ORDERS: 'harinos_past_orders',
  PENDING_ORDERS: 'harinos_pending_orders',
  ADMIN_SESSION: 'harinos_admin_session',
  CUSTOMER_PROFILE: 'harinos_customer_profile',
  VERIFIED_CUSTOMERS: 'harinos_verified_customers',
  FCM_TOKEN: 'harinos_fcm_token',
  ADMIN_ORDERS: 'harinos_admin_orders',
  ADMIN_CUSTOMERS: 'harinos_admin_customers',
  ADMIN_TRANSACTIONS: 'harinos_admin_transactions',
  ADMIN_MENU_ITEMS: 'harinos_admin_menu_items',
  ADMIN_OUTLETS: 'harinos_admin_outlets',
  ADMIN_OFFERS: 'harinos_admin_offers',
};

const readJson = <T,>(key: string, fallback: T): T => {
  const saved = safeStorage.getItem(window.localStorage, key);
  if (!saved) return fallback;
  try {
    return JSON.parse(saved) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown): void => {
  safeStorage.setItem(window.localStorage, key, JSON.stringify(value));
};

const readSessionJson = <T,>(key: string, fallback: T): T => {
  const saved = safeStorage.getItem(window.sessionStorage, key);
  if (!saved) return fallback;
  try {
    return JSON.parse(saved) as T;
  } catch {
    return fallback;
  }
};

const writeSessionJson = (key: string, value: unknown): void => {
  safeStorage.setItem(window.sessionStorage, key, JSON.stringify(value));
};

export const StorageService = {
  getPastOrders: (): Order[] => {
    const saved = safeStorage.getItem(window.localStorage, KEYS.ORDERS);
    try {
      return saved ? JSON.parse(saved).slice(0, 3) : [];
    } catch {
      return [];
    }
  },
  saveOrder: (order: Order) => {
    const orders = StorageService.getPastOrders();
    const updatedOrders = [order, ...orders].slice(0, 3);
    safeStorage.setItem(window.localStorage, KEYS.ORDERS, JSON.stringify(updatedOrders));
  },
  saveAdminSession: (session: AdminSession): void => writeSessionJson(KEYS.ADMIN_SESSION, session),
  getAdminSession: (): AdminSession | null => readSessionJson<AdminSession | null>(KEYS.ADMIN_SESSION, null),
  clearAdminSession: (): void => {
    safeStorage.removeItem(window.sessionStorage, KEYS.ADMIN_SESSION);
  },
  updateSessionActivity: (): void => {
    const session = StorageService.getAdminSession();
    if (!session) return;
    StorageService.saveAdminSession({ ...session, lastActivityTime: new Date().toISOString() });
  },
  saveCustomerProfile: (profile: CustomerProfile): void => writeJson(KEYS.CUSTOMER_PROFILE, profile),
  getCustomerProfile: (): CustomerProfile | null => readJson<CustomerProfile | null>(KEYS.CUSTOMER_PROFILE, null),
  getVerifiedCustomers: (): Record<string, boolean> => readJson<Record<string, boolean>>(KEYS.VERIFIED_CUSTOMERS, {}),
  markCustomerVerified: (customerId: string): void => {
    const verified = StorageService.getVerifiedCustomers();
    verified[customerId] = true;
    writeJson(KEYS.VERIFIED_CUSTOMERS, verified);
  },
  saveFCMToken: (token: string): void => {
    safeStorage.setItem(window.localStorage, KEYS.FCM_TOKEN, token);
  },
  getFCMToken: (): string | null => {
    return safeStorage.getItem(window.localStorage, KEYS.FCM_TOKEN);
  },
  clearFCMToken: (): void => {
    safeStorage.removeItem(window.localStorage, KEYS.FCM_TOKEN);
  },
  
  // Local admin fallback methods
  getAdminOrders: (): Order[] => readJson<Order[]>(KEYS.ADMIN_ORDERS, []),
  saveAdminOrders: (orders: Order[]): void => writeJson(KEYS.ADMIN_ORDERS, orders),
  getAdminCustomers: (): CustomerProfile[] => readJson<CustomerProfile[]>(KEYS.ADMIN_CUSTOMERS, []),
  saveAdminCustomers: (customers: CustomerProfile[]): void => writeJson(KEYS.ADMIN_CUSTOMERS, customers),
  getAdminTransactions: (): WalletTransaction[] => readJson<WalletTransaction[]>(KEYS.ADMIN_TRANSACTIONS, []),
  saveAdminTransactions: (transactions: WalletTransaction[]): void => writeJson(KEYS.ADMIN_TRANSACTIONS, transactions),
  getAdminMenuItems: (): MenuItem[] => readJson<MenuItem[]>(KEYS.ADMIN_MENU_ITEMS, []),
  saveAdminMenuItems: (items: MenuItem[]): void => writeJson(KEYS.ADMIN_MENU_ITEMS, items),
  getAdminOutlets: (): OutletConfig[] => readJson<OutletConfig[]>(KEYS.ADMIN_OUTLETS, []),
  saveAdminOutlets: (outlets: OutletConfig[]): void => writeJson(KEYS.ADMIN_OUTLETS, outlets),
  getAdminOffers: (): OfferCard[] => readJson<OfferCard[]>(KEYS.ADMIN_OFFERS, []),
  saveAdminOffers: (offers: OfferCard[]): void => writeJson(KEYS.ADMIN_OFFERS, offers),
};
