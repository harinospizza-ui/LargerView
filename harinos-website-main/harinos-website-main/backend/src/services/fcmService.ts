import admin from 'firebase-admin';
import { DeviceToken, NotificationPayload, NotificationEventType, NotificationRole, NotificationLog } from '../types/notification.js';
import { getFirebaseApp } from '../config.js';

/**
 * FCM Service - Handles all Firebase Cloud Messaging operations
 * Sends notifications to users based on role, outlet, and events
 */

let messagingInstance: admin.messaging.Messaging | null = null;

const getMessaging = (): admin.messaging.Messaging => {
  if (!messagingInstance) {
    messagingInstance = admin.messaging(getFirebaseApp());
  }
  return messagingInstance;
};

const getFirestore = (): admin.firestore.Firestore => {
  return admin.firestore(getFirebaseApp());
};

/**
 * Build notification message based on event type
 */
export const buildNotificationMessage = (
  eventType: NotificationEventType,
  orderId: string,
  additionalData?: Record<string, string>,
) => {
  const baseData = {
    orderId,
    eventType,
    timestamp: new Date().toISOString(),
    ...additionalData,
  };

  switch (eventType) {
    case 'NEW_ORDER':
      return {
        notification: {
          title: '🍕 New Order Received',
          body: `Order #${orderId} is waiting to be prepared`,
        },
        data: baseData,
      };

    case 'PREPARING':
      return {
        notification: {
          title: 'Order Confirmed',
          body: `Your order #${orderId} is being prepared`,
        },
        data: baseData,
      };

    case 'READY':
      return {
        notification: {
          title: '✨ Order Ready',
          body: `Your order #${orderId} is ready for pickup`,
        },
        data: baseData,
      };

    case 'OUT_FOR_DELIVERY':
      return {
        notification: {
          title: '📍 On the Way',
          body: `Your order #${orderId} is out for delivery`,
        },
        data: baseData,
      };

    case 'DONE':
      return {
        notification: {
          title: '✅ Order Completed',
          body: `Your order #${orderId} has been completed. Thank you!`,
        },
        data: baseData,
      };

    case 'CANCELLED':
      return {
        notification: {
          title: '❌ Order Cancelled',
          body: `Your order #${orderId} has been cancelled`,
        },
        data: baseData,
      };

    default:
      return {
        notification: {
          title: 'Order Update',
          body: `Update for order #${orderId}`,
        },
        data: baseData,
      };
  }
};

/**
 * Send notification to all users with a specific role in an outlet
 */
export const sendNotificationToRole = async (
  eventType: NotificationEventType,
  orderId: string,
  role: NotificationRole,
  outletId?: string,
  additionalData?: Record<string, string>,
): Promise<{ sent: number; failed: number; errors: string[] }> => {
  try {
    const db = getFirestore();
    const messaging = getMessaging();

    // Query tokens for the specified role and outlet
    let query: admin.firestore.Query<admin.firestore.DocumentData> = db
      .collection('notification_tokens')
      .where('role', '==', role)
      .where('isActive', '==', true);

    if (outletId) {
      query = query.where('outletId', '==', outletId);
    }

    const tokensSnapshot = await query.get();
    const tokens = tokensSnapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as DeviceToken));

    if (tokens.length === 0) {
      return { sent: 0, failed: 0, errors: [] };
    }

    const message = buildNotificationMessage(eventType, orderId, additionalData);
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    // Send to each token
    for (const token of tokens) {
      try {
        await messaging.send({
          token: token.fcmToken,
          ...message,
        });
        sent++;
      } catch (error) {
        failed++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Token ${token.fcmToken}: ${errorMsg}`);

        // If token is invalid, mark as inactive
        if (
          errorMsg.includes('unregistered') ||
          errorMsg.includes('invalid') ||
          errorMsg.includes('not-registered')
        ) {
          if (token.id) {
            await db.collection('notification_tokens').doc(token.id).update({ isActive: false });
          }
        }
      }
    }

    // Log notification event
    await logNotificationEvent(eventType, orderId, role, outletId, sent, failed);

    return { sent, failed, errors };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error sending notifications:', errorMsg);
    return { sent: 0, failed: 0, errors: [errorMsg] };
  }
};

/**
 * Send notification to a specific customer
 */
export const sendNotificationToCustomer = async (
  eventType: NotificationEventType,
  orderId: string,
  customerId: string,
  additionalData?: Record<string, string>,
): Promise<{ sent: number; failed: number; errors: string[] }> => {
  try {
    const db = getFirestore();
    const messaging = getMessaging();

    // Get customer's FCM tokens
    const tokensSnapshot = await db
      .collection('notification_tokens')
      .where('userId', '==', customerId)
      .where('role', '==', 'customer')
      .where('isActive', '==', true)
      .get();

    const tokens = tokensSnapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as DeviceToken));

    if (tokens.length === 0) {
      return { sent: 0, failed: 0, errors: [] };
    }

    const message = buildNotificationMessage(eventType, orderId, additionalData);
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const token of tokens) {
      try {
        await messaging.send({
          token: token.fcmToken,
          ...message,
        });
        sent++;
      } catch (error) {
        failed++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Token ${token.fcmToken}: ${errorMsg}`);

        if (
          errorMsg.includes('unregistered') ||
          errorMsg.includes('invalid') ||
          errorMsg.includes('not-registered')
        ) {
          if (token.id) {
            await db.collection('notification_tokens').doc(token.id).update({ isActive: false });
          }
        }
      }
    }

    return { sent, failed, errors };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error sending customer notification:', errorMsg);
    return { sent: 0, failed: 0, errors: [errorMsg] };
  }
};

/**
 * Save FCM token to database
 */
export const saveDeviceToken = async (token: DeviceToken): Promise<void> => {
  try {
    const db = getFirestore();
    const now = new Date().toISOString();

    // Create document ID from userId and token hash
    const tokenHash = token.fcmToken.substring(0, 16);
    const docId = `${token.userId}_${tokenHash}`;

    await db.collection('notification_tokens').doc(docId).set(
      {
        ...token,
        id: docId,
        updatedAt: now,
        lastUsedAt: now,
      },
      { merge: true },
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error saving device token:', errorMsg);
    throw error;
  }
};

/**
 * Delete FCM token from database
 */
export const deleteDeviceToken = async (userId: string, fcmToken: string): Promise<void> => {
  try {
    const db = getFirestore();
    const tokenHash = fcmToken.substring(0, 16);
    const docId = `${userId}_${tokenHash}`;

    await db.collection('notification_tokens').doc(docId).delete();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error deleting device token:', errorMsg);
    throw error;
  }
};

/**
 * Get all active tokens for a user
 */
export const getUserTokens = async (userId: string): Promise<DeviceToken[]> => {
  try {
    const db = getFirestore();
    const snapshot = await db
      .collection('notification_tokens')
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .get();

    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as DeviceToken));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error getting user tokens:', errorMsg);
    return [];
  }
};

/**
 * Log notification event for audit trail
 */
export const logNotificationEvent = async (
  eventType: NotificationEventType,
  orderId: string,
  role: NotificationRole,
  outletId: string | undefined,
  sent: number,
  failed: number,
): Promise<void> => {
  try {
    const db = getFirestore();
    await db.collection('notification_log').add({
      eventType,
      orderId,
      role,
      outletId: outletId || 'all',
      sent,
      failed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Don't throw - logging failures shouldn't break the app
    console.warn('Warning: Failed to log notification event', error);
  }
};
