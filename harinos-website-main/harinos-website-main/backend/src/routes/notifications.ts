import { Router, Request, Response, NextFunction } from 'express';
import {
  sendNotificationToRole,
  sendNotificationToCustomer,
  saveDeviceToken,
  deleteDeviceToken,
  getUserTokens,
} from '../services/fcmService.js';
import {
  DeviceToken,
  FCMTokenRegisterRequest,
  SendNotificationRequest,
  NotificationRole,
  NotificationEventType,
} from '../types/notification.js';

const router = Router();

/**
 * POST /api/notifications/token
 * Register or update an FCM token for a user
 *
 * Request body:
 * {
 *   fcmToken: string,
 *   role: 'admin' | 'manager' | 'staff' | 'customer',
 *   userId: string (phone or ID),
 *   outletId?: string,
 *   deviceInfo: { userAgent, platform }
 * }
 */
router.post('/token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = req.body as Partial<FCMTokenRegisterRequest>;

    // Validate required fields
    if (!payload.fcmToken || !payload.role || !payload.userId || !payload.deviceInfo) {
      res.status(400).json({
        success: false,
        message: 'Missing required fields: fcmToken, role, userId, deviceInfo',
      });
      return;
    }

    // Validate role
    const validRoles: NotificationRole[] = ['admin', 'manager', 'staff', 'customer'];
    if (!validRoles.includes(payload.role as NotificationRole)) {
      res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
      });
      return;
    }

    const deviceToken: DeviceToken = {
      userId: payload.userId,
      fcmToken: payload.fcmToken,
      role: payload.role as NotificationRole,
      outletId: payload.outletId,
      deviceType: 'browser',
      deviceInfo: {
        userAgent: payload.deviceInfo.userAgent || 'Unknown',
        platform: (payload.deviceInfo.platform as 'Web' | 'iOS' | 'Android') || 'Web',
      },
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save token to database
    await saveDeviceToken(deviceToken);

    res.status(201).json({
      success: true,
      message: 'Token registered successfully',
      tokenId: `${deviceToken.userId}_${deviceToken.fcmToken.substring(0, 16)}`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/notifications/tokens/:userId
 * Get all active tokens for a user
 */
router.get('/tokens/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: 'userId is required',
      });
      return;
    }

    const tokens = await getUserTokens(userId as string);

    res.json({
      success: true,
      tokens,
      count: tokens.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/notifications/tokens/:userId/:fcmToken
 * Unregister a specific FCM token
 */
router.delete('/tokens/:userId/:fcmToken', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, fcmToken } = req.params;

    if (!userId || !fcmToken) {
      res.status(400).json({
        success: false,
        message: 'userId and fcmToken are required',
      });
      return;
    }

    await deleteDeviceToken(userId as string, fcmToken as string);

    res.json({
      success: true,
      message: 'Token deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/notifications/send
 * Send a manual notification (admin only)
 *
 * Request body:
 * {
 *   targetRole?: 'admin' | 'manager' | 'staff' | 'customer',
 *   userId?: string,
 *   outletId?: string,
 *   title: string,
 *   body: string,
 *   orderId?: string,
 *   data?: Record<string, string>
 * }
 */
router.post('/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = req.body as Partial<SendNotificationRequest>;

    if (!payload.title || !payload.body) {
      res.status(400).json({
        success: false,
        message: 'title and body are required',
      });
      return;
    }

    let result = { sent: 0, failed: 0, errors: [] as string[] };

    // If targeting a specific user
    if (payload.userId && payload.orderId) {
      result = await sendNotificationToCustomer(
        'DONE', // Generic event type for manual sends
        payload.orderId,
        payload.userId,
        { customTitle: payload.title, customBody: payload.body },
      );
    }
    // If targeting a role
    else if (payload.targetRole && payload.orderId) {
      result = await sendNotificationToRole(
        'DONE',
        payload.orderId,
        payload.targetRole as NotificationRole,
        payload.outletId,
        { customTitle: payload.title, customBody: payload.body },
      );
    } else {
      res.status(400).json({
        success: false,
        message: 'Must provide either (userId, orderId) or (targetRole, orderId)',
      });
      return;
    }

    res.json({
      success: true,
      sent: result.sent,
      failed: result.failed,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
