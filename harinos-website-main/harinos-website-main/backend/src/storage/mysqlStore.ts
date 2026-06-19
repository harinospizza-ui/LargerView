import mysql from 'mysql2/promise';
import { config } from '../config.js';
import { CustomerProfile, FullOrderPayload, OrderStatus, MenuItem, OutletConfig, OfferCard, AdminUser, WalletTransaction, AppSettings } from '../types.js';

import { OrderStore, newestOrdersFirst } from './store.js';


let pool: mysql.Pool | null = null;
let schemaReady: Promise<void> | null = null;

const getPool = (): mysql.Pool => {
  if (!pool) {
    pool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      waitForConnections: true,
      connectionLimit: 10,
    });
  }

  return pool;
};

const ensureSchema = async (): Promise<void> => {
  if (!schemaReady) {
    schemaReady = (async () => {
      await getPool().execute(`
        CREATE TABLE IF NOT EXISTS orders (
          id VARCHAR(64) PRIMARY KEY,
          payload JSON NOT NULL,
          status VARCHAR(32) NOT NULL,
          received_at DATETIME NOT NULL,
          outlet_id VARCHAR(128) NULL,
          customer_phone VARCHAR(32) NULL,
          total DECIMAL(10,2) NOT NULL DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      await getPool().execute(`
        CREATE TABLE IF NOT EXISTS customers (
          id VARCHAR(128) PRIMARY KEY,
          payload JSON NOT NULL,
          phone VARCHAR(32) NOT NULL,
          email VARCHAR(255) NULL,
          verified BOOLEAN NOT NULL DEFAULT FALSE,
          created_at DATETIME NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);

      await getPool().execute(`
        CREATE TABLE IF NOT EXISTS menu_items (
          id VARCHAR(64) PRIMARY KEY,
          payload JSON NOT NULL,
          available BOOLEAN NOT NULL DEFAULT TRUE
        )
      `);

      await getPool().execute(`
        CREATE TABLE IF NOT EXISTS outlets (
          id VARCHAR(64) PRIMARY KEY,
          payload JSON NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE
        )
      `);

      await getPool().execute(`
        CREATE TABLE IF NOT EXISTS offers (
          id VARCHAR(64) PRIMARY KEY,
          payload JSON NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE
        )
      `);

      await getPool().execute(`
        CREATE TABLE IF NOT EXISTS staff_users (
          username VARCHAR(128) PRIMARY KEY,
          payload JSON NOT NULL,
          role VARCHAR(32) NOT NULL
        )
      `);

      await getPool().execute(`
        CREATE TABLE IF NOT EXISTS wallet_transactions (
          id VARCHAR(64) PRIMARY KEY,
          payload JSON NOT NULL,
          created_at DATETIME NOT NULL
        )
      `);

      await getPool().execute(`
        CREATE TABLE IF NOT EXISTS settings (
          id VARCHAR(64) PRIMARY KEY,
          payload JSON NOT NULL
        )
      `);
    })();
  }


  await schemaReady;
};

const toMysqlDate = (value: string | undefined): string => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 19).replace('T', ' ') : date.toISOString().slice(0, 19).replace('T', ' ');
};

const parseJsonColumn = <T,>(value: unknown): T => {
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value as T;
};

