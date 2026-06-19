export type OrderType = 'takeaway' | 'delivery' | 'dinein';

export interface OrderItemPayload {
  id: string;
  name: string;
  quantity: number;
  selectedSize?: string;
  basePrice: number;
  discountedPrice: number;
  totalPrice: number;
  isOfferBonus?: boolean;
  appliedOfferId?: string;
  appliedOfferTitle?: string;
}

export interface OutletPayload {
  id: string;
  name: string;
  address: string;
  phone: string;
}

export interface CreateOrderRequest {
  orderId: string;
  items: OrderItemPayload[];
  total: number;
  orderType: OrderType;
  deliveryFee: number;
  location: string;
  createdAt: string;
  distanceKm: number | null;
  outlet: OutletPayload;
}

export type OrderStatus = 'new' | 'preparing' | 'ready' | 'out_for_delivery' | 'done' | 'cancelled';

export interface CustomerProfile {
  id: string;
  name: string;
  phone: string;
  email?: string;
  loginMethod: 'email' | 'phone';
  verified?: boolean;
  avatar?: string;
  referralCode?: string;
  referredBy?: string;
  referralAttempts?: number;
  referralApplied?: boolean;
  otp?: string;
  otpExpiry?: number;
  createdAt: string;
  walletBalance?: number;
  rewardPoints?: number;
  referralCodeUsed?: boolean;
  referralAttemptsRemaining?: number;
  referralLocked?: boolean;
  referralAppliedAt?: string;
  status?: 'active' | 'blocked' | 'removed';
}

export interface WalletTransaction {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  amount: number;
  type: 'topup' | 'reward' | 'debit' | 'credit' | 'admin_adjustment';
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
}

export interface FullOrderPayload {
  id: string;
  items: unknown[];
  total: number;
  date: string;
  orderType: string;
  deliveryFee?: number;
  outletId?: string;
  outletName?: string;
  outletPhone?: string;
  outletAddress?: string;
  customerLocationUrl?: string;
  distanceKm?: number | null;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  paymentMethod?: string;
  receivedAt?: string;
  status?: OrderStatus;
  walletAmountRedeemed?: number;
  rewardPointsRedeemed?: number;
  rewardPointsEarned?: number;
}

export type AdminRole = 'admin' | 'manager' | 'staff';

export interface AdminUser {
  role: AdminRole;
  username: string;
  password: string;
  outletId: string | null;
}

export interface SizeOption {
  label: string;
  price: number;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  image: string;
  popular?: boolean;
  spicy?: boolean;
  vegetarian: boolean;
  available: boolean;
  sizes?: SizeOption[];
}

export interface OfferCard {
  id: string;
  enabled: boolean;
  image: string;
  offerTitle: string;
  displayText: string;
  offerPercentage?: number;
  condition: string;
  additionalItem?: string;
  additionalItemImage?: string;
  notifyCustomers?: boolean;
}

export interface OutletConfig {
  id: string;
  enabled: boolean;
  name: string;
  address?: string;
  phone: string;
  latitude: number;
  longitude: number;
  deliveryRadiusKm: number;
  freeDeliveryRadiusKm: number;
  freeDeliveryMinimumOrder: number;
  minimumOrderIncrementPerKm: number;
  deliveryChargePerKm: number;
}

export interface AppSettings {
  instagramUrl?: string;
}


