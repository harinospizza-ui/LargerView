import { Router } from 'express';
import admin from 'firebase-admin';
import { getFirebaseApp } from '../config.js';
import { CustomerProfile, FullOrderPayload, OrderStatus, WalletTransaction } from '../types.js';
import { getOrderStore } from '../storage/index.js';
import { verifyToken } from '../services/cryptoUtils.js';
import {
  sendNotificationToRole,
  sendNotificationToCustomer,
} from '../services/fcmService.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-harinos-pizza-secret-key-32-chars-minimum';

const authenticateRequest = (req: any): any => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  return verifyToken(token, JWT_SECRET);
};

const logSecurityEvent = async (action: string, username: string, details: string, req?: any) => {
  const clientIp = req ? (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown') : 'unknown';
  const logEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    action,
    username,
    details,
    ip: clientIp
  };
  try {
    const db = admin.firestore(getFirebaseApp());
    await db.collection('security_logs').doc(logEntry.id).set(logEntry);
  } catch (err) {
    console.error('Failed to log security event:', err);
  }
};

const getPendingOrdersCount = async (role: string, outletId?: string): Promise<number> => {
  try {
    const store = getOrderStore();
    const orders = await store.getOrders();
    const pending = orders.filter((o) => !['done', 'cancelled'].includes(o.status || 'new'));
    if (role === 'admin' || !outletId) {
      return pending.length;
    }
    return pending.filter((o) => o.outletId === outletId).length;
  } catch (err) {
    console.error('Failed to get pending orders count:', err);
    return 0;
  }
};

router.get('/orders', async (req, res, next) => {
  try {
    const caller = authenticateRequest(req);
    if (!caller) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const rawOrders = await getOrderStore().getOrders();
    let result = rawOrders;

    if (caller.role === 'staff') {
      result = result.filter(o => !(o as any).isDeleted && (caller.outletId ? o.outletId === caller.outletId : true));
      result = result.map(o => {
        const sanitized = { ...o } as any;
        delete sanitized.total;
        delete sanitized.deliveryFee;
        delete sanitized.walletAmountRedeemed;
        delete sanitized.rewardPointsRedeemed;
        if (Array.isArray(sanitized.items)) {
          sanitized.items = sanitized.items.map((it: any) => {
            const cleanIt = { ...it };
            delete cleanIt.price;
            delete cleanIt.totalPrice;
            return cleanIt;
          });
        }
        return sanitized;
      });
    } else if (caller.role === 'manager') {
      result = result.filter(o => !(o as any).isDeleted);
    }

    res.json({ success: true, orders: result });
  } catch (error) {
    next(error);
  }
});

router.get('/orders/:orderId', async (req, res, next) => {
  try {
    const orderId = req.params.orderId;
    const store = getOrderStore();
    const orders = await store.getOrders();
    const order = orders.find((o: any) => o.id === orderId) as any;

    if (!order || order.isDeleted) {
      res.status(404).json({ success: false, message: 'Order not found.' });
      return;
    }

    const caller = authenticateRequest(req);
    if (caller && caller.role === 'staff') {
      delete order.total;
      delete order.deliveryFee;
      delete order.walletAmountRedeemed;
      delete order.rewardPointsRedeemed;
      if (Array.isArray(order.items)) {
        order.items = order.items.map((it: any) => {
          const cleanIt = { ...it };
          delete cleanIt.price;
          delete cleanIt.totalPrice;
          return cleanIt;
        });
      }
    }

    res.json({ success: true, order });
  } catch (error) {
    next(error);
  }
});

