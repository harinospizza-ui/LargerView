import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CartItem,
  Category,
  CategoryFilter,
  CustomerLocation,
  AdminSession,
  CustomerProfile,
  MenuItem,
  OfferCard,
  Order,
  OrderItem,
  OrderType,
  OutletConfig,
  WalletTransaction,
} from './types';
import { MENU_ITEMS, OFFER_CARDS, OUTLET_LOCATIONS } from './constants';
import { StorageService } from './services/storage';
import { setDynamicFirebaseConfig } from './services/firebaseClient';
import { NotificationService } from './services/notification';
import { getServerOrders, saveCustomerToServer, saveFullOrderToServer, subscribeServerOrder, getServerMenuItems, seedMenuItemsToServer, subscribeServerMenuItems, getServerOutlets, seedOutletsToServer, subscribeServerOutlets, getServerOffers, seedOffersToServer, subscribeServerOffers, saveWalletTransactionToServer, getServerCustomers, verifyServerCustomer, getServerSettings, getServerCustomerById } from './services/orderApi';
import { copyTextToClipboard, getNotificationPermission } from './services/browserSupport';
import { notifyStaffNewOrder, requestNotificationPermission } from './services/notificationService';
import {
  buildPricedCart,
  getAutomaticOfferBonusItems,
  getCartItemId,
  getOfferActionTarget,
  getItemBasePrice,
  normalizeStoredCartItem,
} from './offerUtils';
import {
  OutletMatch,
  buildCustomerMapUrl,
  findNearestOutletByRoadDistance,
} from './outletUtils';
import { getDeliveryPricingSummary } from './deliveryPricing';
import Header from './components/Header';
import Hero from './components/Hero';
import OfferCarousel from './components/OfferCarousel';
import MenuSection from './components/MenuSection';
import CartSidebar from './components/CartSidebar';
import PastOrders from './components/PastOrders';
import PaymentModal from './components/PaymentModal';
import InstallPopup from './components/InstallPopup';
import ServiceModeModal from './components/ServiceModeModal';
import CustomerLoginModal from './components/CustomerLoginModal';
import AdminPanel from './components/AdminPanel';
import { WalletModal } from './components/WalletModal';
import { useSwipeDismiss } from './hooks/useSwipeDismiss';

interface InAppNotification {
  id: string;
  title: string;
  message: string;
  type?: 'success' | 'info' | 'warning' | 'error';
}

const APP_HISTORY_NAMESPACE = 'harinos-ui';
const CUSTOMER_CARE_WHATSAPP_URL = 'https://wa.me/917818958571';

const SUNDAY_DHAMAKA_CARD: OfferCard = {
  id: 'offer-sunday-dhamaka',
  enabled: true,
  image: '/images/hari.jpeg',
  offerTitle: 'Sunday Dhamaka',
  displayText: 'Buy any Large Pizza and get a matching Regular Pizza FREE!',
  condition: 'Automatic buy 1 Large Pizza get 1 Regular free. Sunday only.',
  notifyCustomers: true,
};

type AppScreen = 'menu' | 'orders' | 'category' | 'cart' | 'payment' | 'success';

interface ResolvedOrderContext {
  customerLocation: CustomerLocation | null;
  outlet: OutletConfig;
  distanceKm: number | null;
}

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
<div class="center"><b>ORDER: #${order.id}</b><br>${order.orderType.toUpperCase()}<br>${new Date(order.receivedAt ?? order.date).toLocaleString()}</div>
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

