import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OUTLET_LOCATIONS } from '../constants';
import {
  getServerCustomers,
  getServerOrders,
  isOrderApiConfigured,
  subscribeServerCustomers,
  subscribeServerOrders,
  updateServerOrderStatus,
  verifyServerCustomer,
  authenticateAdminViaApi,
  getServerMenuItems,
  saveMenuItemToServer,
  getServerOutlets,
  saveOutletToServer,
  getServerOffers,
  saveOfferToServer,
  changeStaffPassword,
  saveWalletTransactionToServer,
  saveCustomerToServer,
  getServerWalletTransactions,
  subscribeServerWalletTransactions,
} from '../services/orderApi';
import { StorageService } from '../services/storage';
import { notifyCustomerStatusChange } from '../services/notificationService';
import { useFCMNotifications } from '../hooks/useFCMNotifications';
import { getDisplayOrderId } from '../App';
import { AdminSession, CustomerProfile, Order, OrderStatus, MenuItem, OutletConfig, OfferCard, WalletTransaction, Category } from '../types';

interface AdminPanelProps {
  session: AdminSession | null;
  onSessionChange: (session: AdminSession | null) => void;
  onClose: () => void;
}

const normalizePhoneForWhatsApp = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
};

const statusLabel = (status?: OrderStatus): string => (status ?? 'new').replace(/_/g, ' ').toUpperCase();

const statusClass = (status?: OrderStatus): string => {
  switch (status ?? 'new') {
    case 'new':
      return 'border-red-500/40 bg-red-500/15 text-red-100';
    case 'preparing':
      return 'border-amber-400/40 bg-amber-400/15 text-amber-100';
    case 'ready':
      return 'border-blue-400/40 bg-blue-400/15 text-blue-100';
    case 'out_for_delivery':
      return 'border-violet-400/40 bg-violet-400/15 text-violet-100';
    case 'done':
      return 'border-emerald-400/40 bg-emerald-400/15 text-emerald-100';
    case 'cancelled':
      return 'border-slate-500/50 bg-slate-600/20 text-slate-300';
    default:
      return 'border-slate-500/50 bg-slate-700/30 text-slate-200';
  }
};

const receiptHtml = (order: Order): string => `
<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${order.id}</title>
<style>
  *{box-sizing:border-box}
  body{
    font-family:'Courier New',monospace;
    font-size:10px;
    line-height:1.2;
    color:#000;
    background:#fff;
    margin:0;
    padding:2mm;
    width: 54mm;
  }
  .center{text-align:center}
  .brand{font-size:14px;font-weight:900;letter-spacing:.05em}
  .dash{border-top:1px dashed #000;margin:4px 0}
  .row{display:flex;justify-content:space-between;gap:4px}
  .total{font-size:12px;font-weight:900}
  @media print{
    @page {
      size: 54mm auto;
      margin: 0;
    }
    body {
      width: 54mm;
      margin: 0;
      padding: 1mm;
    }
  }
</style></head><body>
<div class="center"><div class="brand">HARINO'S PIZZA</div><div>${order.outletName ?? ''}</div></div>
<div class="dash"></div>
<div class="center"><b>ORDER: #${getDisplayOrderId(order.id)}</b><br>${order.orderType.toUpperCase()}<br>${new Date(order.receivedAt ?? order.date).toLocaleString()}</div>
<div class="dash"></div>
<div>Cust: ${order.customerName ?? 'Customer'}</div>
<div>Ph: ${order.customerPhone ?? ''}</div>
<div class="dash"></div>
${order.items.map((item) => `<div class="row"><span>${item.quantity}x ${item.name}${item.selectedSize ? ` [${item.selectedSize}]` : ''}</span><b>Rs ${Math.round(item.totalPrice)}</b></div>`).join('')}
<div class="dash"></div>
<div class="row"><span>Subtotal</span><b>Rs ${Math.round(order.total - (order.deliveryFee ?? 0) + (order.walletAmountRedeemed ?? 0) + (order.rewardPointsRedeemed ?? 0))}</b></div>
${order.deliveryFee ? `<div class="row"><span>Delivery Fee</span><b>Rs ${Math.round(order.deliveryFee)}</b></div>` : ''}
${order.walletAmountRedeemed ? `<div class="row"><span>Wallet Paid</span><b>-Rs ${Math.round(order.walletAmountRedeemed)}</b></div>` : ''}
${order.rewardPointsRedeemed ? `<div class="row"><span>Points Paid</span><b>-Rs ${Math.round(order.rewardPointsRedeemed)}</b></div>` : ''}
<div class="dash"></div>
<div class="row total"><span>GRAND TOTAL</span><span>Rs ${Math.round(order.total)}</span></div>
<div class="dash"></div>
<div class="center">Thank you! Come again!<br>Because Hari Knows</div>
</body></html>`;

const printOrder = (order: Order) => {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(receiptHtml(order));
  win.document.close();
  win.focus();
  window.setTimeout(() => {
    win.print();
    win.close();
  }, 250);
};

const combineCustomers = (remoteCustomers: CustomerProfile[]): CustomerProfile[] => {
  return remoteCustomers.filter(
    (customer, index, list) => list.findIndex((item) => item.id === customer.id) === index,
  );
};

