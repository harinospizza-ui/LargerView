import { CustomerProfile, FullOrderPayload, OrderStatus, MenuItem, OutletConfig, OfferCard, AdminUser, WalletTransaction } from '../types.js';

export interface OrderStore {
  name: string;
  getOrders(): Promise<FullOrderPayload[]>;
  saveOrder(order: FullOrderPayload): Promise<void>;
  updateOrderStatus(orderId: string, status: OrderStatus): Promise<void>;
  getCustomers(): Promise<CustomerProfile[]>;
  saveCustomer(profile: CustomerProfile): Promise<void>;
  verifyCustomer(customerId: string): Promise<CustomerProfile | null>;
  getMenuItems(): Promise<MenuItem[]>;
  saveMenuItem(item: MenuItem): Promise<void>;
  getOutlets(): Promise<OutletConfig[]>;
  saveOutlet(outlet: OutletConfig): Promise<void>;
  getOffers(): Promise<OfferCard[]>;
  saveOffer(offer: OfferCard): Promise<void>;
  getStaffUsers(): Promise<AdminUser[]>;
  saveStaffUser(user: AdminUser): Promise<void>;
  getWalletTransactions(): Promise<WalletTransaction[]>;
  saveWalletTransaction(transaction: WalletTransaction): Promise<void>;
}

export const newestOrdersFirst = (orders: FullOrderPayload[]): FullOrderPayload[] =>
  [...orders].sort(
    (a, b) => new Date(b.receivedAt ?? b.date).getTime() - new Date(a.receivedAt ?? a.date).getTime(),
  );
