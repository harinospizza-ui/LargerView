import type { VercelRequest, VercelResponse } from '@vercel/node';
import authHandler from './handlers/auth.js';
import configHandler from './handlers/config.js';
import customersHandler from './handlers/customers.js';
import ordersHandler from './handlers/orders.js';
import settingsHandler from './handlers/settings.js';
import walletHandler from './handlers/wallet.js';
import notificationsHandler from './handlers/notifications.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Global CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Session-Id');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const url = new URL(req.url ?? '/', 'https://harinos.local');
  const path = url.pathname.replace(/^\/api\/?/, '/');
  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) {
    res.status(404).json({ success: false, message: 'Route not found.' });
    return;
  }

  const controller = parts[0];

  try {
    switch (controller) {
      case 'auth':
        await authHandler(req, res);
        break;

      case 'config':
      case 'firebase-config':
        await configHandler(req, res);
        break;

      case 'customers':
        if (parts.length === 2) {
          req.query.customerId = parts[1];
        } else if (parts.length === 3 && parts[2] === 'verify') {
          req.query.customerId = parts[1];
          req.query.action = 'verify';
        }
        await customersHandler(req, res);
        break;

      case 'orders':
        if (parts.length === 2) {
          req.query.orderId = parts[1];
        } else if (parts.length === 3 && parts[2] === 'status') {
          req.query.orderId = parts[1];
          req.query.action = 'status';
        }
        await ordersHandler(req, res);
        break;

      case 'settings':
        await settingsHandler(req, res);
        break;

      case 'wallet':
        await walletHandler(req, res);
        break;

      case 'notifications':
        if (parts.length >= 2) {
          req.query.action = parts[1];
        }
        await notificationsHandler(req, res);
        break;

      case 'admin':
        res.status(200).json({
          success: true,
          backups: [],
          lastBackupTime: new Date().toISOString(),
          lastBackupSize: '0 KB',
          lastBackupStatus: 'completed',
          lastBackupLocation: 'Firebase Firestore'
        });
        break;

      default:
        res.status(404).json({ success: false, message: `Route /api/${controller} not found.` });
        break;
    }
  } catch (error: any) {
    console.error(`[Router Error] Error handling route /api/${path}:`, error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error.',
    });
  }
}