const AdminPanel: React.FC<AdminPanelProps> = ({ session, onSessionChange, onClose }) => {
  useFCMNotifications({
    userId: session?.username,
    role: session?.role,
    outletId: session?.outletId || undefined,
  });

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'orders' | 'wallets' | 'menu' | 'outlets' | 'offers'>('orders');

  // Dynamic state loaded from server
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [outlets, setOutlets] = useState<OutletConfig[]>([]);
  const [offers, setOffers] = useState<OfferCard[]>([]);
  const [walletSearchQuery, setWalletSearchQuery] = useState('');
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);

  // Change Password Form State
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [adminVerifyPassword, setAdminVerifyPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [selectedUserForPassword, setSelectedUserForPassword] = useState(session?.username ?? 'Admin_Harinos');

  // Add Menu Item Form State
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [newItemId, setNewItemId] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [newItemDesc, setNewItemDesc] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<Category>(Category.PIZZA);
  const [newItemImage, setNewItemImage] = useState('');
  const [newItemSpicy, setNewItemSpicy] = useState(false);
  const [newItemPopular, setNewItemPopular] = useState(false);

  // Date Slabs collapse states
  const [expandedDates, setExpandedDates] = useState<{ [dateStr: string]: boolean }>({});

  const previousOrderCount = useRef(0);
  
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const refresh = useCallback(() => {
    void getServerOrders()
      .then((serverOrders) => setOrders(serverOrders))
      .catch(() => setOrders([]));
    void getServerCustomers()
      .then((remoteCustomers) => setCustomers(combineCustomers(remoteCustomers)))
      .catch(() => setCustomers(combineCustomers([])));

    if (session) {
      void getServerMenuItems().then((items) => setMenuItems(items)).catch(() => {});
      void getServerOutlets().then((list) => setOutlets(list)).catch(() => {});
      void getServerOffers().then((list) => setOffers(list)).catch(() => {});
      void getServerWalletTransactions().then((txs) => setTransactions(txs)).catch(() => {});
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const unsubscribeOrders = subscribeServerOrders(
      (serverOrders) => {
        if (
          previousOrderCount.current > 0 &&
          serverOrders.length > previousOrderCount.current
        ) {
          if (Notification.permission === 'granted') {
            new Notification('🍕 New Order Received', {
              body: `Total Orders: ${serverOrders.length}`,
            });
          }
          navigator.vibrate?.([300, 200, 300]);
        }
        previousOrderCount.current = serverOrders.length;
        setOrders(serverOrders);
      },
      () => refresh(),
    );
    const unsubscribeCustomers = subscribeServerCustomers(
      (remoteCustomers) => setCustomers(combineCustomers(remoteCustomers)),
      () => refresh(),
    );
    const unsubscribeTransactions = subscribeServerWalletTransactions(
      (txs) => setTransactions(txs),
      () => refresh(),
    );

    refresh();
    const timer = window.setInterval(refresh, session.role === 'staff' ? 3000 : 5000);
    return () => {
      unsubscribeOrders?.();
      unsubscribeCustomers?.();
      unsubscribeTransactions?.();
      window.clearInterval(timer);
    };
  }, [refresh, session]);

  const parseOrderDate = (order: Order): Date => {
    if (order.receivedAt) {
      const d = new Date(order.receivedAt);
      if (!isNaN(d.getTime())) return d;
    }
    if (order.date) {
      let d = new Date(order.date);
      if (!isNaN(d.getTime())) return d;
      
      const parts = order.date.split(/[\s,]+/);
      if (parts.length >= 2) {
        const dateParts = parts[0].split('/');
        const timeParts = parts[1].split(':');
        if (dateParts.length === 3) {
          const day = parseInt(dateParts[0], 10);
          const month = parseInt(dateParts[1], 10) - 1;
          const year = parseInt(dateParts[2], 10);
          
          let hour = 0, min = 0, sec = 0;
          if (timeParts.length >= 3) {
            hour = parseInt(timeParts[0], 10);
            min = parseInt(timeParts[1], 10);
            sec = parseInt(timeParts[2], 10);
          }
          
          d = new Date(year, month, day, hour, min, sec);
          if (!isNaN(d.getTime())) return d;
        }
      }
    }
    return new Date();
  };

  const visibleOrders = useMemo(() => {
    let filtered = orders;
    if (session) {
      if (session.role !== 'admin') {
        filtered = session.outletId ? filtered.filter((order) => order.outletId === session.outletId) : filtered;
      }
    }
    return [...filtered].sort((a, b) => {
      try {
        return parseOrderDate(b).getTime() - parseOrderDate(a).getTime();
      } catch {
        return 0;
      }
    });
  }, [orders, session]);

  const pendingOrders = visibleOrders.filter((order) => !['done', 'cancelled'].includes(order.status ?? 'new'));

  useEffect(() => {
    if ('setAppBadge' in navigator) {
      const count = pendingOrders.length;
      if (count > 0) {
        navigator.setAppBadge(count).catch((err) => console.error('Error setting app badge:', err));
      } else {
        navigator.clearAppBadge().catch((err) => console.error('Error clearing app badge:', err));
      }
    }
    return () => {
      if ('clearAppBadge' in navigator) {
        navigator.clearAppBadge().catch((err) => console.error('Error clearing app badge:', err));
      }
    };
  }, [pendingOrders.length]);

  const today = new Date().toDateString();
  const todayOrders = visibleOrders.filter((order) => {
    try {
      return parseOrderDate(order).toDateString() === today;
    } catch {
      return false;
    }
  });
  
  // Cancelled orders revenue counts as 0
  const todayRevenue = todayOrders.reduce((sum, order) => {
    if (order.status === 'cancelled') return sum;
    const val = Number(order.total);
    return sum + (isNaN(val) ? 0 : val);
  }, 0);

  // Group visible orders by date slab
  const ordersByDate = useMemo(() => {
    const groups: { [dateStr: string]: Order[] } = {};
    visibleOrders.forEach((order) => {
      try {
        const dateStr = parseOrderDate(order).toDateString();
        if (!groups[dateStr]) {
          groups[dateStr] = [];
        }
        groups[dateStr].push(order);
      } catch (err) {
        console.error('Failed to parse date for order slab:', err);
      }
    });
    return groups;
  }, [visibleOrders]);

  // Expand today by default
  useEffect(() => {
    const todayStr = new Date().toDateString();
    setExpandedDates((prev) => ({
      ...prev,
      [todayStr]: prev[todayStr] ?? true,
    }));
  }, [visibleOrders]);

  const login = async () => {
    try {
      setError('');
      const user = await authenticateAdminViaApi(username, password);
      const nextSession: AdminSession = {
        role: user.role,
        username: user.username,
        outletId: user.outletId ?? OUTLET_LOCATIONS[0]?.id ?? null,
        loginTime: new Date().toISOString(),
        lastActivityTime: new Date().toISOString(),
      };
      StorageService.saveAdminSession(nextSession);
      onSessionChange(nextSession);
    } catch (err: any) {
      setError(err.message || 'Invalid login.');
    }
  };

  const setStatus = (order: Order, status: OrderStatus) => {
    void updateServerOrderStatus(order.id, status).then(() => {
      if (status !== 'new') {
        void notifyCustomerStatusChange(order, status);
      }
      refresh();
    });
  };

  const verifyCustomer = async (customer: CustomerProfile) => {
    try {
      const result = await verifyServerCustomer(customer.id);
      if (result) {
        StorageService.markCustomerVerified(customer.id);
        setCustomers((current) => current.map((item) => (item.id === customer.id ? result : item)));
        alert(`Customer ${customer.name} verified successfully! Referral Code: ${result.referralCode ?? ''}`);
      }
      refresh();
    } catch (err: any) {
      alert(err.message || 'Verification failed.');
      refresh();
    }
  };

  // Menu operations
  const toggleItemAvailability = async (item: MenuItem) => {
    const updated = { ...item, available: !item.available };
    await saveMenuItemToServer(updated);
    setMenuItems((current) => current.map((i) => (i.id === item.id ? updated : i)));
  };

  const updateItemPrice = async (item: MenuItem, newPrice: number) => {
    if (isNaN(newPrice) || newPrice < 0) return;
    const updated = { ...item, price: newPrice };
    await saveMenuItemToServer(updated);
    setMenuItems((current) => current.map((i) => (i.id === item.id ? updated : i)));
  };

  const updateSizePrice = async (item: MenuItem, sizeIndex: number, newPrice: number) => {
    if (isNaN(newPrice) || newPrice < 0 || !item.sizes) return;
    const nextSizes = [...item.sizes];
    nextSizes[sizeIndex] = { ...nextSizes[sizeIndex], price: newPrice };
    const updated = { ...item, sizes: nextSizes };
    if (sizeIndex === 0) {
      updated.price = newPrice;
    }
    await saveMenuItemToServer(updated);
    setMenuItems((current) => current.map((i) => (i.id === item.id ? updated : i)));
  };

  // Outlet operations
  const toggleOutletEnabled = async (outlet: OutletConfig) => {
    const updated = { ...outlet, enabled: !outlet.enabled };
    await saveOutletToServer(updated);
    setOutlets((current) => current.map((o) => (o.id === outlet.id ? updated : o)));
  };

  // Offer operations
  const toggleOfferEnabled = async (offer: OfferCard) => {
    const updated = { ...offer, enabled: !offer.enabled };
    await saveOfferToServer(updated);
    setOffers((current) => current.map((o) => (o.id === offer.id ? updated : o)));
  };

  if (!session) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden bg-[#07070b] p-4 text-white animate-slide-up">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top,rgba(220,38,38,0.35),transparent_62%)]" />
        <button onClick={onClose} className="absolute right-4 top-4 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-bold text-slate-200 shadow-2xl backdrop-blur-xl btn-hover-scale">Close</button>
        <div className="relative w-full max-w-sm rounded-[2.25rem] border border-white/10 bg-slate-950/85 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.65)] backdrop-blur-2xl glass-card animate-slide-up">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-white/20 to-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_20px_40px_rgba(220,38,38,0.18)]">
            <img src="/icon-192.png" className="h-16 w-16 rounded-2xl" />
          </div>
          <div className="mt-5 text-center text-[10px] font-black uppercase tracking-[0.35em] text-red-300 text-glow">Harino&apos;s Control</div>
          <h2 className="mt-2 text-center font-display text-4xl font-bold text-white">Admin Panel</h2>
          <p className="mt-2 text-center text-xs font-medium leading-5 text-slate-400">Username and password access only. No phone or email login here.</p>
          <label className="mt-6 block text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Username</label>
          <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Admin_Harinos" className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 font-bold text-white outline-none transition focus:border-red-500/80 focus:bg-white/10 focus:ring-2 focus:ring-red-500/20" />
          <label className="mt-4 block text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Password</label>
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Password" className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 font-bold text-white outline-none transition focus:border-red-500/80 focus:bg-white/10 focus:ring-2 focus:ring-red-500/20" />
          <div className="mt-3 min-h-5 text-xs font-bold text-red-300">{error}</div>
          <button onClick={login} className="mt-2 w-full rounded-2xl bg-gradient-premium py-4 text-[11px] font-black uppercase tracking-widest text-white shadow-[0_18px_35px_rgba(220,38,38,0.3)] btn-hover-scale">Sign In</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-[#08080d] text-white">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top_left,rgba(220,38,38,0.22),transparent_48%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.13),transparent_42%)]" />
      <header className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/85 p-4 shadow-2xl backdrop-blur-2xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/icon-192.png" className="h-10 w-10 rounded-2xl shadow-lg" />
            <div className="min-w-0">
              <div className="truncate font-display text-xl font-bold">Harino&apos;s Admin</div>
              <div className="truncate text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{session.username}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">{session.role}</span>
            {session.role === 'admin' && (
              <button
                onClick={() => {
                  setSelectedUserForPassword(session.username);
                  setIsChangePasswordOpen(true);
                }}
                className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white transition hover:bg-white/20 active:scale-95"
              >
                Passwords
              </button>
            )}
            <button onClick={() => { StorageService.clearAdminSession(); onSessionChange(null); }} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white transition hover:bg-white/20 active:scale-95">Sign Out</button>
            <button onClick={onClose} className="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold text-slate-200 transition active:scale-95">Close</button>
          </div>
        </div>
      </header>

      {/* Tabs navigation */}
      <div className="mx-auto max-w-6xl px-4 mt-6 flex gap-2 overflow-x-auto hide-scrollbar">
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium btn-hover-scale ${
            activeTab === 'orders' 
              ? 'bg-gradient-premium border-red-500/30 text-white shadow-lg shadow-red-600/15' 
              : 'bg-white/[0.03] border-white/5 text-slate-400 hover:text-white hover:bg-white/[0.08]'
          }`}
        >
          Orders
        </button>
        {(session.role === 'admin' || session.role === 'manager') && (
          <button
            onClick={() => setActiveTab('wallets')}
            className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium btn-hover-scale ${
              activeTab === 'wallets' 
                ? 'bg-gradient-premium border-red-500/30 text-white shadow-lg shadow-red-600/15' 
                : 'bg-white/[0.03] border-white/5 text-slate-400 hover:text-white hover:bg-white/[0.08]'
            }`}
          >
            Wallets & Customers
          </button>
        )}
        {(session.role === 'admin' || session.role === 'manager') && (
          <>
            <button
              onClick={() => setActiveTab('menu')}
              className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium btn-hover-scale ${
                activeTab === 'menu' 
                  ? 'bg-gradient-premium border-red-500/30 text-white shadow-lg shadow-red-600/15' 
                  : 'bg-white/[0.03] border-white/5 text-slate-400 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              Menu items
            </button>
            <button
              onClick={() => setActiveTab('outlets')}
              className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium btn-hover-scale ${
                activeTab === 'outlets' 
                  ? 'bg-gradient-premium border-red-500/30 text-white shadow-lg shadow-red-600/15' 
                  : 'bg-white/[0.03] border-white/5 text-slate-400 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              Outlets
            </button>
            <button
              onClick={() => setActiveTab('offers')}
              className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium btn-hover-scale ${
                activeTab === 'offers' 
                  ? 'bg-gradient-premium border-red-500/30 text-white shadow-lg shadow-red-600/15' 
                  : 'bg-white/[0.03] border-white/5 text-slate-400 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              Offers
            </button>
          </>
        )}
      </div>

      {activeTab === 'orders' && (
        <>
          {/* Role-based revenue box layout: staff sees no revenue box */}
          <section className={`relative mx-auto grid max-w-6xl gap-3 p-4 ${session.role === 'staff' ? 'grid-cols-2' : 'grid-cols-3'}`}>
            <div className="rounded-2xl p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] glass-card">
              <div className="text-[9px] font-black uppercase tracking-[0.22em] text-red-400 text-glow">Pending</div>
              <div className="mt-2 text-3xl font-black text-red-300">{pendingOrders.length}</div>
            </div>
            <div className="rounded-2xl p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] glass-card">
              <div className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-400">Today</div>
              <div className="mt-2 text-3xl font-black text-white">{todayOrders.length}</div>
            </div>
            {session.role !== 'staff' && (
              <div className="rounded-2xl p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] glass-card">
                <div className="text-[9px] font-black uppercase tracking-[0.22em] text-emerald-400">Revenue</div>
                <div className="mt-2 text-2xl font-black text-emerald-300">Rs {Math.round(todayRevenue)}</div>
              </div>
            )}
          </section>

          {!isOrderApiConfigured() && (
            <div className="m-4 rounded-2xl border border-amber-500 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
              Central Firebase order sync is not configured. Add the VITE_FIREBASE_* variables in Vercel so all devices read and write the same Firestore orders collection.
            </div>
          )}

          {/* Date Slabs grouped collapsible orders */}
          <section className="relative mx-auto max-w-6xl p-4">
            <h3 className="mb-3 font-display text-2xl font-bold">Orders</h3>
            <div className="grid gap-4">
              {Object.keys(ordersByDate).map((dateStr) => {
                const dateOrders = ordersByDate[dateStr];
                const isExpanded = expandedDates[dateStr] ?? false;

                return (
                  <div key={dateStr} className="rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden">
                    <button
                      onClick={() => setExpandedDates((prev) => ({ ...prev, [dateStr]: !isExpanded }))}
                      className="w-full flex justify-between items-center px-5 py-4 bg-white/[0.04] hover:bg-white/[0.07] transition-all text-left outline-none"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-display font-bold text-lg">{dateStr === today ? 'Today' : dateStr}</span>
                        <span className="text-xs bg-red-600/30 border border-red-500/20 text-red-200 px-2 py-0.5 rounded-full font-black">
                          {dateOrders.length} {dateOrders.length === 1 ? 'Order' : 'Orders'}
                        </span>
                      </div>
                      <span className="text-slate-400 font-bold">{isExpanded ? '▼' : '▲'}</span>
                    </button>

                    {isExpanded && (
                      <div className="p-4 grid gap-3">
                        {dateOrders.map((order) => (
                           <div key={order.id} className="rounded-2xl p-4 shadow-[0_22px_60px_rgba(0,0,0,0.28)] glass-card glass-card-hover animate-slide-up">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <b>#{getDisplayOrderId(order.id)}</b>
                                  <span className={`rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-widest ${statusClass(order.status)}`}>{statusLabel(order.status)}</span>
                                </div>
                                <div className="mt-1 text-xs text-slate-500">{order.outletName} - {order.orderType}</div>
                                <div className="mt-1 text-xs text-slate-400">
                                  📅 {new Date(order.receivedAt ?? order.date).toLocaleDateString()} {new Date(order.receivedAt ?? order.date).toLocaleTimeString()}
                                </div>
                                
                                {/* Google Maps Delivery Navigation Redirect Link */}
                                {order.orderType === 'delivery' && order.customerLocation && (
                                  <div className="mt-2">
                                    <a
                                      href={`https://www.google.com/maps/search/?api=1&query=${order.customerLocation.latitude},${order.customerLocation.longitude}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-md shadow-blue-900/10"
                                    >
                                      🗺️ Navigation Map
                                    </a>
                                  </div>
                                )}
                              </div>
                              <div className="text-2xl font-black text-red-400 text-glow">Rs {Math.round(order.total)}</div>
                            </div>
                            
                            {/* Wallet and Rewards Redeemed Labels */}
                            {(order.walletAmountRedeemed || order.rewardPointsRedeemed) ? (
                              <div className="mt-2 text-xs font-semibold text-green-400 space-x-3">
                                {order.walletAmountRedeemed ? <span>👛 Wallet: -Rs {order.walletAmountRedeemed}</span> : null}
                                {order.rewardPointsRedeemed ? <span>⭐ Points: -Rs {order.rewardPointsRedeemed}</span> : null}
                              </div>
                            ) : null}

                            <div className="mt-3 text-sm text-slate-300">{order.customerName ?? 'Customer'} - {order.customerPhone ?? 'No phone'}</div>
                            <div className="mt-3 space-y-1 text-sm text-slate-300">
                              {order.items.map((item) => <div key={`${item.id}-${item.selectedSize}`}>{item.quantity}x {item.name}{item.selectedSize ? ` [${item.selectedSize}]` : ''}</div>)}
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <button onClick={() => setStatus(order, 'preparing')} className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold btn-hover-scale hover:bg-amber-500 transition-premium">Preparing</button>
                              <button onClick={() => setStatus(order, order.orderType === 'delivery' ? 'out_for_delivery' : 'ready')} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold btn-hover-scale hover:bg-blue-500 transition-premium">Ready/Out</button>
                              <button onClick={() => setStatus(order, 'done')} className="rounded-xl bg-green-700 px-3 py-2 text-xs font-bold btn-hover-scale hover:bg-green-600 transition-premium">Done</button>
                              <button onClick={() => setStatus(order, 'cancelled')} className="rounded-xl bg-red-700 px-3 py-2 text-xs font-bold btn-hover-scale hover:bg-red-650 transition-premium">Cancel</button>
                              <button onClick={() => printOrder(order)} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold btn-hover-scale hover:bg-white/10 transition-premium">Print (54mm Bill)</button>
                              {order.customerPhone && <a href={`https://wa.me/${normalizePhoneForWhatsApp(order.customerPhone)}`} target="_blank" rel="noreferrer" className="rounded-xl bg-green-700 px-3 py-2 text-xs font-bold btn-hover-scale hover:bg-green-600 transition-premium">WhatsApp Customer</a>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {!visibleOrders.length && <div className="text-sm text-slate-500">No central orders found yet.</div>}
            </div>
          </section>
        </>
      )}

      {/* Wallet & Customers Tab (Admin & Manager) */}
      {activeTab === 'wallets' && (session.role === 'admin' || session.role === 'manager') && (
        <section className="relative mx-auto max-w-6xl p-4 animate-slide-up">
          <h3 className="mb-4 font-display text-2xl font-bold font-black">Wallets & Customers Control</h3>
          
          {/* Search Bar */}
          <div className="mb-6">
            <label className="block text-[10px] font-black uppercase tracking-[0.25em] text-slate-500 mb-2">Search Customers</label>
            <input
              type="text"
              placeholder="Enter customer name or phone number..."
              value={walletSearchQuery}
              onChange={(e) => setWalletSearchQuery(e.target.value)}
              className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-white outline-none focus:border-red-500 font-bold transition focus:bg-white/10"
            />
          </div>

          {/* Customer Verification Section */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 mb-6">
            <h4 className="font-display font-bold text-lg mb-4 text-red-300">Customer Verification Management</h4>
            <div className="grid gap-3 md:grid-cols-2">
              {customers
                .filter((cust) => {
                  const query = walletSearchQuery.toLowerCase().trim();
                  if (!query) return true;
                  return (
                    cust.name.toLowerCase().includes(query) ||
                    cust.phone.includes(query)
                  );
                })
                .map((customer) => {
                  const verified = StorageService.getVerifiedCustomers()[customer.id] || customer.verified;
                  return (
                    <div key={customer.id} className="rounded-2xl border border-white/5 bg-white/[0.05] p-4 flex flex-col justify-between shadow-2xl">
                      <div>
                        <div className="font-bold flex items-center gap-2">
                          <span className="text-white text-base">{customer.name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-widest ${verified ? 'bg-green-500/20 text-green-300 border border-green-500/20' : 'bg-amber-500/20 text-amber-300 border border-amber-500/20'}`}>
                            {verified ? 'Verified' : 'Pending'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">Ph: {customer.phone} {customer.email ? `- ${customer.email}` : ''}</div>
                        {customer.referralCode && (
                          <div className="text-[10px] text-red-400 mt-1 font-bold">Referral Code: {customer.referralCode}</div>
                        )}
                      </div>
                      {!verified && (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={async () => {
                              const otp = Math.floor(100000 + Math.random() * 900000).toString();
                              try {
                                const updatedCustomer = {
                                  ...customer,
                                  otp: otp
                                };
                                await saveCustomerToServer(updatedCustomer);
                                alert(`Generated OTP for ${customer.name}: ${otp}\nPlease verify this code with the customer.`);
                                const messageText = `Your Harino's verification OTP is ${otp}. Please enter this OTP in your Profile section to verify your account.`;
                                const whatsappUrl = `https://wa.me/${normalizePhoneForWhatsApp(customer.phone)}?text=${encodeURIComponent(messageText)}`;
                                window.open(whatsappUrl, '_blank');
                              } catch (err) {
                                console.error('Failed to save OTP to customer profile:', err);
                                alert('Failed to generate and save OTP. Please try again.');
                              }
                            }}
                            className="rounded-xl bg-green-700 hover:bg-green-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white transition-all active:scale-95"
                          >
                            Send OTP
                          </button>
                          <button
                            onClick={() => verifyCustomer(customer)}
                            className="rounded-xl bg-red-650 hover:bg-red-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white transition-all active:scale-95"
                          >
                            Verify Manually
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              {customers.filter((cust) => {
                const query = walletSearchQuery.toLowerCase().trim();
                return !query || cust.name.toLowerCase().includes(query) || cust.phone.includes(query);
              }).length === 0 && (
                <div className="text-sm text-slate-500">No matching customers found.</div>
              )}
            </div>
          </div>

          {/* Pending Top-ups Approval Section */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 mb-6">
            <h4 className="font-display font-bold text-lg mb-4 text-amber-300">Pending Wallet Top-up Approvals</h4>
            <div className="grid gap-3">
              {transactions.filter((tx) => tx.status === 'pending').map((tx) => {
                const isMatch = !walletSearchQuery.trim() || 
                  tx.customerName.toLowerCase().includes(walletSearchQuery.toLowerCase().trim()) ||
                  tx.customerPhone.includes(walletSearchQuery.trim());
                if (!isMatch) return null;

                return (
                  <div key={tx.id} className="rounded-2xl bg-white/[0.05] p-4 flex flex-wrap items-center justify-between gap-4 border border-white/5">
                    <div>
                      <div className="font-bold text-base text-white">{tx.customerName}</div>
                      <div className="text-xs text-slate-400">Ph: {tx.customerPhone}</div>
                      <div className="text-[10px] text-slate-500 mt-1">Requested: {new Date(tx.createdAt).toLocaleString()}</div>
                      <div className="mt-1.5 text-xs font-black text-amber-300">Amount: Rs {tx.amount}</div>
                    </div>
                    <div>
                      <button
                        onClick={async () => {
                          try {
                            const freshCustomers = await getServerCustomers();
                            const customer = freshCustomers.find((c) => c.id === tx.customerId);
                            if (!customer) {
                              alert('Customer profile not found on server.');
                              return;
                            }
                            const updatedTx: WalletTransaction = {
                              ...tx,
                              status: 'completed'
                            };
                            const updatedCustomer = {
                              ...customer,
                              walletBalance: (customer.walletBalance ?? 0) + tx.amount
                            };
                            await saveWalletTransactionToServer(updatedTx);
                            await saveCustomerToServer(updatedCustomer);
                            alert(`Approved top-up of Rs ${tx.amount} for ${tx.customerName}`);
                            refresh();
                          } catch (err: any) {
                            alert(err.message || 'Failed to approve transaction.');
                          }
                        }}
                        className="rounded-xl bg-green-700 hover:bg-green-600 text-white font-bold px-4 py-2 text-xs uppercase tracking-wider transition-all"
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                );
              })}
              {transactions.filter((tx) => tx.status === 'pending').filter((tx) => !walletSearchQuery.trim() || tx.customerName.toLowerCase().includes(walletSearchQuery.toLowerCase().trim()) || tx.customerPhone.includes(walletSearchQuery.trim())).length === 0 && (
                <div className="text-sm text-slate-500">No matching pending wallet top-up requests.</div>
              )}
            </div>
          </div>

          <div className="grid gap-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5">
              <h4 className="font-display font-bold text-lg mb-4">Adjust Balance Ledger</h4>
              <div className="grid gap-4 md:grid-cols-2">
                {customers
                  .filter((cust) => {
                    const query = walletSearchQuery.toLowerCase().trim();
                    if (!query) return true;
                    return (
                      cust.name.toLowerCase().includes(query) ||
                      cust.phone.includes(query)
                    );
                  })
                  .map((cust) => {
                    return (
                      <div key={cust.id} className="rounded-2xl bg-white/[0.05] p-4 flex flex-col justify-between border border-white/5">
                        <div>
                          <div className="font-bold text-lg text-white">{cust.name}</div>
                          <div className="text-xs text-slate-400">Ph: {cust.phone}</div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                            <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-2.5 text-center text-orange-200 font-bold">
                              👛 Rs {(cust.walletBalance ?? 0).toFixed(0)}
                            </div>
                            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5 text-center text-amber-200 font-bold">
                              ⭐ {cust.rewardPoints ?? 0} pts
                            </div>
                          </div>
                        </div>
                        
                        {/* Ledger adjustments form (Admin only) */}
                        {session.role === 'admin' && (
                          <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-550 mb-1">Adjust Balances</div>
                            <div className="flex gap-2">
                              <input
                                type="number"
                                placeholder="Amount (+/-)"
                                id={`adj-wallet-${cust.id}`}
                                className="w-1/2 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                              />
                              <button
                                onClick={async () => {
                                  const val = parseFloat((document.getElementById(`adj-wallet-${cust.id}`) as HTMLInputElement)?.value);
                                  if (isNaN(val) || val === 0) return;
                                  
                                  const updated = {
                                    ...cust,
                                    walletBalance: Math.max(0, (cust.walletBalance ?? 0) + val)
                                  };
                                  
                                  const tx: WalletTransaction = {
                                    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                                    customerId: cust.id,
                                    customerName: cust.name,
                                    customerPhone: cust.phone,
                                    amount: val,
                                    type: 'admin_adjustment',
                                    status: 'completed',
                                    createdAt: new Date().toISOString()
                                  };
                                  
                                  try {
                                    await saveWalletTransactionToServer(tx);
                                    await saveCustomerToServer(updated);
                                    (document.getElementById(`adj-wallet-${cust.id}`) as HTMLInputElement).value = '';
                                    refresh();
                                    alert(`Wallet adjusted by Rs ${val}`);
                                  } catch (err) {
                                    alert('Failed to adjust wallet.');
                                  }
                                }}
                                className="w-1/2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-[10px] uppercase tracking-wider transition-all"
                              >
                                Update Wallet
                              </button>
                            </div>
                            
                            <div className="flex gap-2">
                              <input
                                type="number"
                                placeholder="Points (+/-)"
                                id={`adj-points-${cust.id}`}
                                className="w-1/2 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                              />
                              <button
                                onClick={async () => {
                                  const val = parseInt((document.getElementById(`adj-points-${cust.id}`) as HTMLInputElement)?.value);
                                  if (isNaN(val) || val === 0) return;
                                  
                                  const updated = {
                                    ...cust,
                                    rewardPoints: Math.max(0, (cust.rewardPoints ?? 0) + val)
                                  };
                                  
                                  const tx: WalletTransaction = {
                                    id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                                    customerId: cust.id,
                                    customerName: cust.name,
                                    customerPhone: cust.phone,
                                    amount: val * 0.1, // 1 point = 0.1 Rs
                                    type: 'admin_adjustment',
                                    status: 'completed',
                                    createdAt: new Date().toISOString()
                                  };
                                  
                                  try {
                                    await saveWalletTransactionToServer(tx);
                                    await saveCustomerToServer(updated);
                                    (document.getElementById(`adj-points-${cust.id}`) as HTMLInputElement).value = '';
                                    refresh();
                                    alert(`Points adjusted by ${val}`);
                                  } catch (err) {
                                    alert('Failed to adjust points.');
                                  }
                                }}
                                className="w-1/2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl text-[10px] uppercase tracking-wider transition-all"
                              >
                                Update Points
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'menu' && (
        <section className="relative mx-auto max-w-6xl p-4 animate-slide-up">
          <h3 className="mb-4 font-display text-2xl font-bold">Dynamic Menu Management</h3>
          
          {/* Add Menu Item Panel */}
          <div className="mb-6 rounded-3xl border border-white/10 bg-white/[0.02] p-5">
            <button
              onClick={() => setIsAddingItem(!isAddingItem)}
              className="w-full text-left font-display font-bold text-lg flex justify-between items-center outline-none"
            >
              <span>➕ Add New Menu Item</span>
              <span className="text-slate-400">{isAddingItem ? 'Close' : 'Expand'}</span>
            </button>
            
            {isAddingItem && (
              <div className="mt-5 space-y-4 max-w-xl">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Item ID (must start with p1_ for pizza variants)</label>
                    <input value={newItemId} onChange={e => setNewItemId(e.target.value)} placeholder="p1_onion" className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-red-500" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Item Name</label>
                    <input value={newItemName} onChange={e => setNewItemName(e.target.value)} placeholder="Double Cheese Margherita" className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-red-500" />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Description</label>
                  <textarea value={newItemDesc} onChange={e => setNewItemDesc(e.target.value)} placeholder="Double loaded cheese with herbs" className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-red-500 h-20" />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Category</label>
                    <select value={newItemCategory} onChange={e => setNewItemCategory(e.target.value as any)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-red-500">
                      {Object.values(Category).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Base Price (Rs)</label>
                    <input type="number" value={newItemPrice} onChange={e => setNewItemPrice(e.target.value)} placeholder="199" className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-red-500" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Image URL</label>
                    <input value={newItemImage} onChange={e => setNewItemImage(e.target.value)} placeholder="/icon-192.png" className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-red-500" />
                  </div>
                </div>

                <div className="flex gap-6 pt-2">
                  <label className="flex items-center gap-2 font-bold cursor-pointer">
                    <input type="checkbox" checked={newItemSpicy} onChange={e => setNewItemSpicy(e.target.checked)} className="w-4 h-4 rounded text-red-600 focus:ring-0 bg-transparent border-white/20" />
                    <span>Spicy</span>
                  </label>
                  <label className="flex items-center gap-2 font-bold cursor-pointer">
                    <input type="checkbox" checked={newItemPopular} onChange={e => setNewItemPopular(e.target.checked)} className="w-4 h-4 rounded text-red-600 focus:ring-0 bg-transparent border-white/20" />
                    <span>Popular / Bestseller</span>
                  </label>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    if (!newItemId.trim() || !newItemName.trim() || !newItemPrice.trim()) {
                      alert('Please fill out Name, ID and Base Price.');
                      return;
                    }
                    
                    const priceNum = parseFloat(newItemPrice);
                    const sizes = newItemCategory === Category.PIZZA ? [
                      { label: 'Regular', price: priceNum },
                      { label: 'Medium', price: priceNum + 100 },
                      { label: 'Large', price: priceNum + 200 }
                    ] : undefined;

                    const item: MenuItem = {
                      id: newItemId,
                      name: newItemName,
                      description: newItemDesc,
                      price: priceNum,
                      category: newItemCategory,
                      image: newItemImage || '/icon-192.png',
                      vegetarian: true,
                      spicy: newItemSpicy,
                      popular: newItemPopular,
                      available: true,
                      sizes
                    };

                    try {
                      await saveMenuItemToServer(item);
                      alert('Menu item added successfully.');
                      setNewItemId('');
                      setNewItemName('');
                      setNewItemDesc('');
                      setNewItemPrice('');
                      setNewItemImage('');
                      setIsAddingItem(false);
                      refresh();
                    } catch (err) {
                      alert('Failed to save menu item.');
                    }
                  }}
                  className="bg-red-600 text-white rounded-2xl px-6 py-3.5 text-xs font-black uppercase tracking-widest hover:bg-red-500 transition-all btn-hover-scale"
                >
                  Save Item
                </button>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Out of Stock menu items styled with gray-out opacity */}
            {menuItems.map((item) => (
              <div key={item.id} className={`rounded-2xl p-4 flex gap-4 shadow-2xl glass-card glass-card-hover ${!item.available ? 'opacity-50 grayscale-[30%] border border-red-500/20' : ''}`}>
                <img src={item.image} className="w-20 h-20 rounded-xl object-cover" onError={(e) => { e.currentTarget.src = '/icon-192.png'; }} />
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <div className="font-bold flex items-center gap-2">
                      {item.name}
                      {item.vegetarian && <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" title="Vegetarian"></span>}
                    </div>
                    <div className="text-xs text-slate-400 capitalize">{item.category}</div>
                    
                    {item.sizes && item.sizes.length > 0 ? (
                      <div className="mt-2 space-y-1.5">
                        {item.sizes.map((sz, idx) => (
                          <div key={sz.label} className="flex items-center justify-between gap-2 text-xs text-slate-300">
                            <span>{sz.label}:</span>
                            <div className="flex items-center gap-1">
                              <span className="text-slate-500">Rs</span>
                              <input
                                type="number"
                                defaultValue={sz.price}
                                onBlur={(e) => updateSizePrice(item, idx, parseFloat(e.target.value))}
                                className="w-16 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-right text-white font-bold outline-none focus:border-red-500/80 transition-all focus:ring-1 focus:ring-red-500/30"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                        <span>Price:</span>
                        <div className="flex items-center gap-1">
                          <span className="text-slate-500">Rs</span>
                          <input
                            type="number"
                            defaultValue={item.price}
                            onBlur={(e) => updateItemPrice(item, parseFloat(e.target.value))}
                            className="w-16 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-right text-white font-bold outline-none focus:border-red-500/80 transition-all focus:ring-1 focus:ring-red-500/30"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex justify-between items-center">
                    <button
                      onClick={() => toggleItemAvailability(item)}
                      className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all btn-hover-scale ${
                        item.available ? 'bg-green-600/20 border border-green-500 text-green-300 hover:bg-green-600/35' : 'bg-red-600/20 border border-red-500 text-red-300 hover:bg-red-600/35'
                      }`}
                    >
                      {item.available ? 'In Stock' : 'Out of Stock'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'outlets' && (
        <section className="relative mx-auto max-w-6xl p-4 animate-slide-up">
          <h3 className="mb-4 font-display text-2xl font-bold">Outlet Management</h3>
          <div className="grid gap-3">
            {outlets.map((outlet) => (
              <div key={outlet.id} className="rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-2xl glass-card glass-card-hover">
                <div>
                  <div className="font-bold text-lg">{outlet.name}</div>
                  <div className="text-sm text-slate-400">📞 {outlet.phone}</div>
                  <div className="text-xs text-slate-500">Coordinates: {outlet.latitude}, {outlet.longitude}</div>
                  <div className="text-xs text-slate-400 mt-1">Radius: {outlet.deliveryRadiusKm} km | Free delivery: {outlet.freeDeliveryRadiusKm} km (min Rs {outlet.freeDeliveryMinimumOrder})</div>
                </div>
                <div>
                  <button
                    onClick={() => toggleOutletEnabled(outlet)}
                    className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest border transition-all btn-hover-scale ${
                      outlet.enabled ? 'bg-green-600 border-green-600 text-white hover:bg-green-500' : 'bg-red-600 border-red-600 text-white hover:bg-red-500'
                    }`}
                  >
                    {outlet.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'offers' && (
        <section className="relative mx-auto max-w-6xl p-4 animate-slide-up">
          <h3 className="mb-4 font-display text-2xl font-bold">Promotional Offers</h3>
          <div className="grid gap-3">
            {offers.map((offer) => (
              <div key={offer.id} className="rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-2xl glass-card glass-card-hover">
                <div className="flex-1">
                  <div className="font-bold text-lg">{offer.offerTitle}</div>
                  <div className="text-sm text-slate-400">{offer.displayText}</div>
                  <div className="text-xs text-red-400 mt-1">Rule: {offer.condition}</div>
                  {offer.additionalItem && <div className="text-xs text-green-400">Bonus: {offer.additionalItem}</div>}
                </div>
                <div>
                  <button
                    onClick={() => toggleOfferEnabled(offer)}
                    className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest border transition-all btn-hover-scale ${
                      offer.enabled ? 'bg-green-600 border-green-600 text-white hover:bg-green-500' : 'bg-red-600 border-red-600 text-white hover:bg-red-500'
                    }`}
                  >
                    {offer.enabled ? 'Active' : 'Inactive'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Change Password Dialog Modal */}
      {isChangePasswordOpen && session && session.role === 'admin' && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-[#07070b]/90 p-4">
          <div className="relative w-full max-w-sm rounded-[2.25rem] border border-white/10 bg-slate-950 p-6 shadow-2xl backdrop-blur-2xl animate-slide-up">
            <h3 className="font-display text-2xl font-bold mb-4 text-center">Change Password</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Select User</label>
                <select
                  value={selectedUserForPassword}
                  onChange={(e) => setSelectedUserForPassword(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-red-500 font-bold"
                >
                  <option value="Admin_Harinos" className="bg-slate-950 text-white">Admin (Admin_Harinos)</option>
                  <option value="Manager_Harinos" className="bg-slate-950 text-white">Manager (Manager_Harinos)</option>
                  <option value="Staff_Harinos" className="bg-slate-950 text-white">Staff (Staff_Harinos)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">New Password</label>
                <input
                  type="password"
                  placeholder="New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-red-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Verify Admin Password</label>
                <input
                  type="password"
                  placeholder="Your Admin Password"
                  value={adminVerifyPassword}
                  onChange={(e) => setAdminVerifyPassword(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-red-500"
                />
              </div>
              {passwordMessage && <div className="text-xs font-bold text-green-400 text-center">{passwordMessage}</div>}
              {passwordError && <div className="text-xs font-bold text-red-400 text-center">{passwordError}</div>}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setIsChangePasswordOpen(false);
                    setNewPassword('');
                    setAdminVerifyPassword('');
                    setPasswordMessage('');
                    setPasswordError('');
                  }}
                  className="flex-1 rounded-xl bg-white/10 py-3 text-xs font-bold transition hover:bg-white/20"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!newPassword.trim()) {
                      setPasswordError('New password cannot be empty.');
                      return;
                    }
                    if (!adminVerifyPassword.trim()) {
                      setPasswordError('Please enter your Admin password to authorize.');
                      return;
                    }
                    try {
                      await changeStaffPassword(selectedUserForPassword, newPassword, session.username, adminVerifyPassword);
                      setPasswordMessage('Password changed successfully.');
                      setPasswordError('');
                      setTimeout(() => {
                        setIsChangePasswordOpen(false);
                        setNewPassword('');
                        setAdminVerifyPassword('');
                        setPasswordMessage('');
                      }, 1500);
                    } catch (err: any) {
                      setPasswordError(err.message || 'Password update failed.');
                    }
                  }}
                  className="flex-1 rounded-xl bg-red-600 py-3 text-xs font-bold text-white transition hover:bg-red-500 shadow-lg font-black"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