router.post('/orders/full', async (req, res, next) => {
  try {
    const order = req.body as Partial<FullOrderPayload>;
    if (!order.id || !Array.isArray(order.items)) {
      res.status(400).json({ success: false, message: 'Invalid order.' });
      return;
    }

    const fullOrder = {
      ...order,
      receivedAt: order.receivedAt ?? new Date().toISOString(),
      status: order.status ?? 'new',
    } as FullOrderPayload;

    if (fullOrder.paymentMethod === 'COD') {
      const customers = await getOrderStore().getCustomers();
      const phoneToFind = fullOrder.customerPhone ? fullOrder.customerPhone.replace(/\D/g, '') : '';
      const customer = customers.find(c => c.phone && c.phone.replace(/\D/g, '') === phoneToFind);
      if (!customer || !customer.verified) {
        res.status(400).json({ success: false, message: 'Cash On Delivery is available only for verified customers.' });
        return;
      }
    }

    await getOrderStore().saveOrder(fullOrder);


    // Send notifications to all admins, managers, and staff
    const itemSummary = fullOrder.items
      .slice(0, 2)
      .map((item: any) => `${item.quantity || 1}x ${item.name || 'Item'}`)
      .join(', ');
    const additionalInfo = fullOrder.items.length > 2 ? `+${fullOrder.items.length - 2} more` : '';
    const itemText = `${itemSummary}${additionalInfo ? ' ' + additionalInfo : ''}`;

    // Notify admins (all outlets)
    const adminPendingCount = await getPendingOrdersCount('admin');
    void sendNotificationToRole('NEW_ORDER', order.id!, 'admin', undefined, {
      itemSummary: itemText,
      orderType: fullOrder.orderType,
      total: String(Math.round(fullOrder.total)),
      pendingCount: String(adminPendingCount),
    }).catch((err) => console.error('Error notifying admins:', err));

    // Notify managers for the outlet
    if (fullOrder.outletId) {
      const staffPendingCount = await getPendingOrdersCount('staff', fullOrder.outletId);

      void sendNotificationToRole('NEW_ORDER', order.id!, 'manager', fullOrder.outletId, {
        itemSummary: itemText,
        orderType: fullOrder.orderType,
        pendingCount: String(staffPendingCount),
      }).catch((err) => console.error('Error notifying managers:', err));

      // Notify staff for the outlet
      void sendNotificationToRole('NEW_ORDER', order.id!, 'staff', fullOrder.outletId, {
        itemSummary: itemText,
        orderType: fullOrder.orderType,
        pendingCount: String(staffPendingCount),
      }).catch((err) => console.error('Error notifying staff:', err));
    }

    res.status(201).json({ success: true, orderId: order.id });
  } catch (error) {
    next(error);
  }
});