export const mysqlStore: OrderStore = {
  name: 'mysql',

  async getOrders(options?: { role?: string; outletId?: string; limit?: number; lastVisible?: string }) {
    await ensureSchema();
    const [rows] = await getPool().query<mysql.RowDataPacket[]>('SELECT payload FROM orders ORDER BY received_at DESC');
    return newestOrdersFirst(rows.map((row) => parseJsonColumn<FullOrderPayload>(row.payload)));
  },

  async saveOrder(order) {
    await ensureSchema();
    const status: OrderStatus = order.status ?? 'new';
    const nextOrder: FullOrderPayload = {
      ...order,
      receivedAt: order.receivedAt ?? new Date().toISOString(),
      status,
    };

    await getPool().execute(
      `
        INSERT INTO orders (id, payload, status, received_at, outlet_id, customer_phone, total)
        VALUES (?, CAST(? AS JSON), ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          payload = VALUES(payload),
          status = VALUES(status),
          received_at = VALUES(received_at),
          outlet_id = VALUES(outlet_id),
          customer_phone = VALUES(customer_phone),
          total = VALUES(total)
      `,
      [
        nextOrder.id,
        JSON.stringify(nextOrder),
        status,
        toMysqlDate(nextOrder.receivedAt ?? nextOrder.date),
        nextOrder.outletId ?? null,
        nextOrder.customerPhone ?? null,
        nextOrder.total ?? 0,
      ],
    );
  },

  async updateOrderStatus(orderId, status) {
    await ensureSchema();
    const [rows] = await getPool().execute<mysql.RowDataPacket[]>('SELECT payload FROM orders WHERE id = ?', [orderId]);
    if (!rows.length) return;
    const order = { ...parseJsonColumn<FullOrderPayload>(rows[0].payload), status };
    await getPool().execute('UPDATE orders SET payload = CAST(? AS JSON), status = ? WHERE id = ?', [
      JSON.stringify(order),
      status,
      orderId,
    ]);
  },

  async getCustomers() {
    await ensureSchema();
    const [rows] = await getPool().query<mysql.RowDataPacket[]>('SELECT payload FROM customers ORDER BY created_at DESC');
    return rows.map((row) => parseJsonColumn<CustomerProfile>(row.payload));
  },

  async getCustomer(customerId) {
    await ensureSchema();
    const [rows] = await getPool().execute<mysql.RowDataPacket[]>('SELECT payload FROM customers WHERE id = ?', [customerId]);
    if (!rows.length) return null;
    return parseJsonColumn<CustomerProfile>(rows[0].payload);
  },

  async saveCustomer(profile) {
    await ensureSchema();
    await getPool().execute(
      `
        INSERT INTO customers (id, payload, phone, email, verified, created_at)
        VALUES (?, CAST(? AS JSON), ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          payload = VALUES(payload),
          phone = VALUES(phone),
          email = VALUES(email),
          verified = VALUES(verified)
      `,
      [
        profile.id,
        JSON.stringify(profile),
        profile.phone,
        profile.email ?? null,
        Boolean(profile.verified),
        toMysqlDate(profile.createdAt),
      ],
    );
  },

  async verifyCustomer(customerId) {
    await ensureSchema();
    const [rows] = await getPool().execute<mysql.RowDataPacket[]>('SELECT payload FROM customers WHERE id = ?', [customerId]);
    if (!rows.length) return null;
    const customerData = parseJsonColumn<CustomerProfile>(rows[0].payload);

    const [allVerifiedRows] = await getPool().query<mysql.RowDataPacket[]>('SELECT payload FROM customers WHERE verified = TRUE');
    const allVerified = allVerifiedRows.map((row) => parseJsonColumn<CustomerProfile>(row.payload));
    const cleanPhone = (p: string) => p.replace(/\D/g, '');
    const targetPhone = cleanPhone(customerData.phone);
    const alreadyVerified = allVerified.some((c) => c.id !== customerId && c.phone && cleanPhone(c.phone) === targetPhone);
    if (alreadyVerified) {
      throw new Error('This phone number is already verified under another profile.');
    }

    const generateReferralCode = () => {
      return Math.floor(65536 + Math.random() * 983039).toString(16).toUpperCase();
    };
    const referralCode = customerData.referralCode ?? generateReferralCode();

    const customer: CustomerProfile = { ...customerData, verified: true, referralCode };
    await getPool().execute('UPDATE customers SET payload = CAST(? AS JSON), verified = TRUE WHERE id = ?', [
      JSON.stringify(customer),
      customerId,
    ]);
    return customer;
  },

  async getMenuItems() {
    await ensureSchema();
    const [rows] = await getPool().query<mysql.RowDataPacket[]>('SELECT payload FROM menu_items');
    return rows.map((row) => parseJsonColumn<MenuItem>(row.payload));
  },

  async saveMenuItem(item) {
    await ensureSchema();
    await getPool().execute(
      `
        INSERT INTO menu_items (id, payload, available)
        VALUES (?, CAST(? AS JSON), ?)
        ON DUPLICATE KEY UPDATE
          payload = VALUES(payload),
          available = VALUES(available)
      `,
      [item.id, JSON.stringify(item), Boolean(item.available)],
    );
    // Update menu version
    const [rows] = await getPool().query<mysql.RowDataPacket[]>('SELECT payload FROM settings WHERE id = ?', ['app']);
    let settings: AppSettings = {};
    if (rows.length > 0) {
      settings = parseJsonColumn<AppSettings>(rows[0].payload);
    }
    settings.menuVersion = Date.now().toString();
    await getPool().execute(
      `
        INSERT INTO settings (id, payload)
        VALUES (?, CAST(? AS JSON))
        ON DUPLICATE KEY UPDATE
          payload = VALUES(payload)
      `,
      ['app', JSON.stringify(settings)],
    );
  },

  async getOutlets() {
    await ensureSchema();
    const [rows] = await getPool().query<mysql.RowDataPacket[]>('SELECT payload FROM outlets');
    return rows.map((row) => parseJsonColumn<OutletConfig>(row.payload));
  },

  async saveOutlet(outlet) {
    await ensureSchema();
    await getPool().execute(
      `
        INSERT INTO outlets (id, payload, enabled)
        VALUES (?, CAST(? AS JSON), ?)
        ON DUPLICATE KEY UPDATE
          payload = VALUES(payload),
          enabled = VALUES(enabled)
      `,
      [outlet.id, JSON.stringify(outlet), Boolean(outlet.enabled)],
    );
    // Update menu version
    const [rows] = await getPool().query<mysql.RowDataPacket[]>('SELECT payload FROM settings WHERE id = ?', ['app']);
    let settings: AppSettings = {};
    if (rows.length > 0) {
      settings = parseJsonColumn<AppSettings>(rows[0].payload);
    }
    settings.menuVersion = Date.now().toString();
    await getPool().execute(
      `
        INSERT INTO settings (id, payload)
        VALUES (?, CAST(? AS JSON))
        ON DUPLICATE KEY UPDATE
          payload = VALUES(payload)
      `,
      ['app', JSON.stringify(settings)],
    );
  },

  async getOffers() {
    await ensureSchema();
    const [rows] = await getPool().query<mysql.RowDataPacket[]>('SELECT payload FROM offers');
    return rows.map((row) => parseJsonColumn<OfferCard>(row.payload));
  },

  async saveOffer(offer) {
    await ensureSchema();
    await getPool().execute(
      `
        INSERT INTO offers (id, payload, enabled)
        VALUES (?, CAST(? AS JSON), ?)
        ON DUPLICATE KEY UPDATE
          payload = VALUES(payload),
          enabled = VALUES(enabled)
      `,
      [offer.id, JSON.stringify(offer), Boolean(offer.enabled)],
    );
    // Update menu version
    const [rows] = await getPool().query<mysql.RowDataPacket[]>('SELECT payload FROM settings WHERE id = ?', ['app']);
    let settings: AppSettings = {};
    if (rows.length > 0) {
      settings = parseJsonColumn<AppSettings>(rows[0].payload);
    }
    settings.menuVersion = Date.now().toString();
    await getPool().execute(
      `
        INSERT INTO settings (id, payload)
        VALUES (?, CAST(? AS JSON))
        ON DUPLICATE KEY UPDATE
          payload = VALUES(payload)
      `,
      ['app', JSON.stringify(settings)],
    );
  },

  async getStaffUsers() {
    await ensureSchema();
    const [rows] = await getPool().query<mysql.RowDataPacket[]>('SELECT payload FROM staff_users');
    return rows.map((row) => parseJsonColumn<AdminUser>(row.payload));
  },

  async saveStaffUser(user) {
    await ensureSchema();
    await getPool().execute(
      `
        INSERT INTO staff_users (username, payload, role)
        VALUES (?, CAST(? AS JSON), ?)
        ON DUPLICATE KEY UPDATE
          payload = VALUES(payload),
          role = VALUES(role)
      `,
      [user.username, JSON.stringify(user), user.role],
    );
  },

  async getWalletTransactions() {
    await ensureSchema();
    const [rows] = await getPool().query<mysql.RowDataPacket[]>('SELECT payload FROM wallet_transactions ORDER BY created_at DESC');
    return rows.map((row) => parseJsonColumn<WalletTransaction>(row.payload));
  },

  async saveWalletTransaction(transaction) {
    await ensureSchema();
    await getPool().execute(
      `
        INSERT INTO wallet_transactions (id, payload, created_at)
        VALUES (?, CAST(? AS JSON), ?)
        ON DUPLICATE KEY UPDATE
          payload = VALUES(payload),
          created_at = VALUES(created_at)
      `,
      [transaction.id, JSON.stringify(transaction), toMysqlDate(transaction.createdAt)],
    );
  },

  async getSettings() {
    await ensureSchema();
    const [rows] = await getPool().query<mysql.RowDataPacket[]>('SELECT payload FROM settings WHERE id = ?', ['app']);
    if (rows.length === 0) return {};
    return parseJsonColumn<AppSettings>(rows[0].payload);
  },

  async saveSettings(settings) {
    await ensureSchema();
    await getPool().execute(
      `
        INSERT INTO settings (id, payload)
        VALUES (?, CAST(? AS JSON))
        ON DUPLICATE KEY UPDATE
          payload = VALUES(payload)
      `,
      ['app', JSON.stringify(settings)],
    );
  },
};

