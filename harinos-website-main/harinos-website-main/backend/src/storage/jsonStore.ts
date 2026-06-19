import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { CustomerProfile, FullOrderPayload, OrderStatus, MenuItem, OutletConfig, OfferCard, AdminUser, WalletTransaction, AppSettings } from '../types.js';
import { OrderStore, newestOrdersFirst } from './store.js';

const dataRoot = path.resolve(config.fileStore.rootPath);
const ordersFile = path.join(dataRoot, 'orders.json');
const customersFile = path.join(dataRoot, 'customers.json');
const menuItemsFile = path.join(dataRoot, 'menu_items.json');
const outletsFile = path.join(dataRoot, 'outlets.json');
const offersFile = path.join(dataRoot, 'offers.json');
const staffUsersFile = path.join(dataRoot, 'staff_users.json');
const walletTransactionsFile = path.join(dataRoot, 'wallet_transactions.json');
const settingsFile = path.join(dataRoot, 'settings.json');



const readJson = async <T,>(filePath: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
};

export const getStoredOrders = async (options?: { role?: string; outletId?: string; limit?: number; lastVisible?: string }): Promise<FullOrderPayload[]> => {
  const orders = await readJson<FullOrderPayload[]>(ordersFile, []);
  return newestOrdersFirst(orders);
};

export const saveStoredOrder = async (order: FullOrderPayload): Promise<void> => {
  const orders = (await getStoredOrders()).filter((existing) => existing.id !== order.id);
  await writeJson(ordersFile, [order, ...orders]);
};

export const updateStoredOrderStatus = async (orderId: string, status: OrderStatus): Promise<void> => {
  await writeJson(
    ordersFile,
    (await getStoredOrders()).map((order) => (order.id === orderId ? { ...order, status } : order)),
  );
};

export const getStoredCustomers = async (): Promise<CustomerProfile[]> => {
  const list = await readJson<CustomerProfile[]>(customersFile, []);
  return list.sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  });
};

export const saveStoredCustomer = async (profile: CustomerProfile): Promise<void> => {
  const customers = (await getStoredCustomers()).filter((customer) => customer.id !== profile.id);
  await writeJson(customersFile, [profile, ...customers]);
};

export const verifyStoredCustomer = async (customerId: string): Promise<CustomerProfile | null> => {
  let updatedCustomer: CustomerProfile | null = null;
  const allCustomers = await getStoredCustomers();
  const targetCustomer = allCustomers.find((c) => c.id === customerId);
  if (!targetCustomer) return null;

  const cleanPhone = (p: string) => p.replace(/\D/g, '');
  const targetPhone = cleanPhone(targetCustomer.phone);
  
  const alreadyVerified = allCustomers.some(
    (c) => c.verified && c.id !== customerId && c.phone && cleanPhone(c.phone) === targetPhone
  );

  if (alreadyVerified) {
    throw new Error('This phone number is already verified under another profile.');
  }

  const generateReferralCode = () => {
    return Math.floor(65536 + Math.random() * 983039).toString(16).toUpperCase();
  };
  const referralCode = targetCustomer.referralCode ?? generateReferralCode();

  const customers = allCustomers.map((customer) => {
    if (customer.id !== customerId) return customer;
    updatedCustomer = { ...customer, verified: true, referralCode };
    return updatedCustomer;
  });
  await writeJson(customersFile, customers);
  return updatedCustomer;
};

export const getStoredMenuItems = async (): Promise<MenuItem[]> =>
  readJson<MenuItem[]>(menuItemsFile, []);

export const saveStoredMenuItem = async (item: MenuItem): Promise<void> => {
  const items = (await getStoredMenuItems()).filter((existing) => existing.id !== item.id);
  await writeJson(menuItemsFile, [...items, item]);

  const settings = await getStoredSettings();
  settings.menuVersion = Date.now().toString();
  await saveStoredSettings(settings);
};

export const getStoredOutlets = async (): Promise<OutletConfig[]> =>
  readJson<OutletConfig[]>(outletsFile, []);

export const saveStoredOutlet = async (outlet: OutletConfig): Promise<void> => {
  const outlets = (await getStoredOutlets()).filter((existing) => existing.id !== outlet.id);
  await writeJson(outletsFile, [...outlets, outlet]);

  const settings = await getStoredSettings();
  settings.menuVersion = Date.now().toString();
  await saveStoredSettings(settings);
};

export const getStoredOffers = async (): Promise<OfferCard[]> =>
  readJson<OfferCard[]>(offersFile, []);

export const saveStoredOffer = async (offer: OfferCard): Promise<void> => {
  const offers = (await getStoredOffers()).filter((existing) => existing.id !== offer.id);
  await writeJson(offersFile, [...offers, offer]);

  const settings = await getStoredSettings();
  settings.menuVersion = Date.now().toString();
  await saveStoredSettings(settings);
};

export const getStoredStaffUsers = async (): Promise<AdminUser[]> =>
  readJson<AdminUser[]>(staffUsersFile, []);

export const saveStoredStaffUser = async (user: AdminUser): Promise<void> => {
  const users = (await getStoredStaffUsers()).filter((existing) => existing.username !== user.username);
  await writeJson(staffUsersFile, [...users, user]);
};

export const getStoredWalletTransactions = async (): Promise<WalletTransaction[]> =>
  readJson<WalletTransaction[]>(walletTransactionsFile, []);

export const saveStoredWalletTransaction = async (transaction: WalletTransaction): Promise<void> => {
  const transactions = (await getStoredWalletTransactions()).filter((existing) => existing.id !== transaction.id);
  await writeJson(walletTransactionsFile, [transaction, ...transactions]);
};

export const getStoredSettings = async (): Promise<AppSettings> =>
  readJson<AppSettings>(settingsFile, {});

export const saveStoredSettings = async (settings: AppSettings): Promise<void> => {
  await writeJson(settingsFile, settings);
};

export const jsonStore: OrderStore = {
  name: 'json',
  getOrders: getStoredOrders,
  saveOrder: saveStoredOrder,
  updateOrderStatus: updateStoredOrderStatus,
  getCustomers: getStoredCustomers,
  getCustomer: async (customerId) => (await getStoredCustomers()).find((c) => c.id === customerId) || null,
  saveCustomer: saveStoredCustomer,
  verifyCustomer: verifyStoredCustomer,
  getMenuItems: getStoredMenuItems,
  saveMenuItem: saveStoredMenuItem,
  getOutlets: getStoredOutlets,
  saveOutlet: saveStoredOutlet,
  getOffers: getStoredOffers,
  saveOffer: saveStoredOffer,
  getStaffUsers: getStoredStaffUsers,
  saveStaffUser: saveStoredStaffUser,
  getWalletTransactions: getStoredWalletTransactions,
  saveWalletTransaction: saveStoredWalletTransaction,
  getSettings: getStoredSettings,
  saveSettings: saveStoredSettings,
};


