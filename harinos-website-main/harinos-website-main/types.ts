
export enum Category {
  PIZZA = 'Pizza',
  MOMOS = 'Momos',
  FRIES = 'Fries',
  BURGERS = 'Burgers',
  SIDES = 'Sides',
  BEVERAGES = 'Beverages'
}

export type CategoryFilter = Category | 'All';

export interface SizeOption {
  label: string;
  price: number;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: Category;
  image: string;
  popular?: boolean;
  spicy?: boolean;
  vegetarian: true;
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
  managerName?: string;
}

export interface CustomerLocation {
  latitude: number;
  longitude: number;
  mapUrl: string;
}

export interface CartItem extends MenuItem {
  quantity: number;
  selectedSize?: string;
  basePrice: number;
  isOfferBonus?: boolean;
  sourceOfferId?: string;
  originalPrice?: number;
}

export interface PricedCartItem extends CartItem {
  discountedPrice: number;
  totalPrice: number;
  appliedOfferId?: string;
  appliedOfferTitle?: string;
}

export interface OrderItem extends PricedCartItem {}

export interface Order {
  id: string;
  items: OrderItem[];
  total: number;
  date: string;
  orderType: OrderType;
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
  statusUpdatedAt?: string;
  customerLocation?: CustomerLocation;
  estimatedTime?: string;
  walletAmountRedeemed?: number;
  rewardPointsRedeemed?: number;
  rewardPointsEarned?: number;
  isDeleted?: boolean;
  cancelledBy?: string;
  cancellationReason?: string;
  auditTrail?: Array<{
    timestamp: string;
    updatedBy: string;
    action: string;
    previousStatus?: string;
    newStatus?: string;
    reason?: string;
  }>;
}

export interface Notification {
  id: string;
  orderId: string;
  userId: string;
  userType: 'admin' | 'manager' | 'staff' | 'customer';
  title: string;
  message: string;
  status: OrderStatus;
  timestamp: string;
  read: boolean;
  customerName?: string;
  customerPhone?: string;
}

export type OrderType = 'takeaway' | 'delivery' | 'dinein';

export type OrderStatus = 'new' | 'preparing' | 'ready' | 'out_for_delivery' | 'done' | 'cancelled';

export type AdminRole = 'admin' | 'manager' | 'staff';

export interface AdminSession {
  role: AdminRole;
  username: string;
  outletId: string | null;
  loginTime: string;
  lastActivityTime: string;
  token?: string;
  firebaseToken?: string;
  sessionId?: string;
}

export interface CustomerProfile {
  id: string;
  customerId?: string;
  name: string;
  fullName?: string;
  phone: string;
  mobileNumber?: string;
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
  lastLogin?: string;
  active?: boolean;
  walletBalance?: number;
  rewardPoints?: number;
  loyaltyPoints?: number;
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

export interface FCMTokenData {
  token: string;
  savedAt: string;
}

export interface AppSettings {
  instagramUrl?: string;
  menuVersion?: string;
}

export interface VerificationRequest {
  requestId: string;
  customerName: string;
  mobileNumber: string;
  otp: string;
  status: 'pending' | 'verified';
  createdAt: string;
  verifiedAt: string | null;
  verifiedBy: string | null;
}



