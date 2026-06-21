import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  getServerOutlets,
  getServerOffers,
  changeStaffPassword,
  getServerWalletTransactions,
  subscribeServerWalletTransactions,
  getServerSettings,
  saveSettingsToServer,
  getBackupStatus,
  triggerDatabaseBackup,
  triggerDatabaseRestore,

} from '../services/orderApi';
import { StorageService } from '../services/storage';
import { notifyCustomerStatusChange } from '../services/notificationService';
import { useFCMNotifications } from '../hooks/useFCMNotifications';
import { getDisplayOrderId } from '../App';
import { AdminSession, CustomerProfile, Order, OrderStatus, MenuItem, OutletConfig, OfferCard, WalletTransaction } from '../types';
import { AdminOrders } from './AdminOrders';
import { AdminWallets } from './AdminWallets';
import { AdminMenu } from './AdminMenu';
import { AdminDashboard } from './AdminDashboard';
import { AdminUsage } from './AdminUsage';
import { AdminBackup } from './AdminBackup';
import { AdminNotifications } from './AdminNotifications';

interface AdminPanelProps {
  session: AdminSession | null;
  onSessionChange: (session: AdminSession | null) => void;
  onClose: () => void;
}

const statusLabel = (status?: OrderStatus): string => (status ?? 'new').replace(/_/g, ' ').toUpperCase();

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
<div>Payment: ${order.paymentMethod ? order.paymentMethod.toUpperCase() : 'UPI'}</div>
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
  const [activeTab, setActiveTab] = useState<'orders' | 'wallets' | 'menu' | 'outlets' | 'offers' | 'dashboard' | 'settings' | 'usage' | 'backup' | 'notifications'>('orders');
  const [instagramUrlInput, setInstagramUrlInput] = useState('');


  // Dynamic config items
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [outlets, setOutlets] = useState<OutletConfig[]>([]);
  const [offers, setOffers] = useState<OfferCard[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);

  // Change Password Form State
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const previousOrderCount = useRef(0);

  const refresh = useCallback((forceAll = false) => {
    if (!session) return;

    if (forceAll || activeTab === 'orders' || activeTab === 'dashboard') {
      void getServerOrders().then((serverOrders) => setOrders(serverOrders)).catch(() => setOrders([]));
    }
    if (forceAll || activeTab === 'wallets' || activeTab === 'dashboard') {
      void getServerCustomers().then((remoteCustomers) => setCustomers(combineCustomers(remoteCustomers))).catch(() => setCustomers([]));
    }

    if (session.role !== 'staff') {
      if (forceAll || activeTab === 'wallets') {
        void getServerWalletTransactions().then((txs) => setTransactions(txs)).catch(() => {});
      }
      if (forceAll || activeTab === 'menu') {
        void getServerMenuItems().then((items) => setMenuItems(items)).catch(() => {});
      }
      if (forceAll || activeTab === 'outlets') {
        void getServerOutlets().then((list) => setOutlets(list)).catch(() => {});
      }
      if (forceAll || activeTab === 'offers') {
        void getServerOffers().then((list) => setOffers(list)).catch(() => {});
      }
      if (forceAll || activeTab === 'settings') {
        void getServerSettings().then((settings) => setInstagramUrlInput(settings.instagramUrl || '')).catch(() => {});
      }
    }
  }, [session, activeTab]);

  useEffect(() => {
    if (!session) return;
    const unsubscribeOrders = subscribeServerOrders(
      (serverOrders) => {
        if (previousOrderCount.current > 0 && serverOrders.length > previousOrderCount.current) {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('🍕 New Order Received', { body: `Total Orders: ${serverOrders.length}` });
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
    const timer = window.setInterval(refresh, session.role === 'staff' ? 6000 : 8000);
    return () => {
      unsubscribeOrders?.();
      unsubscribeCustomers?.();
      unsubscribeTransactions?.();
      window.clearInterval(timer);
    };
  }, [refresh, session]);

  const login = async () => {
    try {
      setError('');
      const user = await authenticateAdminViaApi(username, password);
      const nextSession: AdminSession = {
        role: user.role,
        username: user.username,
        outletId: user.outletId ?? OUTLET_LOCATIONS[0]?.id ?? null,
        token: user.token,
        loginTime: new Date().toISOString(),
        lastActivityTime: new Date().toISOString(),
      };
      StorageService.saveAdminSession(nextSession);
      onSessionChange(nextSession);
    } catch (err: any) {
      setError(err.message || 'Invalid login.');
    }
  };

  const setStatus = (order: Order, status: OrderStatus, reason?: string) => {
    const apiBase = (import.meta.env.VITE_ORDER_API_BASE_URL ?? '/api').trim() || '/api';
    fetch(`${apiBase}/orders/${encodeURIComponent(order.id)}/status`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${session?.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status, reason }),
    })
      .then((res) => {
        if (res.ok) {
          if (status !== 'new') {
            void notifyCustomerStatusChange(order, status);
          }
          refresh();
        } else {
          res.json().then((d) => alert(d.message || 'Failed to update status.'));
        }
      })
      .catch(() => alert('Network error updating status.'));
  };

  const verifyCustomer = async (customer: CustomerProfile) => {
    if (!confirm(`Are you sure you want to verify customer "${customer.name}" manually?`)) {
      return;
    }
    try {
      const result = await verifyServerCustomer(customer.id);
      if (result) {
        StorageService.markCustomerVerified(customer.id);
        setCustomers((current) => current.map((item) => (item.id === customer.id ? result : item)));
        alert(`Customer ${customer.name} verified successfully!`);
      }
      refresh();
    } catch (err: any) {
      alert(err.message || 'Verification failed.');
      refresh();
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      const apiBase = (import.meta.env.VITE_ORDER_API_BASE_URL ?? '/api').trim() || '/api';
      const response = await fetch(`${apiBase}/orders/${encodeURIComponent(orderId)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session?.token}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        alert('Order deleted successfully (soft deleted).');
        refresh();
      } else {
        const err = await response.json().catch(() => ({}));
        alert(err.message || 'Failed to delete order.');
      }
    } catch {
      alert('Network error deleting order.');
    }
  };

  const handleUpdatePassword = async () => {
    if (!newPassword.trim()) {
      setPasswordError('New password cannot be empty.');
      return;
    }
    try {
      setPasswordMessage('');
      setPasswordError('');
      await changeStaffPassword(session?.username ?? '', newPassword);
      setPasswordMessage('Password updated successfully.');
      setNewPassword('');
      setTimeout(() => setIsChangePasswordOpen(false), 1500);
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to change password.');
    }
  };

  if (!session) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden bg-[#07070b] p-4 text-white animate-slide-up">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top,rgba(220,38,38,0.35),transparent_62%)]" />
        <button onClick={onClose} className="absolute right-4 top-4 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-bold text-slate-200 shadow-2xl backdrop-blur-xl transition hover:bg-white/20">Close</button>
        <div className="relative w-full max-w-sm rounded-[2.25rem] border border-white/10 bg-slate-950/85 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.65)] backdrop-blur-2xl animate-slide-up">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[1.75rem] bg-gradient-to-br from-white/20 to-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_20px_40px_rgba(220,38,38,0.18)]">
            <img src="/icon-192.png" className="h-16 w-16 rounded-2xl" />
          </div>
          <div className="mt-5 text-center text-[10px] font-black uppercase tracking-[0.35em] text-red-300 text-glow">Harino&apos;s Control</div>
          <h2 className="mt-2 text-center font-display text-4xl font-bold text-white">Admin Panel</h2>
          <p className="mt-2 text-center text-xs font-medium leading-5 text-slate-400">Username and password access only.</p>
          <label className="mt-6 block text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Username</label>
          <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Admin_Harinos" className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 font-bold text-white outline-none focus:border-red-500" />
          <label className="mt-4 block text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Password</label>
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Password" className="mt-2 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 font-bold text-white outline-none focus:border-red-500" />
          <div className="mt-3 min-h-5 text-xs font-bold text-red-300">{error}</div>
          <button onClick={login} className="mt-2 w-full rounded-2xl bg-gradient-premium py-4 text-[11px] font-black uppercase tracking-widest text-white shadow-[0_18px_35px_rgba(220,38,38,0.3)] hover:scale-[1.02] transition-transform">Sign In</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-[#08080d] text-white animate-fade-in">
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
            <button
              onClick={() => {
                setPasswordMessage('');
                setPasswordError('');
                setIsChangePasswordOpen(true);
              }}
              className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white transition hover:bg-white/20 active:scale-95"
            >
              Password
            </button>
            <button 
              onClick={async () => {
                const apiBase = (import.meta.env.VITE_ORDER_API_BASE_URL ?? '/api').trim() || '/api';
                await fetch(`${apiBase}/auth/logout`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.token}`,
                    'X-Session-Id': session.sessionId || '',
                  }
                }).catch(() => {});
                StorageService.clearAdminSession(); 
                onSessionChange(null); 
              }} 
              className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white transition hover:bg-white/20 active:scale-95"
            >
              Sign Out
            </button>
            <button onClick={onClose} className="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold text-slate-200 transition active:scale-95">Close</button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="mx-auto max-w-6xl px-4 mt-6 flex gap-2 overflow-x-auto hide-scrollbar">
        <button onClick={() => setActiveTab('orders')} className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium ${activeTab === 'orders' ? 'bg-gradient-premium border-red-500/30 text-white' : 'bg-white/[0.03] border-white/5 text-slate-400'}`}>
          Orders
        </button>
        {session.role !== 'staff' && (
          <button onClick={() => setActiveTab('dashboard')} className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium ${activeTab === 'dashboard' ? 'bg-gradient-premium border-red-500/30 text-white' : 'bg-white/[0.03] border-white/5 text-slate-400'}`}>
            Dashboard
          </button>
        )}
        {session.role !== 'staff' && (
          <button onClick={() => setActiveTab('wallets')} className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium ${activeTab === 'wallets' ? 'bg-gradient-premium border-red-500/30 text-white' : 'bg-white/[0.03] border-white/5 text-slate-400'}`}>
            Wallets & Customers
          </button>
        )}
        {session.role !== 'staff' && (
          <>
            <button onClick={() => setActiveTab('menu')} className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium ${activeTab === 'menu' ? 'bg-gradient-premium border-red-500/30 text-white' : 'bg-white/[0.03] border-white/5 text-slate-400'}`}>
              Menu
            </button>
            <button onClick={() => setActiveTab('outlets')} className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium ${activeTab === 'outlets' ? 'bg-gradient-premium border-red-500/30 text-white' : 'bg-white/[0.03] border-white/5 text-slate-400'}`}>
              Outlets
            </button>
            <button onClick={() => setActiveTab('offers')} className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium ${activeTab === 'offers' ? 'bg-gradient-premium border-red-500/30 text-white' : 'bg-white/[0.03] border-white/5 text-slate-400'}`}>
              Offers
            </button>
            <button onClick={() => setActiveTab('settings')} className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium ${activeTab === 'settings' ? 'bg-gradient-premium border-red-500/30 text-white' : 'bg-white/[0.03] border-white/5 text-slate-400'}`}>
              Settings
            </button>
          </>
        )}
        {session.role === 'admin' && (
          <>
            <button onClick={() => setActiveTab('notifications')} className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium ${activeTab === 'notifications' ? 'bg-gradient-premium border-red-500/30 text-white' : 'bg-white/[0.03] border-white/5 text-slate-400'}`}>
              Push Notifications
            </button>
            <button onClick={() => setActiveTab('usage')} className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium ${activeTab === 'usage' ? 'bg-gradient-premium border-red-500/30 text-white' : 'bg-white/[0.03] border-white/5 text-slate-400'}`}>
              Cost Usage
            </button>
            <button onClick={() => setActiveTab('backup')} className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-premium ${activeTab === 'backup' ? 'bg-gradient-premium border-red-500/30 text-white' : 'bg-white/[0.03] border-white/5 text-slate-400'}`}>
              Backup & Restore
            </button>
          </>
        )}

      </div>

      <div className="pb-12">
        {activeTab === 'orders' && (
          <AdminOrders
            session={session}
            orders={orders}
            onUpdateStatus={setStatus}
            onDeleteOrder={handleDeleteOrder}
            onPrint={printOrder}
          />
        )}
        {activeTab === 'wallets' && session.role !== 'staff' && (
          <AdminWallets
            session={session}
            customers={customers}
            transactions={transactions}
            onRefresh={refresh}
            onVerifyCustomer={verifyCustomer}
          />
        )}
        {(activeTab === 'menu' || activeTab === 'outlets' || activeTab === 'offers') && session.role !== 'staff' && (
          <AdminMenu
            session={session}
            menuItems={menuItems}
            outlets={outlets}
            offers={offers}
            onRefresh={refresh}
            activeTab={activeTab}
            orders={orders}
          />
        )}
        {activeTab === 'dashboard' && session.role !== 'staff' && (
          <AdminDashboard
            session={session}
            orders={orders}
            customers={customers}
          />
        )}
        {activeTab === 'notifications' && session.role === 'admin' && (
          <AdminNotifications />
        )}
        {activeTab === 'usage' && session.role === 'admin' && (
          <AdminUsage />
        )}
        {activeTab === 'backup' && session.role === 'admin' && (
          <AdminBackup session={session} />
        )}
        {activeTab === 'settings' && session.role !== 'staff' && (
          <div className="mx-auto max-w-xl px-4 mt-6">
            <div className="rounded-[2.25rem] border border-white/10 bg-slate-950/85 p-6 shadow-2xl backdrop-blur-2xl">
              <h3 className="font-display text-2xl font-bold mb-4">Application Settings</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Instagram Page URL</label>
                  <input
                    type="text"
                    placeholder="https://instagram.com/harinospizza"
                    value={instagramUrlInput}
                    onChange={(e) => setInstagramUrlInput(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 font-bold text-white outline-none focus:border-red-500"
                  />
                  <p className="mt-1 text-[10px] text-slate-500">Provide the Instagram page URL. If empty, the Instagram social icons will be hidden.</p>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await saveSettingsToServer({ instagramUrl: instagramUrlInput.trim() });
                      alert('Settings saved successfully!');
                      refresh();
                    } catch (err: any) {
                      alert(err.message || 'Failed to save settings.');
                    }
                  }}
                  className="w-full rounded-2xl bg-gradient-premium py-4 text-[11px] font-black uppercase tracking-widest text-white shadow-[0_18px_35px_rgba(220,38,38,0.3)] hover:scale-[1.02] transition-transform"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Change Password Modal */}
      {isChangePasswordOpen && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-sm rounded-[2rem] border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-xl font-display font-bold mb-4">Change Password</h3>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">New Password</label>
            <input
              type="password"
              placeholder="Enter new password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-slate-950 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-red-500 mb-2 font-bold"
            />
            {passwordMessage && <div className="text-xs font-bold text-green-400 my-2">{passwordMessage}</div>}
            {passwordError && <div className="text-xs font-bold text-red-400 my-2">{passwordError}</div>}
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => setIsChangePasswordOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdatePassword}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-500 text-white"
              >
                Change
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
