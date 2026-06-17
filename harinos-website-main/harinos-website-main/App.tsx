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
import { getServerOrders, saveCustomerToServer, saveFullOrderToServer, subscribeServerOrder, getServerMenuItems, seedMenuItemsToServer, subscribeServerMenuItems, getServerOutlets, seedOutletsToServer, subscribeServerOutlets, getServerOffers, seedOffersToServer, subscribeServerOffers, saveWalletTransactionToServer, getServerCustomers, verifyServerCustomer } from './services/orderApi';
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
import { useSwipeDismiss } from './hooks/useSwipeDismiss';

interface InAppNotification {
  id: string;
  title: string;
  message: string;
  type?: 'success' | 'info' | 'warning' | 'error';
}

const APP_HISTORY_NAMESPACE = 'harinos-ui';
const CUSTOMER_CARE_WHATSAPP_URL = 'https://wa.me/917818958571';

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

  // Request notification permission on app load
  useEffect(() => {
    void requestNotificationPermission();
  }, []);

  // Fetch dynamic menu, outlets, offers and auto-seed if empty
  useEffect(() => {
    if (!configLoaded) return;

    let unsubscribeMenu: (() => void) | null = null;
    let unsubscribeOutlets: (() => void) | null = null;
    let unsubscribeOffers: (() => void) | null = null;

    const loadData = async () => {
      try {
        const items = await getServerMenuItems();
        if (items.length === 0) {
          console.log('Seeding database menu_items...');
          await seedMenuItemsToServer(MENU_ITEMS);
          setMenuItems(extendMenuItemsWithGeneratedSeries(MENU_ITEMS));
        } else {
          setMenuItems(extendMenuItemsWithGeneratedSeries(items));
        }

        const outletList = await getServerOutlets();
        if (outletList.length === 0) {
          console.log('Seeding database outlets...');
          await seedOutletsToServer(OUTLET_LOCATIONS);
          setOutlets(OUTLET_LOCATIONS);
        } else {
          setOutlets(outletList);
        }

        const offerList = await getServerOffers();
        if (offerList.length === 0) {
          console.log('Seeding database offers...');
          await seedOffersToServer(OFFER_CARDS);
          setOffers(OFFER_CARDS);
        } else {
          setOffers(offerList);
        }
      } catch (err) {
        console.error('Failed to load menu/outlets/offers:', err);
      }
    };

    unsubscribeMenu = subscribeServerMenuItems(
      (items) => {
        if (items.length > 0) setMenuItems(extendMenuItemsWithGeneratedSeries(items));
      },
      () => undefined
    );

    unsubscribeOutlets = subscribeServerOutlets(
      (outlets) => {
        if (outlets.length > 0) setOutlets(outlets);
      },
      () => undefined
    );

    unsubscribeOffers = subscribeServerOffers(
      (offers) => {
        if (offers.length > 0) setOffers(offers);
      },
      () => undefined
    );

    loadData();

    return () => {
      unsubscribeMenu?.();
      unsubscribeOutlets?.();
      unsubscribeOffers?.();
    };
  }, [configLoaded]);

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
    if (!configLoaded) return;
    const retryPendingOrders = () => {
      const pendingOrders = StorageService.getPendingOrderSyncQueue();
      if (!pendingOrders.length) return;

      pendingOrders.forEach((pendingOrder) => {
        void saveFullOrderToServer(pendingOrder)
          .then(() => StorageService.removePendingOrderSync(pendingOrder.id))
          .catch(() => undefined);
      });
    };

    retryPendingOrders();
    const retryTimer = window.setInterval(retryPendingOrders, 15000);
    window.addEventListener('online', retryPendingOrders);
    return () => {
      window.clearInterval(retryTimer);
      window.removeEventListener('online', retryPendingOrders);
    };
  }, [configLoaded]);

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
      void getServerOrders()
        .then((orders) => {
          const updatedOrder = orders.find((order) => order.id === trackedOrderId);
          if (!updatedOrder) return;
          setPastOrders((currentOrders) =>
            currentOrders.map((currentOrder) => (currentOrder.id === updatedOrder.id ? updatedOrder : currentOrder)),
          );
          if (latestOrder?.id === updatedOrder.id) {
            setLatestOrder(updatedOrder);
          }
        })
        .catch(() => undefined);
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
        const customers = await getServerCustomers();
        const fresh = customers.find((c) => c.id === customerProfile.id);
        if (fresh && isMounted) {
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
    const interval = setInterval(pollProfile, 4000);

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

      if (checkoutContext.distanceKm > checkoutContext.outlet.deliveryRadiusKm) {
        alert(
          `Sorry, ${checkoutContext.outlet.name} currently serves only up to ${checkoutContext.outlet.deliveryRadiusKm} km by road.`,
        );
        return;
      }
    }

    setIsCartOpen(false);
    setIsPaymentOpen(true);
    pushAppScreen('payment');
  };

  const handlePaymentComplete = async () => {
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
    let dailySeq = 1;
    try {
      const allOrders = await getServerOrders();
      const todayStr = new Date().toLocaleDateString();
      const todayOrdersCount = allOrders.filter(o => {
        const oDate = new Date(o.receivedAt ?? o.date);
        return oDate.toLocaleDateString() === todayStr;
      }).length;
      dailySeq = todayOrdersCount + 1;
    } catch (e) {
      console.error('Failed to calculate daily order sequence:', e);
      dailySeq = Math.floor(1 + Math.random() * 99);
    }
    const todayFormatted = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderId = `HRN-${todayFormatted}-${dailySeq}`;
    const orderItems: OrderItem[] = pricedCart.map((item) => ({ ...item }));
    const newOrder: Order = {
      id: orderId,
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
      receivedAt: new Date().toISOString(),
      status: 'new',
      walletAmountRedeemed: walletDiscount,
      rewardPointsRedeemed: pointsDiscount,
      rewardPointsEarned: Math.floor(subtotal / 10),
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

    try {
      await saveFullOrderToServer(newOrder);
      // Notify staff/admin about new order
      void notifyStaffNewOrder(newOrder, outlet.id);
    } catch (error) {
      console.error('Central Firestore order sync failed:', error);
      StorageService.queuePendingOrderSync(newOrder);
      showNotification('Order received. Syncing with outlet.');
    }

    StorageService.saveOrder(newOrder);
    setPastOrders((currentOrders) => [newOrder, ...currentOrders].slice(0, 3));
    setLatestOrder(newOrder);
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

      {/* Customer Wallet Modal */}
      {isWalletModalOpen && customerProfile && (
        <div className="fixed inset-0 z-[150] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-xl" onClick={() => setIsWalletModalOpen(false)} />
          <div className="relative w-full max-w-sm rounded-t-[2.5rem] bg-white p-6 text-slate-900 shadow-2xl sm:rounded-[3rem] animate-slide-up max-h-[90vh] overflow-y-auto hide-scrollbar">
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200 sm:hidden" />

            <div className="flex justify-between items-center mb-6">
              <div>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Harino's Customer Profile</span>
                <h3 className="text-2xl font-display font-bold text-slate-900">Profile & Wallet</h3>
              </div>
              <button
                onClick={() => setIsWalletModalOpen(false)}
                className="w-8 h-8 rounded-full border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-550 font-bold hover:text-red-500"
              >
                &times;
              </button>
            </div>

            {/* Profile Picture Upload Section */}
            <div className="flex flex-col items-center mb-6">
              <div className="relative group">
                <div className="w-24 h-24 rounded-full border-4 border-slate-100 shadow-xl overflow-hidden bg-slate-50 flex items-center justify-center">
                  {customerProfile.avatar ? (
                    <img src={customerProfile.avatar} className="w-full h-full object-cover" alt="Profile" />
                  ) : (
                    <span className="text-4xl">👤</span>
                  )}
                </div>
                <label className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center cursor-pointer shadow-lg hover:bg-red-650 transition-colors">
                  <span className="text-xs">📷</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (uploadEvent) => {
                          const base64 = uploadEvent.target?.result as string;
                          const updated = { ...customerProfile, avatar: base64 };
                          saveCustomerProfile(updated);
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </label>
              </div>

              {/* Referral Code directly under profile picture */}
              {(customerProfile.verified === true || String(customerProfile.verified) === 'true') && customerProfile.referralCode && (
                <div className="mt-3 text-xs font-black uppercase tracking-widest bg-red-100 text-red-700 px-3 py-1 rounded-full border border-red-200/50 animate-pulse">
                  Referral Code: {customerProfile.referralCode}
                </div>
              )}

              <div className="mt-3 flex items-center gap-1.5">
                <span className="font-display font-black text-xl text-slate-900">{customerProfile.name}</span>
                {(customerProfile.verified === true || String(customerProfile.verified) === 'true') && (
                  <span className="inline-flex items-center justify-center bg-blue-500 text-white rounded-full w-4.5 h-4.5 text-[9px] font-black" title="Verified Customer">✓</span>
                )}
              </div>
              <span className="text-xs text-slate-500 font-bold">📞 {customerProfile.phone}</span>
            </div>

            <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-100 rounded-3xl p-5 mb-4 text-center shadow-inner">
              <div className="text-[10px] font-black uppercase tracking-widest text-orange-800 mb-1">Wallet Balance</div>
              <span className="text-3xl font-display font-black text-orange-950">Rs {(customerProfile.walletBalance ?? 0).toFixed(2)}</span>
              <div className="mt-2 text-[9px] font-black uppercase tracking-[0.2em] text-orange-850">
                Reward Points: {customerProfile.rewardPoints ?? 0} pts (Rs {((customerProfile.rewardPoints ?? 0) * 0.1).toFixed(2)})
              </div>
            </div>

            {/* OTP Verification Section */}
            {!(customerProfile.verified === true || String(customerProfile.verified) === 'true') && (
              <div className="mb-6 p-4 border border-orange-100 bg-orange-50/30 rounded-2xl">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-550 mb-2">
                  Verify Your Account
                </label>
                <p className="text-[11px] text-slate-600 mb-3 font-medium">
                  Enter the 6-digit OTP shared by the Admin/Manager (via WhatsApp or SMS) to verify your profile.
                </p>
                <div className="relative flex items-center border border-slate-200 rounded-xl focus-within:border-red-500 bg-white p-1">
                  <input
                    type="text"
                    placeholder="Enter 6-digit OTP"
                    value={inputOtp}
                    onChange={(e) => setInputOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full pl-3 pr-24 py-2 text-sm font-bold tracking-widest outline-none bg-transparent"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const otpVal = inputOtp.trim();
                      if (otpVal.length !== 6) {
                        showNotification({
                          title: 'Invalid OTP',
                          message: 'Please enter a 6-digit number.',
                          type: 'warning'
                        });
                        return;
                      }

                      try {
                        // Fetch fresh data from server to check the OTP
                        const remoteCustomers = await getServerCustomers();
                        const freshProfile = remoteCustomers.find((c) => c.id === customerProfile.id);

                        if (!freshProfile) {
                          showNotification({
                            title: 'Error',
                            message: 'Could not retrieve your profile from the server.',
                            type: 'error'
                          });
                          return;
                        }

                        if (!freshProfile.otp) {
                          showNotification({
                            title: 'Verification Pending',
                            message: 'No OTP has been generated for your account yet. Please ask the Admin/Manager to send you an OTP.',
                            type: 'warning'
                          });
                          return;
                        }

                        if (freshProfile.otp === otpVal) {
                          // OTP matches! Let's verify using the existing backend verification routine verifyServerCustomer!
                          const result = await verifyServerCustomer(customerProfile.id);
                          if (result) {
                            StorageService.markCustomerVerified(customerProfile.id);

                            // Merge locally
                            const updatedLocalProfile = {
                              ...customerProfile,
                              verified: true,
                              referralCode: result.referralCode,
                              otp: undefined
                            };
                            StorageService.saveCustomerProfile(updatedLocalProfile);
                            setCustomerProfile(updatedLocalProfile);

                            showNotification({
                              title: 'Account Verified!',
                              message: `Your profile is verified. Your referral code is ${result.referralCode ?? ''}`,
                              type: 'success'
                            });

                            setInputOtp('');
                          } else {
                            throw new Error('Verification returned no customer data.');
                          }
                        } else {
                          showNotification({
                            title: 'Verification Failed',
                            message: 'The OTP you entered is incorrect. Please try again.',
                            type: 'error'
                          });
                        }
                      } catch (err: any) {
                        console.error('OTP verification error:', err);
                        showNotification({
                          title: 'Verification Failed',
                          message: err.message || 'Failed to verify OTP. Please try again.',
                          type: 'error'
                        });
                      }
                    }}
                    className="absolute right-1 top-1 bottom-1 px-4 bg-red-655 bg-red-600 hover:bg-red-500 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 shadow-md shadow-red-200/50"
                  >
                    Verify
                  </button>
                </div>
              </div>
            )}

            {/* Referral Code Entry Section */}
            {(customerProfile.verified === true || String(customerProfile.verified) === 'true') && !customerProfile.referralApplied && (customerProfile.referralAttempts ?? 0) < 3 && (
              <div className="mb-6 p-4 border border-slate-100 bg-slate-50/50 rounded-2xl">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                  Have a Referral Code? (Attempts remaining: {3 - (customerProfile.referralAttempts ?? 0)})
                </label>
                <div className="relative flex items-center border border-slate-200 rounded-xl focus-within:border-red-500 bg-white p-1">
                  <input
                    type="text"
                    placeholder="Enter 5-digit code"
                    value={inputReferralCode}
                    onChange={(e) => setInputReferralCode(e.target.value.toUpperCase().slice(0, 5))}
                    className="w-full pl-3 pr-20 py-2 text-sm font-bold uppercase tracking-wider outline-none bg-transparent"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const code = inputReferralCode.trim().toUpperCase();
                      if (!code) {
                        alert('Please enter a referral code.');
                        return;
                      }

                      if (code === customerProfile.referralCode) {
                        alert('You cannot use your own referral code.');
                        return;
                      }

                      try {
                        const allCustomers = await getServerCustomers();
                        const referrer = allCustomers.find(
                          (c) => c.referralCode === code && (c.verified === true || String(c.verified) === 'true')
                        );

                        if (referrer) {
                          // Reward referrer (A) with 100 points
                          const updatedReferrer = {
                            ...referrer,
                            rewardPoints: (referrer.rewardPoints ?? 0) + 100
                          };

                          // Create reward transaction for A
                          const tx: WalletTransaction = {
                            id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                            customerId: referrer.id,
                            customerName: referrer.name,
                            customerPhone: referrer.phone,
                            amount: 10, // 100 points = Rs 10
                            type: 'reward',
                            status: 'completed',
                            createdAt: new Date().toISOString()
                          };

                          await saveWalletTransactionToServer(tx);
                          await saveCustomerToServer(updatedReferrer);

                          // Mark B as referral completed
                          const updatedSelf = {
                            ...customerProfile,
                            referralApplied: true,
                            referredBy: code
                          };
                          saveCustomerProfile(updatedSelf);
                          setInputReferralCode('');
                          showNotification({
                            title: 'Referral Applied',
                            message: 'Referral code applied! 100 reward points (Rs 10 value) have been sent to your referrer.',
                            type: 'success'
                          });
                        } else {
                          // Referrer not found
                          const attempts = (customerProfile.referralAttempts ?? 0) + 1;
                          const maxAttemptsReached = attempts >= 3;
                          const updatedSelf = {
                            ...customerProfile,
                            referralAttempts: attempts,
                            referralApplied: maxAttemptsReached ? true : undefined
                          };
                          saveCustomerProfile(updatedSelf);
                          if (maxAttemptsReached) {
                            showNotification({
                              title: 'Attempts Exhausted',
                              message: 'Invalid code. You have exhausted your 3 referral attempts.',
                              type: 'error'
                            });
                          } else {
                            showNotification({
                              title: 'Invalid Code',
                              message: `Invalid referral code. Attempts remaining: ${3 - attempts}`,
                              type: 'warning'
                            });
                          }
                        }
                      } catch (err) {
                        console.error('Referral code apply failed:', err);
                        showNotification({
                          title: 'Error',
                          message: 'An error occurred. Please try again.',
                          type: 'error'
                        });
                      }
                    }}
                    className="absolute right-1 top-1 bottom-1 px-4 bg-red-650 bg-red-600 hover:bg-red-500 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 shadow-md shadow-red-200/50"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}

            {/* Add Money Form */}
            <div className="space-y-4">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Top-up Wallet</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400">Rs</span>
                <input
                  type="number"
                  placeholder="Enter amount"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-2xl font-bold text-slate-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/20"
                />
              </div>

              {/* Presets */}
              <div className="grid grid-cols-4 gap-2">
                {['100', '200', '500', '1000'].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setTopUpAmount(amt)}
                    className="py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-700 hover:border-red-500 hover:bg-red-50 active:scale-95 transition-all"
                  >
                    +Rs {amt}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  const amount = parseFloat(topUpAmount);
                  if (isNaN(amount) || amount <= 0) {
                    alert('Please enter a valid amount.');
                    return;
                  }
                  setIsWalletPaymentOpen(true);
                }}
                className="w-full bg-red-650 bg-red-600 hover:bg-red-500 text-white py-3.5 rounded-2xl text-[10px] font-bold uppercase tracking-[0.2em] shadow-lg shadow-red-200 transition-premium active:scale-95 text-center block mt-2 font-black"
              >
                Proceed to Payment
              </button>
            </div>

            {/* Share options dropdown/grid */}
            <div className="mt-6 pt-5 border-t border-slate-100">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 text-center">Share & Earn 100 Pts</div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  type="button"
                  onClick={handleShare}
                  className="flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 px-4 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-700 transition-all active:scale-95 cursor-pointer"
                >
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 100 6 3 3 0 000-6z" />
                  </svg>
                  <span>Share App</span>
                </button>
                <a
                  href="https://wa.me/917818958571?text=Hello%20Harinos%20Support,%20I%20need%20help%20with%20my%20wallet/order."
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 px-4 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-700 transition-all active:scale-95 text-center font-bold"
                >
                  <span>💬</span> Need Help
                </a>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {/* WhatsApp */}
                <button
                  type="button"
                  onClick={() => {
                    const isVerified = customerProfile && (customerProfile.verified === true || String(customerProfile.verified) === 'true');
                    const shareText = isVerified && customerProfile.referralCode
                      ? `Hey! Order from Harino's Pizza and use my referral code ${customerProfile.referralCode} to get reward points: https://harinos.store`
                      : `Check out Harino's Pizza at https://harinos.store`;
                    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
                    window.open(url, '_blank');
                  }}
                  className="flex flex-col items-center p-3 rounded-2xl bg-white border border-slate-150 hover:border-red-200 hover:bg-red-50/20 active:scale-95 transition-all text-center cursor-pointer shadow-sm"
                >
                  <svg className="w-6 h-6 text-[#25D366] mb-1.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.457L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.825 1.451 5.436 0 9.86-4.42 9.864-9.858.002-2.634-1.025-5.11-2.893-6.98-1.869-1.868-4.35-2.897-6.98-2.898-5.44 0-9.866 4.425-9.87 9.863-.001 1.638.428 3.236 1.243 4.646L1.879 22.148l4.768-1.251zM18.06 14.9c-.33-.164-1.95-.96-2.25-1.07-.3-.11-.52-.164-.74.164-.22.33-.85 1.07-1.04 1.28-.19.22-.385.247-.715.082-1.815-.91-2.91-1.485-4.08-3.485-.31-.53.31-.49.89-1.64.09-.19.045-.355-.022-.52-.067-.164-.6-.145-1.05-1.07-.22-.45-.48-.39-.655-.4-.165-.01-.355-.01-.545-.01-.19 0-.5.07-.76.355-.26.285-1 1-1 2.44 0 1.44 1.05 2.84 1.2 3.03.15.19 2.07 3.16 5 4.39 2.45 1.03 2.95.83 3.48.78.53-.05 1.7-.69 1.94-1.365.24-.67.24-1.24.17-1.365-.07-.12-.27-.19-.6-.355z" />
                  </svg>
                  <span className="text-[9px] font-bold tracking-tight text-slate-700">WhatsApp</span>
                </button>

                {/* Telegram */}
                <button
                  type="button"
                  onClick={() => {
                    const isVerified = customerProfile && (customerProfile.verified === true || String(customerProfile.verified) === 'true');
                    const shareText = isVerified && customerProfile.referralCode
                      ? `Hey! Order from Harino's Pizza and use my referral code ${customerProfile.referralCode} to get reward points!`
                      : `Check out Harino's Pizza!`;
                    const url = `https://t.me/share/url?url=https://harinos.store&text=${encodeURIComponent(shareText)}`;
                    window.open(url, '_blank');
                  }}
                  className="flex flex-col items-center p-3 rounded-2xl bg-white border border-slate-150 hover:border-red-200 hover:bg-red-50/20 active:scale-95 transition-all text-center cursor-pointer shadow-sm"
                >
                  <svg className="w-6 h-6 text-[#0088cc] mb-1.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.944 0C5.344 0 0 5.344 0 12s5.344 12 11.944 12c6.6 0 11.944-5.344 11.944-12S18.544 0 11.944 0zM17.5 8.16l-1.93 9.09c-.14.65-.53.81-1.08.5l-2.95-2.17-1.42 1.37c-.16.16-.29.29-.59.29l.21-3.01 5.48-4.95c.24-.22-.05-.34-.37-.13l-6.78 4.27-2.92-.91c-.63-.2-.64-.63.13-.93l11.39-4.39c.53-.19.99.13.81 1.04z" />
                  </svg>
                  <span className="text-[9px] font-bold tracking-tight text-slate-700">Telegram</span>
                </button>

                {/* X / Twitter */}
                <button
                  type="button"
                  onClick={() => {
                    const isVerified = customerProfile && (customerProfile.verified === true || String(customerProfile.verified) === 'true');
                    const shareText = isVerified && customerProfile.referralCode
                      ? `Hey! Order from Harino's Pizza and use my referral code ${customerProfile.referralCode} to get reward points: https://harinos.store`
                      : `Check out Harino's Pizza: https://harinos.store`;
                    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
                    window.open(url, '_blank');
                  }}
                  className="flex flex-col items-center p-3 rounded-2xl bg-white border border-slate-150 hover:border-red-200 hover:bg-red-50/20 active:scale-95 transition-all text-center cursor-pointer shadow-sm"
                >
                  <svg className="w-6 h-6 text-black mb-1.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  <span className="text-[9px] font-bold tracking-tight text-slate-700">Twitter/X</span>
                </button>

                {/* Instagram */}
                <button
                  type="button"
                  onClick={async () => {
                    const isVerified = customerProfile && (customerProfile.verified === true || String(customerProfile.verified) === 'true');
                    const shareText = isVerified && customerProfile.referralCode
                      ? `Hey! Order from Harino's Pizza and use my referral code ${customerProfile.referralCode} to get reward points: https://harinos.store`
                      : `Check out Harino's Pizza at https://harinos.store`;
                    const didCopy = await copyTextToClipboard(shareText);
                    if (didCopy) {
                      showNotification({ title: 'Copied Message', message: 'Referral message copied to clipboard. Redirecting to Instagram.', type: 'success' });
                    }
                    window.open('https://www.instagram.com', '_blank');
                  }}
                  className="flex flex-col items-center p-3 rounded-2xl bg-white border border-slate-150 hover:border-red-200 hover:bg-red-50/20 active:scale-95 transition-all text-center cursor-pointer shadow-sm"
                >
                  <svg className="w-6 h-6 text-[#E1306C] mb-1.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.051.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                  </svg>
                  <span className="text-[9px] font-bold tracking-tight text-slate-700">Instagram</span>
                </button>

                {/* Facebook */}
                <button
                  type="button"
                  onClick={() => {
                    const isVerified = customerProfile && (customerProfile.verified === true || String(customerProfile.verified) === 'true');
                    const shareText = isVerified && customerProfile.referralCode
                      ? `Hey! Order from Harino's Pizza and use my referral code ${customerProfile.referralCode} to get reward points!`
                      : `Check out Harino's Pizza!`;
                    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://harinos.store')}&quote=${encodeURIComponent(shareText)}`;
                    window.open(url, '_blank');
                  }}
                  className="flex flex-col items-center p-3 rounded-2xl bg-white border border-slate-150 hover:border-red-200 hover:bg-red-50/20 active:scale-95 transition-all text-center cursor-pointer shadow-sm"
                >
                  <svg className="w-6 h-6 text-[#1877F2] mb-1.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>
                  <span className="text-[9px] font-bold tracking-tight text-slate-700">Facebook</span>
                </button>

                {/* Copy Link */}
                <button
                  type="button"
                  onClick={async () => {
                    const isVerified = customerProfile && (customerProfile.verified === true || String(customerProfile.verified) === 'true');
                    const shareText = isVerified && customerProfile.referralCode
                      ? `Hey! Order from Harino's Pizza and use my referral code ${customerProfile.referralCode} to get reward points: https://harinos.store`
                      : `Check out Harino's Pizza at https://harinos.store`;
                    const didCopy = await copyTextToClipboard(shareText);
                    if (didCopy) {
                      showNotification({ title: 'Link Copied', message: 'Referral message copied to clipboard.', type: 'success' });
                    }
                  }}
                  className="flex flex-col items-center p-3 rounded-2xl bg-white border border-slate-150 hover:border-red-200 hover:bg-red-50/20 active:scale-95 transition-all text-center cursor-pointer shadow-sm"
                >
                  <svg className="w-6 h-6 text-slate-500 mb-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                  </svg>
                  <span className="text-[9px] font-bold tracking-tight text-slate-700">Copy Link</span>
                </button>
              </div>
            </div>
          </div>
        </div>
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