const printOrderReceipt = (order: Order) => {
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

export const getDisplayOrderId = (orderId: string): string => {
  if (!orderId) return '';
  const parts = orderId.split('-');
  if (parts.length >= 3) {
    return parts[2];
  }
  return parts[parts.length - 1];
};

export const extendMenuItemsWithGeneratedSeries = (items: MenuItem[]): MenuItem[] => {
  const baseCheesePizzas = items.filter(
    (item) => item.category === Category.PIZZA && item.id.startsWith('p1_'),
  );
  const extended = [...items];

  for (const pizza of baseCheesePizzas) {
    // Makhni version
    const makhniId = `makhni_${pizza.id}`;
    if (!extended.some((item) => item.id === makhniId)) {
      extended.push({
        ...pizza,
        id: makhniId,
        name: `Makhni ${pizza.name}`,
        description: `Delicious rich Makhni sauce variant. ${pizza.description}`,
        price: pizza.price + 20,
        sizes: pizza.sizes?.map((sz) => ({
          label: sz.label,
          price: sz.label === 'Regular' ? sz.price + 20 : sz.label === 'Medium' ? sz.price + 30 : sz.label === 'Large' ? sz.price + 50 : sz.price,
        })),
      });
    }

    // Tandoori version
    const tandooriId = `tandoori_${pizza.id}`;
    if (!extended.some((item) => item.id === tandooriId)) {
      extended.push({
        ...pizza,
        id: tandooriId,
        name: `Tandoori ${pizza.name}`,
        description: `Spicy smoky Tandoori sauce variant. ${pizza.description}`,
        price: pizza.price + 20,
        sizes: pizza.sizes?.map((sz) => ({
          label: sz.label,
          price: sz.label === 'Regular' ? sz.price + 20 : sz.label === 'Medium' ? sz.price + 30 : sz.label === 'Large' ? sz.price + 50 : sz.price,
        })),
      });
    }
  }

  return extended;
};

const App: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('All');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [showOrderSuccess, setShowOrderSuccess] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(StorageService.getCustomerProfile());
  const [adminSession, setAdminSession] = useState<AdminSession | null>(StorageService.getAdminSession());
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>('takeaway');
  const [isServiceModeModalOpen, setIsServiceModeModalOpen] = useState(true);
  const [customerLocation, setCustomerLocation] = useState<CustomerLocation | null>(null);
  const [view, setView] = useState<'menu' | 'orders'>('menu');
  const [pastOrders, setPastOrders] = useState<Order[]>(StorageService.getPastOrders());
  const [latestOrder, setLatestOrder] = useState<Order | null>(null);
  const [isStoreOpen, setIsStoreOpen] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [nearestOutletMatch, setNearestOutletMatch] = useState<OutletMatch | null>(null);
  const [isResolvingOutletMatch, setIsResolvingOutletMatch] = useState(false);

  // Wallet and Discounts State
  const [useWallet, setUseWallet] = useState(false);
  const [usePoints, setUsePoints] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [inputReferralCode, setInputReferralCode] = useState('');
  const [inputOtp, setInputOtp] = useState('');
  const [isWalletPaymentOpen, setIsWalletPaymentOpen] = useState(false);
  const [showShareOptions, setShowShareOptions] = useState(false);
  const [instagramUrl, setInstagramUrl] = useState<string>('');
  const [inAppNotifications, setInAppNotifications] = useState<InAppNotification[]>([]);

  const customerProfileRef = useRef(customerProfile);
  customerProfileRef.current = customerProfile;

  const [menuItems, setMenuItems] = useState<MenuItem[]>(extendMenuItemsWithGeneratedSeries(MENU_ITEMS));
  const [outlets, setOutlets] = useState<OutletConfig[]>(OUTLET_LOCATIONS);
  const [offers, setOffers] = useState<OfferCard[]>(OFFER_CARDS);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Fetch dynamic client Firebase config from serverless backend on startup
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/firebase-config');
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.config && data.config.apiKey) {
            setDynamicFirebaseConfig(data.config);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch Firebase config:', err);
      } finally {
        setConfigLoaded(true);
      }
    };
    fetchConfig();
  }, []);

  // Fetch application settings and static data (menu, outlets, offers) on startup with caching
  useEffect(() => {
    if (!configLoaded) return;

    const loadData = async () => {
      try {
        // Fetch settings once to get instagramUrl and current menuVersion
        const settings = await getServerSettings();
        if (settings.instagramUrl) {
          setInstagramUrl(settings.instagramUrl);
        }

        const serverVersion = settings.menuVersion || '1.0';
        const localVersion = localStorage.getItem('cached_menu_version');

        if (localVersion === serverVersion) {
          const cachedMenu = localStorage.getItem('cached_menu_items');
          const cachedOutlets = localStorage.getItem('cached_outlets');
          const cachedOffers = localStorage.getItem('cached_offers');

          if (cachedMenu && cachedOutlets && cachedOffers) {
            console.log('Loading menu, outlets, and offers from local storage cache.');
            setMenuItems(JSON.parse(cachedMenu));
            setOutlets(JSON.parse(cachedOutlets));
            setOffers(JSON.parse(cachedOffers));
            return;
          }
        }

        console.log('Cache mismatch or empty cache. Loading from server...');
        const items = await getServerMenuItems();
        let finalMenuItems = [];
        if (items.length === 0) {
          console.log('Seeding database menu_items...');
          await seedMenuItemsToServer(MENU_ITEMS);
          finalMenuItems = extendMenuItemsWithGeneratedSeries(MENU_ITEMS);
        } else {
          finalMenuItems = extendMenuItemsWithGeneratedSeries(items);
        }
        setMenuItems(finalMenuItems);

        const outletList = await getServerOutlets();
        let finalOutlets = [];
        if (outletList.length === 0) {
          console.log('Seeding database outlets...');
          await seedOutletsToServer(OUTLET_LOCATIONS);
          finalOutlets = OUTLET_LOCATIONS;
        } else {
          finalOutlets = outletList;
        }
        setOutlets(finalOutlets);

        const offerList = await getServerOffers();
        const hasSundayDhamaka = offerList.some(o => o.id === 'offer-sunday-dhamaka');
        const finalOffers = hasSundayDhamaka ? offerList : [SUNDAY_DHAMAKA_CARD, ...offerList];
        if (offerList.length === 0) {
          console.log('Seeding database offers...');
          await seedOffersToServer(finalOffers);
          setOffers(finalOffers);
        } else {
          setOffers(finalOffers);
        }

        // Cache they locally
        localStorage.setItem('cached_menu_items', JSON.stringify(finalMenuItems));
        localStorage.setItem('cached_outlets', JSON.stringify(finalOutlets));
        localStorage.setItem('cached_offers', JSON.stringify(finalOffers));
        localStorage.setItem('cached_menu_version', serverVersion);
        console.log('Successfully updated local storage cache to version:', serverVersion);
      } catch (err) {
        console.error('Failed to load settings or menu data:', err);
      }
    };

    loadData();
  }, [configLoaded]);

  // Request notification permission on app load
  useEffect(() => {
    void requestNotificationPermission();
  }, []);

  const menuRef = useRef<HTMLDivElement>(null);
  const applyAppScreen = useCallback((screen: AppScreen) => {
    setView(screen === 'orders' ? 'orders' : 'menu');
    setIsCategoryModalOpen(screen === 'category');
    setIsCartOpen(screen === 'cart');
    setIsPaymentOpen(screen === 'payment');
    setShowOrderSuccess(screen === 'success');
  }, []);
  const pushAppScreen = useCallback((screen: AppScreen) => {
    const currentState = window.history.state as { app?: string; screen?: AppScreen } | null;

    if (currentState?.app === APP_HISTORY_NAMESPACE && currentState.screen === screen) {
      return;
    }

    window.history.pushState({ app: APP_HISTORY_NAMESPACE, screen }, '', window.location.href);
  }, []);
  const replaceAppScreen = useCallback((screen: AppScreen) => {
    window.history.replaceState({ app: APP_HISTORY_NAMESPACE, screen }, '', window.location.href);
  }, []);
  const handleAppBack = useCallback((fallback?: () => void) => {
    const currentState = window.history.state as { app?: string; screen?: AppScreen } | null;

    if (currentState?.app === APP_HISTORY_NAMESPACE && currentState.screen && currentState.screen !== 'menu') {
      window.history.back();
      return;
    }

    fallback?.();
  }, []);
  const categorySwipeDismiss = useSwipeDismiss({
    direction: 'down',
    onDismiss: () => handleAppBack(() => setIsCategoryModalOpen(false)),
  });
  const successSwipeDismiss = useSwipeDismiss({
    direction: 'down',
    onDismiss: () => {
      applyAppScreen('menu');
      replaceAppScreen('menu');
    },
  });
  const ordersSwipeDismiss = useSwipeDismiss({
    direction: 'right',

    onDismiss: () => handleAppBack(() => setView('menu')),
  });
  const activeOfferCards = useMemo(
    () => offers.filter((offer) => offer.enabled),
    [offers],
  );
  const activeOutlets = useMemo(
    () => outlets.filter((outlet) => outlet.enabled),
    [outlets],
  );
  const nearestOutlet = nearestOutletMatch?.outlet ?? null;
  const outletDistanceKm = nearestOutletMatch?.distanceKm ?? null;
  const selectedOutlet = useMemo(
    () => nearestOutlet ?? activeOutlets[0] ?? null,
    [activeOutlets, nearestOutlet],
  );

  useEffect(() => {
    const currentState = window.history.state as { app?: string; screen?: AppScreen } | null;

    if (currentState?.app !== APP_HISTORY_NAMESPACE) {
      replaceAppScreen('menu');
    }

    const handlePopState = (event: PopStateEvent) => {
      const nextState = event.state as { app?: string; screen?: AppScreen } | null;
      const nextScreen = nextState?.app === APP_HISTORY_NAMESPACE ? nextState.screen ?? 'menu' : 'menu';
      applyAppScreen(nextScreen);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [applyAppScreen, replaceAppScreen]);

  useEffect(() => {
    const checkStoreStatus = () => {
      const now = new Date();
      const currentTimeInMins = now.getHours() * 60 + now.getMinutes();
      const openingTime = 11 * 60;
      const closingTime = 21 * 60;

      if (currentTimeInMins < openingTime || currentTimeInMins >= closingTime) {
        setIsStoreOpen(false);
        setStatusMessage('Store is currently closed. Open: 11:00 AM - 08:00 PM.');
        return;
      }

      setIsStoreOpen(true);
      setStatusMessage('Orders are being prepared fresh.');
    };

    checkStoreStatus();
    const interval = window.setInterval(checkStoreStatus, 60000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    NotificationService.notifyOfferReleases(activeOfferCards);
  }, [activeOfferCards]);



  useEffect(() => {
    const handleUnauthorized = () => {
      setAdminSession(null);
      setIsAdminPanelOpen(false);
      const newNotif: InAppNotification = {
        id: Math.random().toString(),
        title: 'Session Expired',
        message: 'Your staff session has expired. Please log in again.',
        type: 'warning'
      };
      setInAppNotifications(prev => [newNotif, ...prev]);
    };
    window.addEventListener('harinos-unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('harinos-unauthorized', handleUnauthorized);
    };
  }, []);

  // Real-time single-device session sync listener for Admin & Manager, plus Firebase Auth for all staff
  useEffect(() => {
    if (!configLoaded || !adminSession) {
      return;
    }
 
    let isMounted = true;
    let unsubscribe: (() => void) | undefined;
 
    const setupSessionListener = async () => {
      try {
        const { doc, onSnapshot } = await import('firebase/firestore');
        const { getAuth, signInWithCustomToken } = await import('firebase/auth');
        const { db, getFirebaseApp } = await import('./services/firebaseClient');
 
        // Authenticate client with Firebase Auth using Custom Token
        if (adminSession.firebaseToken) {
          const auth = getAuth(getFirebaseApp());
          if (!auth.currentUser) {
            await signInWithCustomToken(auth, adminSession.firebaseToken);
            console.log('Signed into Firebase Auth for session guard.');
          }
        }
 
        if (!isMounted) return;
 
        if (adminSession.role === 'admin' || adminSession.role === 'manager') {
          const docRef = doc(db(), 'userSessions', adminSession.username);
          unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (!isMounted) return;
 
            if (!docSnap.exists()) {
              console.warn('Session document missing. Forcing logout.');
              triggerForcedLogout();
              return;
            }
 
            const data = docSnap.data();
            if (data?.sessionId !== adminSession.sessionId) {
              console.warn('Session ID mismatch. Local:', adminSession.sessionId, 'Remote:', data?.sessionId);
              triggerForcedLogout();
            }
          }, (error) => {
            console.error('Session sync error:', error);
          });
        }
      } catch (err) {
        console.error('Failed to setup session listener:', err);
      }
    };
 
    const triggerForcedLogout = () => {
      // Clean local storage
      StorageService.clearAdminSession();
      setAdminSession(null);
      setIsAdminPanelOpen(false);
 
      // Call API logout endpoint to clean up backend
      const apiBase = (import.meta.env.VITE_ORDER_API_BASE_URL ?? '/api').trim() || '/api';
      fetch(`${apiBase}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminSession.token}`,
          'X-Session-Id': adminSession.sessionId || '',
        },
        body: JSON.stringify({ forced: true }),
      }).catch(() => {});
 
      // Alert user
      alert('Your account was logged in from another device.');
    };
 
    setupSessionListener();
 
    return () => {
      isMounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [configLoaded, adminSession]);

  const activeOrder = useMemo(() => {
    return pastOrders.find((order) => order.status !== 'done' && order.status !== 'cancelled');
  }, [pastOrders]);

  const trackedOrderId = activeOrder?.id || latestOrder?.id;

  useEffect(() => {
    if (!configLoaded || !trackedOrderId) return;
    const unsubscribe = subscribeServerOrder(
      trackedOrderId,
      (order) => {
        if (!order) return;
        setPastOrders((currentOrders) =>
          currentOrders.map((currentOrder) => (currentOrder.id === order.id ? order : currentOrder))
        );
        if (latestOrder?.id === order.id) {
          setLatestOrder(order);
        }
      },
      () => undefined,
    );
    const statusPoll = window.setInterval(() => {
      void import('./services/orderApi').then(({ getServerOrderById }) => {
        getServerOrderById(trackedOrderId)
          .then((updatedOrder) => {
            if (!updatedOrder) return;
            setPastOrders((currentOrders) =>
              currentOrders.map((currentOrder) => (currentOrder.id === updatedOrder.id ? updatedOrder : currentOrder)),
            );
            if (latestOrder?.id === updatedOrder.id) {
              setLatestOrder(updatedOrder);
            }
          })
          .catch(() => undefined);
      });
    }, 5000);
    return () => {
      unsubscribe?.();
      window.clearInterval(statusPoll);
    };
  }, [configLoaded, trackedOrderId, latestOrder?.id]);

  useEffect(() => {
    if (!configLoaded || !customerProfile?.id) return;
    let isMounted = true;

    const pollProfile = async () => {
      try {
        const fresh = await getServerCustomerById(customerProfile.id);
        if (fresh && isMounted) {
          if (fresh.status === 'blocked' || fresh.status === 'removed') {
            alert('Your account has been deactivated or blocked by an administrator. You will be logged out.');
            localStorage.removeItem('harinos_customer_profile');
            setCustomerProfile(null);
            return;
          }
          const oldBalance = customerProfileRef.current?.walletBalance ?? 0;
          const newBalance = fresh.walletBalance ?? 0;
          if (newBalance > oldBalance) {
            setShowCelebration(true);
            setTimeout(() => {
              setShowCelebration(false);
            }, 2000);
          }
          setCustomerProfile(fresh);
          StorageService.saveCustomerProfile(fresh);
        }
      } catch (err) {
        console.error('Failed to poll profile:', err);
      }
    };

    pollProfile();
    const interval = setInterval(pollProfile, 8000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [configLoaded, customerProfile?.id]);

  const showNotification = useCallback((messageOrObj: string | { title: string; message: string; type?: 'success' | 'info' | 'warning' | 'error' }) => {
    let title = "Harino's Pizza";
    let message = "";
    let type: 'success' | 'info' | 'warning' | 'error' = "info";

    if (typeof messageOrObj === 'string') {
      message = messageOrObj;
      if (message.toLowerCase().includes('added')) {
        title = "Added to Basket";
        type = "success";
      } else if (message.toLowerCase().includes('copied') || message.toLowerCase().includes('copied!')) {
        title = "Link Copied";
        type = "success";
      } else if (message.toLowerCase().includes('unable') || message.toLowerCase().includes('failed') || message.toLowerCase().includes('required')) {
        title = "Attention Required";
        type = "warning";
      } else if (message.toLowerCase().includes('restored')) {
        title = "Basket Restored";
        type = "success";
      } else if (message.toLowerCase().includes('dine-in')) {
        title = "Dine-in Only";
        type = "info";
      } else if (message.toLowerCase().includes('received') || message.toLowerCase().includes('syncing')) {
        title = "Order Received";
        type = "success";
      }
    } else {
      title = messageOrObj.title;
      message = messageOrObj.message;
      type = messageOrObj.type || "info";
    }

    const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newNotif = { id, title, message, type };

    setInAppNotifications((current) => [...current, newNotif]);

    setTimeout(() => {
      setInAppNotifications((current) => current.filter((n) => n.id !== id));
    }, 4500);
  }, []);

  const refreshNearestOutletMatch = useCallback(
    async (location: CustomerLocation): Promise<OutletMatch | null> => {
      if (!activeOutlets.length) {
        setNearestOutletMatch(null);
        return null;
      }

      setIsResolvingOutletMatch(true);

      try {
        const outletMatch = await findNearestOutletByRoadDistance(location, activeOutlets);
        setNearestOutletMatch(outletMatch);
        return outletMatch;
      } catch (error) {
        console.error('Road distance routing failed:', error);
        setNearestOutletMatch(null);
        throw error;
      } finally {
        setIsResolvingOutletMatch(false);
      }
    },
    [activeOutlets],
  );

  const scrollMenuIntoView = useCallback(() => {
    window.setTimeout(() => {
      menuRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }, []);

  const openOrdersView = useCallback(() => {
    setView('orders');
    pushAppScreen('orders');
  }, [pushAppScreen]);

  const openCartView = useCallback(() => {
    setIsCartOpen(true);
    pushAppScreen('cart');
  }, [pushAppScreen]);

  const openCategoryView = useCallback(() => {
    setIsCategoryModalOpen(true);
    pushAppScreen('category');
  }, [pushAppScreen]);
  const closeCategoryView = useCallback(() => {
    handleAppBack(() => setIsCategoryModalOpen(false));
  }, [handleAppBack]);
  const closeCartView = useCallback(() => {
    handleAppBack(() => setIsCartOpen(false));
  }, [handleAppBack]);
  const closePaymentView = useCallback(() => {
    handleAppBack(() => setIsPaymentOpen(false));
  }, [handleAppBack]);
  const closeOrdersView = useCallback(() => {
    handleAppBack(() => setView('menu'));
  }, [handleAppBack]);
  const closeSuccessView = useCallback(() => {
    applyAppScreen('menu');
    replaceAppScreen('menu');
  }, [applyAppScreen, replaceAppScreen]);
  const returnToMenu = useCallback(() => {
    if (view === 'orders') {
      closeOrdersView();
      return;
    }

    applyAppScreen('menu');
    replaceAppScreen('menu');
  }, [applyAppScreen, closeOrdersView, replaceAppScreen, view]);

  const handleExploreCategory = useCallback(
    (category: CategoryFilter) => {
      setSelectedCategory(category);
      applyAppScreen('menu');
      replaceAppScreen('menu');
      scrollMenuIntoView();
    },
    [applyAppScreen, replaceAppScreen, scrollMenuIntoView],
  );

  const detectLocation = useCallback(async (
    options?: { silentFailure?: boolean },
  ): Promise<CustomerLocation | null> => {
    if (!activeOutlets.length) {
      alert('No active outlet is configured right now. Add a live outlet in constants.tsx before accepting orders.');
      return null;
    }

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation is not supported by this browser.'));
          return;
        }

        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
      });

      const resolvedLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        mapUrl: buildCustomerMapUrl(position.coords.latitude, position.coords.longitude),
      };

      setCustomerLocation(resolvedLocation);

      try {
        await refreshNearestOutletMatch(resolvedLocation);
      } catch (routingError) {
        console.error('Road distance routing failed:', routingError);
        showNotification('Unable to calculate road distance right now. Please try again.');
      }

      return resolvedLocation;
    } catch (error) {
      if (options?.silentFailure) {
        showNotification('Enable location so we can calculate road distance and delivery charges.');
      } else {
        alert('Location is mandatory so we can calculate delivery distance and route your order.');
      }
      return null;
    }
  }, [activeOutlets.length, refreshNearestOutletMatch, showNotification]);

  const handleOrderTypeChange = async (type: OrderType) => {
    setOrderType(type);

    if (type !== 'dinein') {
      setCart((currentCart) => {
        const filteredCart = currentCart.filter((item) => item.category !== Category.BEVERAGES);
        if (filteredCart.length !== currentCart.length) {
          showNotification('Beverages are available for dine-in only.');
        }
        return filteredCart;
      });
    }

    if (type === 'delivery' && !customerLocation) {
      await detectLocation({ silentFailure: true });
    }
  };

  const handleServiceModeSelection = async (type: OrderType) => {
    await handleOrderTypeChange(type);
    setIsServiceModeModalOpen(false);
  };

  const handleShare = async () => {
    const isVerified = customerProfile && (customerProfile.verified === true || String(customerProfile.verified) === 'true');
    const shareText = isVerified && customerProfile.referralCode
      ? `Hey! Order from Harino's Pizza and use my referral code ${customerProfile.referralCode} to get reward points: https://harinos.store`
      : `Check out Harino's Pizza at https://harinos.store`;

    const shareData = {
      title: "Harino's Pizza",
      text: shareText,
      url: 'https://harinos.store',
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (error) {
        console.log('Error sharing:', error);
      }
      return;
    }

    try {
      const didCopy = await copyTextToClipboard(shareText);
      if (didCopy) {
        showNotification({ title: 'Link Copied', message: 'Referral message copied to clipboard.', type: 'success' });
        return;
      }

      alert('Visit us at harinos.store.');
    } catch (error) {
      alert('Visit us at harinos.store.');
    }
  };

  const addToCart = useCallback(
    (item: MenuItem, selectedSize?: string) => {
      if (item.category === Category.BEVERAGES && orderType !== 'dinein') {
        showNotification('Beverages are available for dine-in only.');
        return;
      }

      if (!item.available) {
        return;
      }

      const normalizedSize = selectedSize ?? item.sizes?.[0]?.label;
      const basePrice = getItemBasePrice(item, normalizedSize);

      setCart((currentCart) => {
        const cartItemId = getCartItemId({ id: item.id, selectedSize: normalizedSize });
        const existingItem = currentCart.find((cartItem) => getCartItemId(cartItem) === cartItemId);

        if (existingItem) {
          return currentCart.map((cartItem) => {
            return getCartItemId(cartItem) === cartItemId
              ? { ...cartItem, quantity: cartItem.quantity + 1 }
              : cartItem;
          });
        }

        return [
          ...currentCart,
          {
            ...item,
            quantity: 1,
            selectedSize: normalizedSize,
            basePrice,
          },
        ];
      });

      showNotification(`${item.name} added to basket.`);
    },
    [orderType, showNotification],
  );

  const handleOfferAction = useCallback(
    (offer: OfferCard) => {
      const target = getOfferActionTarget(offer);
      setSelectedCategory(target.category);
      applyAppScreen('menu');
      replaceAppScreen('menu');
      if (target.item) {
        showNotification(`${target.item.name} is featured in this offer.`);
      }
      scrollMenuIntoView();
    },
    [applyAppScreen, replaceAppScreen, scrollMenuIntoView, showNotification],
  );

  const handleNotificationsEnabled = useCallback(() => {
    NotificationService.notifyOfferReleases(activeOfferCards, { force: true });
  }, [activeOfferCards]);

  const resolveOrderContext = useCallback(async (): Promise<ResolvedOrderContext | null> => {
    if (!activeOutlets.length) {
      alert('No active outlet is configured right now. Add a live outlet in constants.tsx before accepting orders.');
      return null;
    }

    if (orderType !== 'delivery') {
      if (!selectedOutlet) {
        alert('No active outlet is configured right now. Add a live outlet in constants.tsx before accepting orders.');
        return null;
      }

      return {
        customerLocation,
        outlet: selectedOutlet,
        distanceKm: null,
      };
    }

    const resolvedLocation = customerLocation ?? (await detectLocation());
    if (!resolvedLocation) {
      return null;
    }

    let outletMatch: OutletMatch | null = null;

    try {
      outletMatch = await refreshNearestOutletMatch(resolvedLocation);
    } catch (error) {
      alert('We could not calculate the road distance to your nearest outlet. Please try again.');
      return null;
    }

    if (!outletMatch) {
      alert('We could not match your location to an active outlet.');
      return null;
    }

    return {
      customerLocation: resolvedLocation,
      outlet: outletMatch.outlet,
      distanceKm: outletMatch.distanceKm,
    };
  }, [
    activeOutlets,
    customerLocation,
    detectLocation,
    orderType,
    refreshNearestOutletMatch,
    selectedOutlet,
  ]);

  const updateQuantity = (cartItemId: string, delta: number) => {
    setCart((currentCart) =>
      currentCart.map((item) => {
        if (getCartItemId(item) !== cartItemId) {
          return item;
        }

        return { ...item, quantity: Math.max(1, item.quantity + delta) };
      }),
    );
  };

  const removeFromCart = (cartItemId: string) => {
    setCart((currentCart) =>
      currentCart.filter((item) => getCartItemId(item) !== cartItemId),
    );
  };

  const handleReorder = useCallback((order: Order) => {
    const manualOrderItems = order.items.filter((item) => !item.isOfferBonus);

    if (!manualOrderItems.length) {
      alert('This saved order only contains promotional bonus items.');
      return;
    }

    const reorderItems = manualOrderItems
      .map((item) => {
        const freshItem = menuItems.find((menuItem) => menuItem.id === item.id);
        const nextItem = freshItem ?? item;
        return normalizeStoredCartItem({
          ...nextItem,
          quantity: item.quantity,
          selectedSize: item.selectedSize,
          basePrice: freshItem ? getItemBasePrice(freshItem, item.selectedSize) : item.basePrice,
        });
      })
      .filter((item) => item.available);

    if (!reorderItems.length) {
      alert('Items from the previous order are currently unavailable.');
      return;
    }

    setCart(reorderItems);
    setView('menu');
    setIsCartOpen(true);
    pushAppScreen('cart');
    showNotification('Last order restored to basket.');
  }, [pushAppScreen, showNotification]);

  const filteredItems = useMemo(
    () =>
      selectedCategory === 'All'
        ? menuItems
        : menuItems.filter((item) => item.category === selectedCategory),
    [selectedCategory, menuItems],
  );

  const baseSubtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.basePrice * item.quantity, 0),
    [cart],
  );

  const bonusCart = useMemo(
    () =>
      getAutomaticOfferBonusItems(cart, activeOfferCards).filter(
        (item) => orderType === 'dinein' || item.category !== Category.BEVERAGES,
      ),
    [activeOfferCards, cart, orderType],
  );

  const cartWithBonuses = useMemo(() => [...cart, ...bonusCart], [bonusCart, cart]);

  const pricedCart = useMemo(
    () => buildPricedCart(cartWithBonuses, activeOfferCards),
    [activeOfferCards, cartWithBonuses],
  );

  const subtotal = useMemo(
    () => pricedCart.reduce((sum, item) => sum + item.totalPrice, 0),
    [pricedCart],
  );

  const deliveryPricing = useMemo(
    () => getDeliveryPricingSummary(nearestOutlet, outletDistanceKm, subtotal),
    [nearestOutlet, outletDistanceKm, subtotal],
  );

  const deliveryFee = useMemo(() => {
    if (orderType !== 'delivery') {
      return 0;
    }

    return deliveryPricing.fee;
  }, [deliveryPricing.fee, orderType]);

  const finalDeliveryFee = orderType === 'delivery' && deliveryFee > 0 ? deliveryFee : 0;
  const currentTotal = subtotal + finalDeliveryFee;

  const customerWalletBalance = customerProfile?.walletBalance ?? 0;
  const customerRewardPoints = customerProfile?.rewardPoints ?? 0;
  const rewardPointsValue = customerRewardPoints * 0.1;

  const walletDiscount = useWallet ? Math.min(customerWalletBalance, currentTotal) : 0;
  const pointsDiscount = usePoints ? Math.min(rewardPointsValue, currentTotal - walletDiscount) : 0;
  const grandTotal = Math.max(0, currentTotal - walletDiscount - pointsDiscount);

  const includedGst = subtotal - subtotal / 1.05;
  const totalCartItems = pricedCart.reduce((sum, item) => sum + item.quantity, 0);

  const handleCheckoutInitiate = async () => {
    if (!isStoreOpen) {
      alert(statusMessage || 'Store is closed right now.');
      return;
    }

    if (!customerProfile) {
      showNotification('Please sign in once before ordering.');
      return;
    }

    const checkoutContext = await resolveOrderContext();
    if (!checkoutContext) {
      return;
    }

    if (getNotificationPermission() === 'default') {
      await NotificationService.requestPermission();
    }

    if (orderType === 'delivery') {
      if (checkoutContext.distanceKm === null) {
        alert('Location is required to calculate the delivery route.');
        return;
      }

      if (checkoutContext.distanceKm > 5 || checkoutContext.distanceKm > checkoutContext.outlet.deliveryRadiusKm) {
        alert(
          `Sorry, we only deliver up to 5 km by road. Your distance is ${checkoutContext.distanceKm.toFixed(1)} km.`,
        );
        return;
      }
    }

    setIsCartOpen(false);
    setIsPaymentOpen(true);
    pushAppScreen('payment');
  };

  const handlePaymentComplete = async (paymentMethod?: string) => {
    const checkoutContext = await resolveOrderContext();
    if (!checkoutContext) {
      showNotification(
        orderType === 'delivery'
          ? 'Location is still required to place this order.'
          : 'We could not match this order to an active outlet.',
      );
      return;
    }

    setIsPaymentOpen(false);

    const { customerLocation: resolvedLocation, outlet, distanceKm } = checkoutContext;
    const locationString = orderType === 'delivery' && resolvedLocation ? resolvedLocation.mapUrl : 'Not shared';

    const orderItems: OrderItem[] = pricedCart.map((item) => ({ ...item }));
    const orderPayload = {
      items: orderItems,
      total: grandTotal,
      date: new Date().toLocaleString(),
      orderType,
      deliveryFee: finalDeliveryFee,
      outletId: outlet.id,
      outletName: outlet.name,
      outletPhone: outlet.phone,
      outletAddress: outlet.address,
      customerLocationUrl: locationString,
      customerLocation: resolvedLocation || undefined,
      distanceKm,
      customerName: customerProfile?.name,
      customerPhone: customerProfile?.phone,
      customerEmail: customerProfile?.email,
      walletAmountRedeemed: walletDiscount,
      rewardPointsRedeemed: pointsDiscount,
      rewardPointsEarned: Math.floor(subtotal / 10),
      paymentMethod: paymentMethod || 'UPI',
    };


    // Deduct applied wallet amount and points from profile
    if (customerProfile) {
      const updatedProfile = { ...customerProfile };

      if (useWallet && walletDiscount > 0) {
        updatedProfile.walletBalance = Math.max(0, (updatedProfile.walletBalance ?? 0) - walletDiscount);
        // Log transaction
        const tx: WalletTransaction = {
          id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          customerId: customerProfile.id,
          customerName: customerProfile.name,
          customerPhone: customerProfile.phone,
          amount: -walletDiscount,
          type: 'debit',
          status: 'completed',
          createdAt: new Date().toISOString()
        };
        void saveWalletTransactionToServer(tx).catch(console.error);
      }

      if (usePoints && pointsDiscount > 0) {
        const pointsDeducted = Math.round(pointsDiscount * 10);
        updatedProfile.rewardPoints = Math.max(0, (updatedProfile.rewardPoints ?? 0) - pointsDeducted);
        // Log transaction
        const tx: WalletTransaction = {
          id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          customerId: customerProfile.id,
          customerName: customerProfile.name,
          customerPhone: customerProfile.phone,
          amount: -pointsDiscount,
          type: 'reward',
          status: 'completed',
          createdAt: new Date().toISOString()
        };
        void saveWalletTransactionToServer(tx).catch(console.error);
      }

      const pointsEarned = Math.floor(subtotal / 10);
      if (pointsEarned > 0) {
        updatedProfile.rewardPoints = (updatedProfile.rewardPoints ?? 0) + pointsEarned;
        // Log transaction
        const tx: WalletTransaction = {
          id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          customerId: customerProfile.id,
          customerName: customerProfile.name,
          customerPhone: customerProfile.phone,
          amount: pointsEarned * 0.1,
          type: 'reward',
          status: 'completed',
          createdAt: new Date().toISOString()
        };
        void saveWalletTransactionToServer(tx).catch(console.error);
      }

      saveCustomerProfile(updatedProfile);
    }

    setUseWallet(false);
    setUsePoints(false);

    let placedOrder: Order;
    try {
      placedOrder = await saveFullOrderToServer(orderPayload);
      // Notify staff/admin about new order
      void notifyStaffNewOrder(placedOrder, outlet.id);
    } catch (error) {
      console.error('Central Firestore order sync failed:', error);
      alert('Service temporarily unavailable. Please try again later.');
      return;
    }

    StorageService.saveOrder(placedOrder);
    setPastOrders((currentOrders) => [placedOrder, ...currentOrders].slice(0, 3));
    setLatestOrder(placedOrder);
    setShowOrderSuccess(true);
    replaceAppScreen('success');
    setCart([]);
  };

  const categoryButtons: CategoryFilter[] = ['All', ...Object.values(Category)];
  const saveCustomerProfile = useCallback(async (profile: CustomerProfile) => {
    try {
      const remoteCustomers = await getServerCustomers();
      const cleanPhone = (p: string) => p.replace(/\D/g, '');
      const targetPhone = cleanPhone(profile.phone);

      const existing = remoteCustomers.find(
        (c) => c.phone && cleanPhone(c.phone) === targetPhone
      );

      if (existing) {
        const mergedProfile: CustomerProfile = {
          ...existing,
          ...profile,
          name: profile.name.trim() || existing.name,
          phone: profile.phone.trim() || existing.phone,
          avatar: profile.avatar || existing.avatar,
        };
        StorageService.saveCustomerProfile(mergedProfile);
        setCustomerProfile(mergedProfile);
        void saveCustomerToServer(mergedProfile).catch(() => undefined);
        if (!customerProfile) {
          alert(`Welcome back, ${mergedProfile.name}! Loaded your existing wallet balance of Rs ${(mergedProfile.walletBalance ?? 0).toFixed(2)} and ${mergedProfile.rewardPoints ?? 0} reward points.`);
        }
        return;
      }
    } catch (err) {
      console.error('Error fetching existing customer profile:', err);
    }

    StorageService.saveCustomerProfile(profile);
    setCustomerProfile(profile);
    void saveCustomerToServer(profile).catch(() => undefined);
  }, [customerProfile]);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#fff7f0] text-slate-900">
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] bg-[radial-gradient(circle_at_top_left,rgba(239,68,68,0.28),transparent_26%),radial-gradient(circle_at_top_right,rgba(251,191,36,0.18),transparent_24%),linear-gradient(180deg,#120507_0%,#2a0d11_18%,#fffaf4_48%,#fff1e4_100%)]" />
      <div className="pointer-events-none absolute -left-24 top-[24rem] h-72 w-72 rounded-full bg-red-200/35 blur-3xl" />
      <div className="pointer-events-none absolute right-[-6rem] top-[36rem] h-80 w-80 rounded-full bg-amber-200/40 blur-3xl" />
      <div className="pointer-events-none absolute left-1/3 top-[70rem] h-64 w-64 rounded-full bg-orange-100/60 blur-3xl" />

      <ServiceModeModal
        isOpen={isServiceModeModalOpen}
        selectedType={orderType}
        onSelect={handleServiceModeSelection}
        storeStatus={statusMessage || 'Choose a service mode to continue.'}
      />

      <Header
        cartCount={totalCartItems}
        onCartClick={openCartView}
        onViewOrders={openOrdersView}
        onViewMenu={returnToMenu}
        activeView={view}
        onShare={handleShare}
        onNotificationsEnabled={handleNotificationsEnabled}
        onAdminTrigger={() => setIsAdminPanelOpen(true)}
        customerProfile={customerProfile}
        onWalletClick={() => setIsWalletModalOpen(true)}
      />
      {!customerProfile && <CustomerLoginModal onSave={saveCustomerProfile} onAdminTrigger={() => setIsAdminPanelOpen(true)} />}
      <InstallPopup
        blocked={
          isCartOpen ||
          isPaymentOpen ||
          showOrderSuccess ||
          isCategoryModalOpen ||
          isServiceModeModalOpen ||
          view === 'orders'
        }
      />

      <main className="relative z-10 pt-20">
        {view === 'menu' ? (
          <>
            <Hero onShare={handleShare} onExploreMenu={openCategoryView} />
            <OfferCarousel offers={activeOfferCards} onAction={handleOfferAction} />

            {/* Active Order Tracking Card */}
            {activeOrder && (
              <div className="max-w-md mx-auto px-4 mt-6">
                <div className="rounded-3xl border border-red-200 bg-white/95 backdrop-blur-md p-6 shadow-xl relative overflow-hidden transition-all hover:shadow-2xl">
                  {/* Neon border decoration */}
                  <div className="absolute top-0 left-0 w-2 h-full bg-red-650 bg-red-600" />

                  <div className="flex justify-between items-start mb-4 pl-3">
                    <div>
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 block">Active Order Tracker</span>
                      <h4 className="text-lg font-display font-bold text-slate-900 mt-0.5">Order #{activeOrder.id}</h4>
                    </div>
                    <span className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-red-100 text-red-750 text-red-700 border border-red-200/50">
                      {(activeOrder.status ?? 'new').replace(/_/g, ' ').toUpperCase()}
                    </span>
                  </div>

                  <div className="pl-3 mb-5">
                    {/* Visual Progress Steps */}
                    <div className="flex items-center justify-between mt-4 relative">
                      <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-slate-100 -translate-y-1/2 z-0" />
                      {['new', 'preparing', 'ready', 'out_for_delivery', 'done'].map((step, idx) => {
                        const statusOrder = ['new', 'preparing', 'ready', 'out_for_delivery', 'done'];
                        const currentIdx = statusOrder.indexOf(activeOrder.status ?? 'new');
                        const isCompleted = statusOrder.indexOf(step) <= currentIdx;
                        const isCurrent = step === (activeOrder.status ?? 'new');

                        return (
                          <div key={step} className="flex flex-col items-center z-10 relative">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all ${isCurrent
                                ? 'bg-red-600 text-white ring-4 ring-red-100 scale-110 shadow-lg shadow-red-200'
                                : isCompleted
                                  ? 'bg-emerald-500 text-white'
                                  : 'bg-slate-100 text-slate-400 border border-slate-200'
                              }`}>
                              {idx + 1}
                            </div>
                            <span className="text-[8px] font-bold uppercase tracking-wider text-slate-500 mt-1.5 whitespace-nowrap hidden sm:inline">
                              {step.replace(/_/g, ' ')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pl-3 flex flex-col sm:flex-row gap-3 items-center justify-between pt-2 border-t border-slate-100">
                    <div className="text-[10px] font-bold text-slate-650 text-slate-600">
                      {activeOrder.estimatedTime ? `Estimated Time: ${activeOrder.estimatedTime}` : 'Fresh ingredients are being prepared.'}
                    </div>
                    <button
                      onClick={() => printOrderReceipt(activeOrder)}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest bg-slate-900 hover:bg-slate-800 text-white shadow-md shadow-slate-900/10 transition-premium w-full sm:w-auto justify-center"
                    >
                      <span>🖨️</span>
                      <span>Download POS Bill</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div ref={menuRef} className="max-w-7xl mx-auto px-4 mt-8 md:mt-12 pb-24 scroll-mt-24">
              <div className="relative mb-8 md:mb-12">
                <div className="flex space-x-2 overflow-x-auto pb-4 pt-2 px-1 hide-scrollbar snap-x snap-mandatory scroll-smooth">
                  {categoryButtons.map((category) => (
                    <button
                      key={category}
                      onClick={() => handleExploreCategory(category)}
                      className={`snap-start whitespace-nowrap px-6 py-4 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all border shadow-sm flex-shrink-0 ${selectedCategory === category
                          ? 'bg-red-600 border-red-600 text-white scale-105 shadow-red-200'
                          : 'bg-white border-slate-100 text-slate-500 hover:text-red-600'
                        }`}
                    >
                      {category}
                    </button>
                  ))}
                </div>
                <div className="absolute right-0 top-0 h-full w-12 bg-gradient-to-l from-slate-50/30 to-transparent pointer-events-none md:hidden" />
              </div>

              {!isStoreOpen && (
                <div className="bg-amber-50 border border-amber-200 p-6 rounded-[2rem] text-center mb-10">
                  <span className="text-amber-700 font-bold text-sm">Outlet Closed - {statusMessage}</span>
                </div>
              )}

              <MenuSection
                items={filteredItems}
                onAddToCart={addToCart}
                offers={activeOfferCards}
                cartSubtotal={baseSubtotal}
              />
            </div>
          </>
        ) : (
          <div style={ordersSwipeDismiss.style} {...ordersSwipeDismiss.bind}>
            <PastOrders orders={pastOrders} onReorder={handleReorder} />
          </div>
        )}
      </main>

      <footer className="relative z-10 overflow-hidden border-t border-white/10 bg-[linear-gradient(135deg,#17070a,#2d0f14_55%,#120507)] py-20 pb-32 text-white md:pb-24">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top,rgba(248,113,113,0.22),transparent_65%)]" />
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h2 className="font-display text-5xl md:text-6xl mb-4 text-red-500">Harino&apos;s</h2>
          <div className="text-white font-bold tracking-[0.6em] uppercase text-[9px] md:text-[11px] mb-10 opacity-40">
            Because Hari Knows
          </div>
          <div className="text-white/20 text-[8px] uppercase tracking-widest mt-8">harinos.store</div>
        </div>
      </footer>

      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div
            className="absolute inset-0 bg-slate-900/90 backdrop-blur-xl"
            onClick={closeCategoryView}
          />
          <div
            className="relative w-full max-w-2xl overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:rounded-[3rem]"
            style={categorySwipeDismiss.style}
            {...categorySwipeDismiss.bind}
          >
            <div className="bg-slate-900 p-5 text-center sm:p-8">
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/25 sm:hidden" />
              <h3 className="mb-2 text-2xl font-display text-white sm:text-3xl">Explore Our Kitchen</h3>
              <p className="text-white/50 text-[10px] uppercase tracking-[0.24em] font-black">
                Choose a category and jump to the menu
              </p>
              <div className="mt-3 text-[9px] font-black uppercase tracking-[0.22em] text-white/35">
                Swipe down to close
              </div>
            </div>
            <div className="p-5 sm:p-8 md:p-12">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {categoryButtons.map((category) => (
                  <button
                    key={category}
                    onClick={() => handleExploreCategory(category)}
                    className="flex items-center justify-between p-5 rounded-2xl bg-slate-50 border border-slate-100 hover:border-red-200 hover:bg-red-50 transition-all group"
                  >
                    <div className="text-left">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-red-500 transition-colors">
                        Category
                      </div>
                      <div className="text-xl font-display font-bold text-slate-900">{category}</div>
                    </div>
                    <svg
                      className="w-5 h-5 text-slate-300 group-hover:text-red-500 transition-colors"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {pricedCart.length > 0 && !isCartOpen && (
        <div className="fixed bottom-6 left-4 right-20 z-50 md:hidden">
          <button
            onClick={openCartView}
            className="w-full bg-slate-900 text-white px-5 py-4 rounded-2xl shadow-2xl flex items-center justify-between border border-white/10"
          >
            <div className="flex items-center space-x-3">
              <div className="bg-red-600 px-2.5 py-1.5 rounded-lg text-[10px] font-black shadow-sm">{totalCartItems}</div>
              <span className="text-[10px] font-black uppercase tracking-widest">View Basket</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-display font-bold text-red-500">Rs {subtotal.toFixed(0)}</span>
              <svg className="w-4 h-4 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>
      )}

      <CartSidebar
        isOpen={isCartOpen}
        onClose={closeCartView}
        items={pricedCart}
        onUpdateQuantity={updateQuantity}
        onRemove={removeFromCart}
        total={subtotal}
        onCheckout={handleCheckoutInitiate}
        orderType={orderType}
        setOrderType={handleOrderTypeChange}
        deliveryFee={deliveryFee}
        deliveryPricing={deliveryPricing}
        nearestOutlet={nearestOutlet}
        selectedOutlet={selectedOutlet}
        outletDistanceKm={outletDistanceKm}
        isResolvingOutletMatch={isResolvingOutletMatch}
        customerLocation={customerLocation}
        onDetectLocation={detectLocation}
        pastOrders={pastOrders}
        onReorder={handleReorder}
        customerProfile={customerProfile}
        useWallet={useWallet}
        setUseWallet={setUseWallet}
        usePoints={usePoints}
        setUsePoints={setUsePoints}
        walletDiscount={walletDiscount}
        pointsDiscount={pointsDiscount}
      />

      <PaymentModal
        isOpen={isPaymentOpen}
        onClose={closePaymentView}
        total={currentTotal - walletDiscount - pointsDiscount}
        onPaymentComplete={handlePaymentComplete}
        outletName={selectedOutlet?.name}
        outletPhone={selectedOutlet?.phone}
        showCOD={true}
        customerProfile={customerProfile}
      />

      <PaymentModal
        isOpen={isWalletPaymentOpen}
        onClose={() => setIsWalletPaymentOpen(false)}
        total={parseFloat(topUpAmount) || 0}
        onPaymentComplete={async () => {
          const amount = parseFloat(topUpAmount);
          if (isNaN(amount) || amount <= 0) return;

          if (!customerProfile) return;

          // Log transaction as pending
          const tx: WalletTransaction = {
            id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            customerId: customerProfile.id,
            customerName: customerProfile.name,
            customerPhone: customerProfile.phone,
            amount: amount,
            type: 'topup',
            status: 'pending',
            createdAt: new Date().toISOString()
          };

          try {
            await saveWalletTransactionToServer(tx);
            setIsWalletPaymentOpen(false);
            setIsWalletModalOpen(false);
            setTopUpAmount('');

            showNotification({
              title: 'Top-up Request Submitted',
              message: `Your top-up of Rs ${amount.toFixed(2)} is pending. Your wallet will be updated within 24h.`,
              type: 'info'
            });
            alert(`Your top-up request of Rs ${amount.toFixed(2)} is submitted successfully. Your wallet will be updated within 24h.`);
          } catch (err) {
            console.error('Wallet top-up failed:', err);
            alert('Wallet top-up failed. Please try again.');
          }
        }}
      />
      <a
        href={CUSTOMER_CARE_WHATSAPP_URL}
        target="_blank"
        rel="noreferrer"
        className="fixed bottom-6 right-4 z-[90] flex h-14 w-14 items-center justify-center rounded-2xl bg-[#25D366] text-white shadow-2xl shadow-green-900/25 transition-transform active:scale-95"
        aria-label="Chat with customer care on WhatsApp"
      >
        <svg className="h-8 w-8" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
          <path d="M16.02 3.2A12.65 12.65 0 005.19 22.36L3.2 29l6.82-1.79A12.65 12.65 0 1016.02 3.2zm0 2.3a10.35 10.35 0 018.77 15.86 10.34 10.34 0 01-13.98 3.4l-.49-.29-4.05 1.06 1.08-3.94-.32-.51A10.35 10.35 0 0116.02 5.5zm-4.2 4.84c-.23 0-.6.08-.91.43-.31.34-1.2 1.17-1.2 2.86 0 1.68 1.23 3.31 1.4 3.54.17.23 2.38 3.8 5.86 5.18 2.9 1.15 3.49.92 4.12.86.63-.06 2.02-.83 2.31-1.63.29-.8.29-1.49.2-1.63-.08-.14-.31-.23-.66-.4-.34-.17-2.02-1-2.34-1.11-.31-.12-.54-.17-.77.17-.23.34-.88 1.11-1.08 1.34-.2.23-.4.26-.74.09-.34-.17-1.45-.53-2.76-1.7-1.02-.91-1.71-2.03-1.91-2.37-.2-.34-.02-.53.15-.7.15-.15.34-.4.51-.6.17-.2.23-.34.34-.57.11-.23.06-.43-.03-.6-.09-.17-.77-1.85-1.05-2.54-.28-.67-.56-.58-.77-.59h-.67z" />
        </svg>
      </a>

      {instagramUrl && (
        <a
          href={instagramUrl}
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-24 right-4 z-[90] flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] text-white shadow-2xl transition-transform active:scale-95 animate-fade-in"
          aria-label="Follow us on Instagram"
        >
          <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
          </svg>
        </a>
      )}

      {isWalletModalOpen && customerProfile && (
        <WalletModal
          isOpen={isWalletModalOpen}
          onClose={() => setIsWalletModalOpen(false)}
          customerProfile={customerProfile}
          onProfileChange={(updated) => {
            setCustomerProfile(updated);
            StorageService.saveCustomerProfile(updated);
          }}
          showNotification={showNotification}
          onProceedToPayment={(amount) => {
            setTopUpAmount(String(amount));
            setIsWalletPaymentOpen(true);
          }}
          instagramUrl={instagramUrl}
        />
      )}

      {/* Celebration Popup (Joy confetti overlay) */}
      {showCelebration && (
        <div className="fixed inset-0 z-[300] pointer-events-none flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 bg-red-600/10 backdrop-blur-[1px] animate-fade-in" />
          <div className="relative bg-white/95 border-2 border-amber-400 rounded-3xl p-8 text-center shadow-[0_25px_60px_-15px_rgba(251,191,36,0.4)] animate-bounce scale-110 flex flex-col items-center justify-center max-w-[85%]">
            <span className="text-6xl animate-spin mb-4">🎉</span>
            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-700">Wallet Added!</div>
            <h4 className="text-2xl font-display font-black text-slate-900 mt-1">SUCCESSFUL TOP-UP!</h4>
            <p className="text-xs text-slate-500 mt-2 font-medium">Your balance has been updated. Happy ordering! 🍕</p>
            <div className="absolute -top-10 -left-10 text-4xl animate-ping">✨</div>
            <div className="absolute -bottom-10 -right-10 text-4xl animate-ping">🌟</div>
          </div>
        </div>
      )}

      {/* Premium Glassmorphic Toast Notification Stack */}
      <div className="fixed top-24 right-4 z-[250] flex flex-col gap-3 w-full max-w-sm pointer-events-none">
        {inAppNotifications.map((notif) => {
          let icon = "ℹ️";
          let borderClass = "border-blue-500/30";
          let bgClass = "bg-slate-900/95 text-white";
          if (notif.type === 'success') {
            icon = "✅";
            borderClass = "border-emerald-500/30";
          } else if (notif.type === 'warning') {
            icon = "⚠️";
            borderClass = "border-amber-500/30";
          } else if (notif.type === 'error') {
            icon = "❌";
            borderClass = "border-red-500/30";
          }

          return (
            <div
              key={notif.id}
              className={`pointer-events-auto flex items-start gap-3 p-4 rounded-2xl border ${borderClass} ${bgClass} backdrop-blur-md shadow-2xl animate-slide-in-right transition-all max-w-[90%] md:max-w-md ml-auto`}
            >
              <span className="text-xl shrink-0 mt-0.5">{icon}</span>
              <div className="flex-1">
                <h4 className="text-xs font-black uppercase tracking-wider">{notif.title}</h4>
                <p className="text-[10px] font-semibold opacity-90 mt-1">{notif.message}</p>
              </div>
              <button
                type="button"
                onClick={() => setInAppNotifications((current) => current.filter((n) => n.id !== notif.id))}
                className="text-slate-400 hover:text-white text-xs font-bold leading-none p-1"
              >
                &times;
              </button>
            </div>
          );
        })}
      </div>

      {notification && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[100] w-full max-w-[90%] md:max-w-xs">
          <div className="bg-slate-900 text-white px-6 md:px-8 py-4 rounded-2xl shadow-2xl border border-red-600/30 mx-auto">
            <span className="text-[10px] md:text-[11px] font-black uppercase tracking-widest">{notification}</span>
          </div>
        </div>
      )}

      {showOrderSuccess && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center px-0 sm:items-center sm:px-4">
          <div className="absolute inset-0 bg-slate-900/75 backdrop-blur-md" onClick={closeSuccessView} />
          <div
            className="relative w-full max-w-sm rounded-t-[2rem] border-2 border-red-600 bg-slate-900 p-6 text-center text-white shadow-2xl sm:rounded-[3rem] sm:p-10"
            style={successSwipeDismiss.style}
            {...successSwipeDismiss.bind}
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/20 sm:hidden" />
            <div className="w-16 h-16 md:w-20 md:h-20 bg-green-500 rounded-full flex items-center justify-center text-white text-3xl md:text-4xl mb-6 mx-auto shadow-xl">
              OK
            </div>
            <h4 className="font-display text-3xl md:text-4xl font-bold mb-3 leading-tight">Order Received</h4>
            <p className="text-white/60 text-[10px] md:text-[11px] uppercase tracking-widest mt-4">
              Status: {(latestOrder?.status ?? 'new').replace(/_/g, ' ').toUpperCase()}
            </p>
            <p className="mt-4 text-[9px] font-black uppercase tracking-[0.22em] text-white/35">
              Swipe down to dismiss
            </p>
            <p className="text-[10px] md:text-[11px] text-red-500 font-black tracking-[0.5em] mt-8 uppercase">
              Because Hari Knows
            </p>
            <button
              onClick={closeSuccessView}
              className="mt-10 px-10 py-4 bg-white/10 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-all w-full"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {isAdminPanelOpen && (
        <AdminPanel
          session={adminSession}
          onSessionChange={setAdminSession}
          onClose={() => setIsAdminPanelOpen(false)}
        />
      )}
    </div>
  );
};

export default App;