router.post('/orders', async (req, res, next) => {
  try {
    const payload = req.body as {
      items?: unknown[];
      total?: number;
      orderType?: string;
      createdAt?: string;
      outlet?: { id?: string; name?: string; phone?: string; address?: string };
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      [key: string]: unknown;
    };

    if (!Array.isArray(payload.items)) {
      res.status(400).json({ success: false, message: 'Invalid order payload: items list is required.' });
      return;
    }

    // Generate server-side order ID using a sequential number matching today's date
    const store = getOrderStore();
    const orders = await store.getOrders();
    const todayStr = new Date().toLocaleDateString();
    const todayOrdersCount = orders.filter(o => {
      const oDate = new Date(o.receivedAt ?? o.date);
      return oDate.toLocaleDateString() === todayStr;
    }).length;
    const dailySeq = todayOrdersCount + 1;
    const todayFormatted = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const orderId = `HRN-${todayFormatted}-${dailySeq}`;

    const newOrder: FullOrderPayload = {
      id: orderId,
      items: payload.items,
      total: payload.total ?? 0,
      date: new Date().toLocaleString(),
      receivedAt: new Date().toISOString(),
      orderType: payload.orderType ?? 'takeaway',
      deliveryFee: payload.deliveryFee ?? 0,
      outletId: payload.outlet?.id,
      outletName: payload.outlet?.name,
      outletPhone: payload.outlet?.phone,
      outletAddress: payload.outlet?.address,
      customerLocationUrl: String(payload.location ?? ''),
      distanceKm: typeof payload.distanceKm === 'number' ? payload.distanceKm : null,
      customerName: payload.customerName,
      customerPhone: payload.customerPhone,
      customerEmail: payload.customerEmail,
      paymentMethod: payload.paymentMethod as string | undefined,
      status: 'new',
      auditTrail: [{
        timestamp: new Date().toISOString(),
        updatedBy: payload.customerName ? String(payload.customerName) : 'customer',
        action: 'Order placed'
      }]
    } as any;

    if (newOrder.paymentMethod === 'COD') {
      const customers = await getOrderStore().getCustomers();
      const phoneToFind = newOrder.customerPhone ? newOrder.customerPhone.replace(/\D/g, '') : '';
      const customer = customers.find(c => c.phone && c.phone.replace(/\D/g, '') === phoneToFind);
      if (!customer || !customer.verified) {
        res.status(400).json({ success: false, message: 'Cash On Delivery is available only for verified customers.' });
        return;
      }
    }

    await store.saveOrder(newOrder);


    // Send notifications to admins, managers, and staff
    const itemSummary = newOrder.items
      .slice(0, 2)
      .map((item: any) => `${item.quantity || 1}x ${item.name || 'Item'}`)
      .join(', ');
    const additionalInfo = newOrder.items.length > 2 ? `+${newOrder.items.length - 2} more` : '';
    const itemText = `${itemSummary}${additionalInfo ? ' ' + additionalInfo : ''}`;

    const adminPendingCount = orders.filter(o => !['done', 'cancelled'].includes(o.status || 'new')).length + 1;
    const staffPendingCount = newOrder.outletId
      ? orders.filter(o => o.outletId === newOrder.outletId && !['done', 'cancelled'].includes(o.status || 'new')).length + 1
      : adminPendingCount;

    void sendNotificationToRole('NEW_ORDER', orderId, 'admin', undefined, {
      itemSummary: itemText,
      orderType: newOrder.orderType,
      total: String(Math.round(newOrder.total)),
      pendingCount: String(adminPendingCount),
    }).catch((err) => console.error('Error notifying admins:', err));

    if (newOrder.outletId) {
      void sendNotificationToRole('NEW_ORDER', orderId, 'manager', newOrder.outletId, {
        itemSummary: itemText,
        orderType: newOrder.orderType,
        pendingCount: String(staffPendingCount),
      }).catch((err) => console.error('Error notifying managers:', err));

      void sendNotificationToRole('NEW_ORDER', orderId, 'staff', newOrder.outletId, {
        itemSummary: itemText,
        orderType: newOrder.orderType,
        pendingCount: String(staffPendingCount),
      }).catch((err) => console.error('Error notifying staff:', err));
    }

    res.status(201).json({ success: true, order: newOrder });
  } catch (error) {
    next(error);
  }
});

