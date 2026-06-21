import { getMessaging, getToken, onMessage, Unsubscribe } from 'firebase/messaging';
import { getFirebaseApp, isFirebaseClientConfigured } from './firebaseClient';
import { StorageService } from './storage';

const API_BASE_URL = (import.meta.env.VITE_ORDER_API_BASE_URL ?? '/api').trim() || '/api';

/**
 * FCM Service - Handles Firebase Cloud Messaging on the client side
 * Manages FCM tokens and incoming push notifications
 */

let messageUnsubscribe: Unsubscribe | null = null;

/**
 * Initialize FCM and request notification permission
 */
export const initializeFCM = async (): Promise<string | null> => {
  if (!isFirebaseClientConfigured()) {
    console.warn('Firebase client is not configured. FCM will be disabled.');
    return null;
  }

  if (!('serviceWorker' in navigator)) {
    console.warn('Service Workers are not supported. FCM will be disabled.');
    return null;
  }

  if (!('Notification' in window)) {
    console.warn('Notifications are not supported by this browser. FCM will be disabled.');
    return null;
  }

  try {
    // Request notification permission if not already granted
    if (Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.warn('User denied notification permission');
        return null;
      }
    }

    if (Notification.permission !== 'granted') {
      console.warn('Notification permission is not granted');
      return null;
    }

    let registration: ServiceWorkerRegistration | undefined;
    try {
      registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
      console.log('Service Worker registered for FCM:', registration);
    } catch (swError) {
      console.warn('Service Worker registration failed:', swError);
    }

    // Get FCM token
    const messaging = getMessaging(getFirebaseApp());
    const token = await getToken(messaging, {
      vapidKey: (import.meta.env.VITE_FIREBASE_VAPID_KEY ?? '').trim(),
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      throw new Error('Failed to get FCM token');
    }

    console.log('FCM token obtained:', token.substring(0, 20) + '...');

    // Store token locally
    StorageService.saveFCMToken(token);

    // Subscribe to incoming messages (when app is in foreground)
    subscribeFCMMessages();

    return token;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to initialize FCM:', errorMsg);
    return null;
  }
};

/**
 * Get or create FCM token
 */
export const getOrCreateFCMToken = async (): Promise<string | null> => {
  // Check if token already exists locally
  const existingToken = StorageService.getFCMToken();
  if (existingToken) {
    return existingToken;
  }

  // If not, initialize FCM to get new token
  return initializeFCM();
};

/**
 * Send FCM token to backend for storage
 */
export const sendTokenToServer = async (
  token: string,
  role: 'admin' | 'manager' | 'staff' | 'customer',
  userId: string,
  outletId?: string,
): Promise<boolean> => {
  if (!API_BASE_URL) {
    console.warn('API base URL not configured. Cannot send token to server.');
    return false;
  }

  try {
    const session = StorageService.getAdminSession();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (session) {
      if (session.token) {
        headers['Authorization'] = `Bearer ${session.token}`;
      }
      if (session.sessionId) {
        headers['X-Session-Id'] = session.sessionId;
      }
    }

    const response = await fetch(`${API_BASE_URL}/notifications/token`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        fcmToken: token,
        role,
        userId,
        outletId: outletId || undefined,
        deviceInfo: {
          userAgent: navigator.userAgent,
          platform: getPlatform(),
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Failed to register token: ${(errorData as any).message || response.statusText}`,
      );
    }

    console.log('FCM token registered with server');
    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error sending token to server:', errorMsg);
    return false;
  }
};

/**
 * Subscribe to incoming FCM messages (when app is in foreground)
 */
export const subscribeFCMMessages = (
  onMessageCallback?: (payload: any) => void,
): (() => void) | null => {
  if (!isFirebaseClientConfigured()) {
    return null;
  }

  try {
    const messaging = getMessaging(getFirebaseApp());

    messageUnsubscribe = onMessage(messaging, (payload) => {
      console.log('FCM message received (app in foreground):', payload);

      // Call custom callback if provided
      if (onMessageCallback) {
        onMessageCallback(payload);
        return;
      }

      // Default: show notification in app
      const { title, body } = payload.notification || {};
      const data = payload.data;
      if (title && body) {
        // Show as browser notification if permission granted
        if (Notification.permission === 'granted') {
          new Notification(title, {
            body,
            icon: data?.icon || '/icon-192.png',
            badge: data?.badge || '/icon-192.png',
            tag: data?.tag || 'harinos-notification',
            data,
          });
        }
      }
    });

    console.log('FCM message listener subscribed');
    return messageUnsubscribe;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error subscribing to FCM messages:', errorMsg);
    return null;
  }
};

/**
 * Unsubscribe from FCM messages
 */
export const unsubscribeFCMMessages = (): void => {
  if (messageUnsubscribe) {
    messageUnsubscribe();
    messageUnsubscribe = null;
    console.log('FCM message listener unsubscribed');
  }
};

/**
 * Determine device platform
 */
const getPlatform = (): 'Web' | 'iOS' | 'Android' => {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad')) {
    return 'iOS';
  }
  if (ua.includes('android')) {
    return 'Android';
  }
  return 'Web';
};

/**
 * Request notification permission and initialize FCM if granted
 */
export const requestNotificationPermissionAndInitFCM = async (): Promise<{
  permission: NotificationPermission;
  token: string | null;
}> => {
  if (!('Notification' in window)) {
    return { permission: 'denied', token: null };
  }

  if (Notification.permission === 'granted') {
    const token = await initializeFCM();
    return { permission: 'granted', token };
  }

  if (Notification.permission === 'denied') {
    return { permission: 'denied', token: null };
  }

  // Request permission
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    const token = await initializeFCM();
    return { permission, token };
  }

  return { permission, token: null };
};
