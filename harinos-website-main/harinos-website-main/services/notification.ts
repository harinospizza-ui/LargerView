import { getOfferNotificationMessage, getOfferReleaseSignature } from '../offerUtils';
import { OfferCard } from '../types';
import { getNotificationPermission, safeStorage } from './browserSupport';

const DEFAULT_ICON = 'https://drive.google.com/thumbnail?id=1Gz7Qi82EYLJZxm1EfFxpXHHQ6mhKQIc4&sz=w500';
const OFFER_RELEASE_KEY = 'harinos_offer_release_signature';

export const NotificationService = {
  requestPermission: async (): Promise<boolean> => {
    const permission = getNotificationPermission();

    if (permission === 'unsupported') {
      console.warn('This browser does not support desktop notification');
      return false;
    }

    if (permission === 'granted') return true;

    if (permission !== 'denied') {
      const nextPermission = await Notification.requestPermission();
      return nextPermission === 'granted';
    }

    return false;
  },

  show: (title: string, body: string, icon?: string) => {
    if (getNotificationPermission() !== 'granted') return;

    const options = {
      body,
      icon: icon || DEFAULT_ICON,
      badge: DEFAULT_ICON,
      vibrate: [100, 50, 100],
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((registration) => {
          registration.showNotification(title, options).catch((err) => {
            console.error('SW notification failed, falling back:', err);
            try {
              new Notification(title, options);
            } catch (e) {
              console.error('Fallback notification failed:', e);
            }
          });
        })
        .catch(() => {
          try {
            new Notification(title, options);
          } catch (e) {
            console.error('Fallback notification failed:', e);
          }
        });
    } else {
      try {
        new Notification(title, options);
      } catch (e) {
        console.error('Native notification failed:', e);
      }
    }
  },

  notifyOfferReleases: (offers: OfferCard[], options?: { force?: boolean }) => {
    if (getNotificationPermission() !== 'granted') {
      return;
    }

    const notifiableOffers = offers.filter((offer) => offer.enabled && offer.notifyCustomers);
    if (!notifiableOffers.length) {
      return;
    }

    const currentSignature = getOfferReleaseSignature(notifiableOffers);
    const previousSignature = safeStorage.getItem(window.localStorage, OFFER_RELEASE_KEY);

    if (!options?.force && previousSignature === currentSignature) {
      return;
    }

    notifiableOffers.forEach((offer, index) => {
      window.setTimeout(() => {
        NotificationService.show(
          `New Offer: ${offer.offerTitle}`,
          getOfferNotificationMessage(offer),
          offer.image || DEFAULT_ICON,
        );
      }, index * 900);
    });

    safeStorage.setItem(window.localStorage, OFFER_RELEASE_KEY, currentSignature);
  },

  simulateOrderStatus: (orderId: string, type: 'takeaway' | 'delivery') => {
    window.setTimeout(() => {
      NotificationService.show(
        'Order Confirmed',
        `We've received your order ${orderId}. The kitchen has started preparing it.`,
      );
    }, 1000);

    window.setTimeout(() => {
      NotificationService.show(
        'In the Oven',
        `Order ${orderId} is being prepared fresh right now.`,
      );
    }, 15000);

    window.setTimeout(() => {
      const title = type === 'delivery' ? 'Out for Delivery' : 'Ready for Pickup';
      const body = type === 'delivery'
        ? 'Our delivery partner is on the way to your location.'
        : 'Your order is hot and ready at the counter.';

      NotificationService.show(title, body);
    }, 45000);
  },
};