router.patch('/orders/:orderId/status', async (req, res, next) => {
  try {
    const caller = authenticateRequest(req);
    if (!caller) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    const { status, reason } = req.body as { status?: OrderStatus; reason?: string };
    if (!status) {
      res.status(400).json({ success: false, message: 'Missing status.' });
      return;
    }

    if (status === 'cancelled' && !reason) {
      res.status(400).json({ success: false, message: 'Cancellation reason is required.' });
      return;
    }

    if (status === 'cancelled' && caller.role !== 'admin' && caller.role !== 'manager') {
      res.status(403).json({ success: false, message: 'Forbidden. Staff cannot cancel orders.' });
      return;
    }

    const orderId = req.params.orderId;
    const store = getOrderStore();
    const orders = await store.getOrders();
    const order = orders.find((o: any) => o.id === orderId) as any;

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found.' });
      return;
    }

    const previousStatus = order.status || 'new';
    const updatedOrder = {
      ...order,
      status,
      statusUpdatedAt: new Date().toISOString(),
      updatedBy: caller.username,
      ...(status === 'cancelled' ? { cancelledBy: caller.username, cancellationReason: reason } : {}),
      auditTrail: [
        ...(order.auditTrail || []),
        {
          timestamp: new Date().toISOString(),
          updatedBy: caller.username,
          action: `Status changed from ${previousStatus} to ${status}`,
          previousStatus,
          newStatus: status,
          reason: reason || ''
        }
      ]
    };

    await store.saveOrder(updatedOrder);

    if (status === 'cancelled') {
      await logSecurityEvent('ORDER_CANCELLED', caller.username, `Order: ${orderId}, Reason: ${reason}`, req);
    }

    // Send customer notifications only for certain status changes
    const customerNotifiableStatuses: OrderStatus[] = ['preparing', 'ready', 'out_for_delivery', 'done', 'cancelled'];
    if (customerNotifiableStatuses.includes(status)) {
      if (updatedOrder.customerName) {
        const customerId = updatedOrder.customerPhone || updatedOrder.customerEmail || updatedOrder.customerName;

        const eventTypeMap: Record<OrderStatus, any> = {
          new: null,
          preparing: 'PREPARING',
          ready: 'READY',
          out_for_delivery: 'OUT_FOR_DELIVERY',
          done: 'DONE',
          cancelled: 'CANCELLED',
        };

        const eventType = eventTypeMap[status];
        if (eventType && customerId) {
          const addData = status === 'cancelled' ? { reason: reason || '' } : undefined;
          void sendNotificationToCustomer(eventType, orderId, customerId, addData).catch((err) =>
            console.error('Error notifying customer:', err),
          );
        }
      }
    }

    if (status === 'cancelled') {
      void sendNotificationToRole('CANCELLED', orderId, 'admin', undefined, { reason: reason || '' }).catch((err) =>
        console.error('Error notifying admin of cancellation:', err)
      );
      if (updatedOrder.outletId) {
        void sendNotificationToRole('CANCELLED', orderId, 'manager', updatedOrder.outletId, { reason: reason || '' }).catch((err) =>
          console.error('Error notifying manager of cancellation:', err)
        );
      }
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/orders/:orderId', async (req, res, next) => {
  try {
    const caller = authenticateRequest(req);
    if (!caller) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }

    if (caller.role !== 'admin' && caller.role !== 'manager') {
      res.status(403).json({ success: false, message: 'Forbidden. Admin or Manager role required to delete.' });
      return;
    }

    const orderId = req.params.orderId;
    const store = getOrderStore();
    const orders = await store.getOrders();
    const order = orders.find((o: any) => o.id === orderId) as any;

    if (!order) {
      res.status(404).json({ success: false, message: 'Order not found.' });
      return;
    }

    const updatedOrder = {
      ...order,
      isDeleted: true,
      deletedBy: caller.username,
      deletedAt: new Date().toISOString(),
      auditTrail: [
        ...(order.auditTrail || []),
        {
          timestamp: new Date().toISOString(),
          updatedBy: caller.username,
          action: 'Order soft deleted'
        }
      ]
    };

    await store.saveOrder(updatedOrder);
    await logSecurityEvent('ORDER_DELETED', caller.username, `Soft deleted order: ${orderId}`, req);
    res.json({ success: true, message: 'Order deleted successfully.' });
  } catch (error) {
    next(error);
  }
});

router.get('/customers', async (req, res, next) => {
  try {
    const { customerId, phone } = req.query as { customerId?: string; phone?: string };
    const store = getOrderStore();
    
    if (customerId) {
      const customer = await store.getCustomer(decodeURIComponent(customerId));
      if (!customer) {
        res.status(404).json({ success: false, message: 'Customer not found.' });
        return;
      }
      res.json({ success: true, customer });
      return;
    }

    if (phone) {
      const rawPhone = decodeURIComponent(phone);
      const cleanPhone = (p: string) => p.replace(/\D/g, '');
      const targetPhoneDigits = cleanPhone(rawPhone);
      
      const allCustomers = await store.getCustomers();
      const match = allCustomers.find((c) => {
        if (!c.phone) return false;
        return c.phone === rawPhone || cleanPhone(c.phone) === targetPhoneDigits;
      });
      
      res.json({ success: true, customer: match || null });
      return;
    }

    res.json({ success: true, customers: await store.getCustomers() });
  } catch (error) {
    next(error);
  }
});

router.post('/customers', async (req, res, next) => {
  try {
    const { action } = req.query as { action?: string };
    const store = getOrderStore();

    if (action === 'login-init') {
      const { phone, name, isRegistering } = req.body as { phone: string; name?: string; isRegistering?: boolean };
      if (!phone) {
        res.status(400).json({ success: false, message: 'Phone number is required.' });
        return;
      }

      const cleanPhone = (p: string) => p.replace(/\D/g, '');
      const targetPhone = cleanPhone(phone);

      const allCustomers = await store.getCustomers();
      const existingCustomer = allCustomers.find(c => c.phone && cleanPhone(c.phone) === targetPhone);

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiry = Date.now() + 10 * 60 * 1000;

      if (existingCustomer) {
        const updated = {
          ...existingCustomer,
          otp,
          otpExpiry
        };
        await store.saveCustomer(updated);
        res.json({
          success: true,
          exists: true,
          customerId: existingCustomer.id,
          otp,
          message: 'OTP generated successfully.'
        });
        return;
      } else {
        if (!isRegistering) {
          res.json({
            success: false,
            exists: false,
            message: 'Account does not exist. Please create an account.'
          });
          return;
        }

        const newCustomerId = `cust_${Date.now()}`;
        const newCustomer: CustomerProfile = {
          id: newCustomerId,
          name: name?.trim() || 'New Customer',
          phone: phone,
          email: '',
          loginMethod: 'phone',
          verified: false,
          createdAt: new Date().toISOString(),
          walletBalance: 0,
          rewardPoints: 0,
          status: 'active',
          referralAttemptsRemaining: 3,
          referralCodeUsed: false,
          referralLocked: false,
          otp,
          otpExpiry
        };

        await store.saveCustomer(newCustomer);
        res.status(201).json({
          success: true,
          exists: false,
          customerId: newCustomerId,
          otp,
          message: 'OTP generated for registration.'
        });
        return;
      }
    }

    if (action === 'login-verify') {
      const { customerId, otp } = req.body as { customerId: string; otp: string };
      if (!customerId || !otp) {
        res.status(400).json({ success: false, message: 'Customer ID and OTP are required.' });
        return;
      }

      const customer = await store.getCustomer(customerId);
      if (!customer) {
        res.status(404).json({ success: false, message: 'Customer not found.' });
        return;
      }

      if (customer.otp === otp) {
        const generateReferralCode = () => {
          return Math.floor(65536 + Math.random() * 983039).toString(16).toUpperCase();
        };
        const referralCode = customer.referralCode ?? generateReferralCode();
        
        const updatedCustomer: CustomerProfile = {
          ...customer,
          verified: true,
          referralCode,
        };
        delete updatedCustomer.otp;
        delete updatedCustomer.otpExpiry;

        await store.saveCustomer(updatedCustomer);
        res.json({
          success: true,
          customer: updatedCustomer
        });
        return;
      } else {
        res.status(400).json({ success: false, message: 'Incorrect OTP. Please try again.' });
        return;
      }
    }

    const profile = req.body as Partial<CustomerProfile>;
    if (!profile.id || !profile.name || !profile.phone) {
      res.status(400).json({ success: false, message: 'Invalid customer profile.' });
      return;
    }

    await store.saveCustomer(profile as CustomerProfile);
    res.status(201).json({ success: true, customer: profile });
  } catch (error) {
    next(error);
  }
});

router.patch('/customers/:customerId/verify', async (req, res, next) => {
  try {
    const customer = await getOrderStore().verifyCustomer(req.params.customerId);
    if (!customer) {
      res.status(404).json({ success: false, message: 'Customer not found.' });
      return;
    }

    res.json({ success: true, customer });
  } catch (error: any) {
    if (error && error.message && error.message.includes('already verified')) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    next(error);
  }
});

router.get('/wallet/transactions', async (req, res, next) => {
  try {
    const caller = authenticateRequest(req);
    if (!caller) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }
    if (caller.role !== 'admin' && caller.role !== 'manager') {
      res.status(403).json({ success: false, message: 'Forbidden.' });
      return;
    }

    const transactions = await getOrderStore().getWalletTransactions();
    res.json({ success: true, transactions });
  } catch (error) {
    next(error);
  }
});

router.post('/wallet/transactions', async (req, res, next) => {
  try {
    const caller = authenticateRequest(req);
    if (!caller) {
      res.status(401).json({ success: false, message: 'Unauthorized.' });
      return;
    }
    if (caller.role !== 'admin' && caller.role !== 'manager') {
      res.status(403).json({ success: false, message: 'Forbidden.' });
      return;
    }

    const transaction = req.body as WalletTransaction;
    await getOrderStore().saveWalletTransaction(transaction);
    res.status(201).json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
