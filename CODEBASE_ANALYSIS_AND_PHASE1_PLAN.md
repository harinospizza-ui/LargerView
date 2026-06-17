# HARINO'S PIZZA - PRODUCTION UPGRADE ANALYSIS & IMPLEMENTATION PLAN

**Document Date**: June 14, 2026  
**Project**: Restaurant Management & Ordering Platform  
**Technology Stack**: React 19 + TypeScript + Vite + Firebase + Express.js  
**Deployment**: Vercel (Serverless) + Firebase Firestore

---

## EXECUTIVE SUMMARY

### Current State
Your Harino's ordering platform has a **solid foundation** with:
- ✅ Working order management system
- ✅ Multi-role admin panel (Admin, Manager, Staff)
- ✅ Real-time Firestore integration
- ✅ UPI payment system
- ✅ PWA scaffold
- ✅ Multi-storage backend (Firebase, MySQL, JSON)

### Critical Gaps
- ❌ **NO NOTIFICATION SYSTEM** - Nobody receives any notifications
- ❌ **SECURITY ISSUES** - Admin credentials in frontend, unsecured API endpoints
- ❌ **INCOMPLETE RBAC** - No permission validation on backend
- ❌ **MISSING ANALYTICS** - No dashboard metrics/reports
- ❌ **INCOMPLETE PWA** - Service worker doesn't handle background sync

### Immediate Action Required
**PHASE 1 (HIGHEST PRIORITY): Implement comprehensive notification system using Firebase Cloud Messaging (FCM)**

This document provides:
1. Deep codebase analysis
2. Detailed Phase 1 implementation plan
3. File-by-file modification guidance
4. Security considerations
5. Testing strategy
6. Deployment checklist

---

## PART 1: CODEBASE ANALYSIS

### 1.1 PROJECT STRUCTURE

```
harinos-website-main/
├── Package.json (Vite + Express + Firebase deps)
├── Vite.config.ts (Dev server with local API)
├── api/ (Vercel serverless)
│   ├── index.ts
│   └── [...path].ts (Firebase integration layer)
├── harinos-website-main/harinos-website-main/
│   ├── FRONTEND (React App)
│   │   ├── App.tsx (Main app - 250+ lines)
│   │   ├── types.ts (Core data structures)
│   │   ├── constants.tsx (Menu, offers, outlets config)
│   │   ├── adminConfig.ts (Username/password - SECURITY ISSUE)
│   │   ├── components/
│   │   │   ├── AdminPanel.tsx (Order management)
│   │   │   ├── PaymentModal.tsx (UPI QR code)
│   │   │   ├── CartSidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── Other UI components
│   │   ├── services/
│   │   │   ├── firebaseClient.ts (Firestore init)
│   │   │   ├── orderApi.ts (REST wrapper + Firestore)
│   │   │   ├── notification.ts (Browser notifications ONLY)
│   │   │   ├── storage.ts (localStorage)
│   │   │   ├── browserSupport.ts (Permission checks)
│   │   │   └── runtime.ts
│   │   ├── hooks/
│   │   │   ├── useSwipeDismiss.ts
│   │   │   └── useInstallPrompt.ts
│   │   ├── public/
│   │   │   ├── sw.js (Service Worker - BASIC)
│   │   │   ├── version.json
│   │   │   └── images/
│   │   ├── manifest.json (PWA config)
│   │   ├── index.html
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── BACKEND
│       └── src/
│           ├── app.ts (Express setup)
│           ├── server.ts (Startup)
│           ├── config.ts (Environment config)
│           ├── types.ts (Data structures)
│           ├── routes/orders.ts (REST API - UNSECURED)
│           └── storage/
│               ├── store.ts (Interface)
│               ├── jsonStore.ts
│               ├── mysqlStore.ts
│               ├── firebaseStore.ts
│               └── index.ts (Storage selector)
```

### 1.2 FRONTEND ARCHITECTURE ANALYSIS

#### App.tsx (Main Application)
- **Purpose**: Central application orchestration
- **Current Responsibilities**:
  - Menu display with filtering
  - Shopping cart management
  - Order placement workflow
  - Admin panel access
  - Order history display
  - Service mode selection (takeaway/delivery)
  - Store opening hours check
  - Outlet location detection

- **Concerns**:
  - Single giant component (complex state management)
  - No separate contexts for auth, cart, notifications
  - Notification permission requested but not used
  - `NotificationService.simulateOrderStatus()` called but notifications never actually sent

#### Services Layer Analysis

**firebaseClient.ts**
```typescript
// Current: Basic Firestore config
- Reads environment variables: VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID, etc.
- Initializes Firebase app
- Provides Firestore database instance
- Collections: 'orders', 'customers'

// Missing for notifications:
- Firebase Messaging initialization
- FCM token retrieval
- Notification permission handling
```

**orderApi.ts**
```typescript
// Current: Dual storage (Firestore + REST fallback)
- getServerOrders() → Real-time Firestore
- saveFullOrderToServer() → Firestore setDoc or REST /orders/full
- updateServerOrderStatus() → Firestore updateDoc or REST /orders/{id}/status
- subscribeServerOrders() → Real-time listener

// Issues:
- No notification triggers on order creation
- No notification triggers on status updates
- Status updates don't notify customers
```

**notification.ts**
```typescript
// Current: Browser Notifications API ONLY
export const NotificationService = {
  requestPermission() → Asks for browser notification permission
  show() → Shows desktop notification
  notifyOfferReleases() → Shows offer notifications
  simulateOrderStatus() → FAKE STATUS UPDATES (never sends real updates)
}

// Critical gaps:
- No Firebase Cloud Messaging (FCM) setup
- No notification tokens stored
- No role-based targeting
- No backend integration
```

**storage.ts**
```typescript
// Current: localStorage wrapper
- Stores past orders (3 most recent)
- Stores admin session
- Stores customer profile
- Stores pending order sync queue

// Missing:
- No FCM token storage
- No notification preferences per user
```

#### Components Analysis

**AdminPanel.tsx**
```typescript
// Current state:
- Login with username/password
- Display orders (paginated/list view)
- Status updates via updateServerOrderStatus()
- Customer verification
- Print orders
- Order refresh every 3-5 seconds

// Issues:
- setStatus() calls updateServerOrderStatus() but:
  → No notification sent to customers
  → No notification sent to other staff about update
  → Admins only see notifications about NEW orders (not status changes)
- All 3 roles see all orders (if admin=all, outlet filtering only for manager/staff)
- No actual notifications in real-time - only poll-based refresh
```

#### Key Findings for Notifications
1. **Notification Permission** is requested but not used
2. **Browser Notifications** shown only for offer releases
3. **Status Changes** never trigger any notifications
4. **Customer Never Notified** of their order status
5. **New Orders** only show browser notification if admin has tab open
6. **No FCM** - No mobile/PWA push notifications
7. **No Token Storage** - Can't send notifications without device tokens

### 1.3 BACKEND ARCHITECTURE ANALYSIS

#### app.ts
```typescript
// Simple Express app with:
- CORS enabled (allow all origins)
- JSON parsing middleware
- /health endpoint
- / routes (ordersRouter)
- Global error handler

// Missing:
- Authentication middleware
- Role validation middleware
- Rate limiting
- Notification endpoints
```

#### routes/orders.ts
```typescript
// Current endpoints:
GET    /orders → Returns all orders
POST   /orders/full → Save order (no validation)
POST   /orders → Legacy order format
PATCH  /orders/:orderId/status → Update status
GET    /customers → Get all customers
POST   /customers → Save customer
PATCH  /customers/:customerId/verify → Verify customer

// Security Issues:
- No authentication check
- No role validation
- Anyone can update any order status
- No audit logging
```

#### config.ts
```typescript
// Configurable storage driver:
- STORAGE_DRIVER: 'json' | 'mysql' | 'firebase'
- MySQL connection config
- Firebase service account (env vars)
- JSON file store path

// Status: ✅ Good multi-storage design
```

#### types.ts
```typescript
// Defines:
OrderStatus: 'new' | 'preparing' | 'ready' | 'out_for_delivery' | 'done' | 'cancelled'
OrderType: 'takeaway' | 'delivery' | 'dinein'
FullOrderPayload, CustomerProfile

// Missing:
NotificationRecord, DeviceToken, NotificationPreference
```

### 1.4 DEPLOYMENT & CONFIGURATION

#### Vercel Setup
- Frontend deployed to Vercel
- `/api/[...path].ts` handles backend requests
- Firebase Admin SDK used in Vercel functions
- Environment variables for Firebase

#### Firestore Rules
```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /orders/{orderId} {
      allow read: if true;  // ⚠️ PUBLIC READ
      allow create, update: if validOrder();
    }
    match /customers/{customerId} {
      allow read: if true;  // ⚠️ PUBLIC READ
      allow create, update: if validCustomer();
    }
  }
}
```

**Security Concerns**:
- ❌ Public read access (anyone can fetch all orders)
- ✅ Validation on create/update
- ❌ No authentication check
- ❌ No role-based access

### 1.5 CURRENT ORDER FLOW

```
Customer places order
  ↓
App.tsx: saveFullOrderToServer()
  ↓
orderApi.ts: saveFullOrderToServer()
  ↓
[Firebase] setDoc(orders/{id})
  ↓
[Optional] POST /api/orders/full (fallback)
  ↓
AdminPanel subscribeServerOrders() detects new order
  ↓
Notification.permission === 'granted'
  ↓
new Notification('🍕 New Order Received')
  ↓
⚠️ ONLY if admin has browser tab open
⚠️ NO customer notification
⚠️ NO mobile notification
⚠️ NO notification to manager/staff
```

### 1.6 CURRENT ROLE SYSTEM

**adminConfig.ts**
```typescript
ADMIN_USERS = [
  { role: 'admin', username: 'Admin_Harinos', password: 'Harinos_Admin', outletId: null },
  { role: 'manager', username: 'Manager_Harinos', password: 'Harinos_Manager', outletId: null },
  { role: 'staff', username: 'Staff_Harinos', password: 'Harinos_Staff', outletId: null },
]
```

**Issues**:
- Credentials hardcoded in frontend (MAJOR SECURITY ISSUE)
- No token-based authentication
- No permission matrix
- No endpoint validation
- All users can do everything (no RBAC on backend)

### 1.7 PWA & SERVICE WORKER ANALYSIS

**manifest.json**
- ✅ Properly configured
- ✅ Icons defined (192x192, 512x512)
- ✅ Display mode: standalone
- ✅ Theme colors set

**public/sw.js**
- ✅ Basic install/activate/fetch handlers
- ❌ No cache strategy
- ❌ No push notification handling
- ❌ No background sync
- ❌ Can't receive FCM messages

---

## PART 2: PHASE 1 - NOTIFICATION SYSTEM IMPLEMENTATION

### 2.1 CURRENT PROBLEM STATEMENT

#### What's Broken?
1. **New Orders**: Admin/Manager/Staff only see notifications if browser tab is open
2. **Order Status Updates**: Customer NEVER notified
3. **Mobile/PWA**: No push notifications on mobile devices
4. **Role-Based**: No way to send notifications to specific roles
5. **Offline**: No background sync for notifications

#### Required Behavior

**When NEW ORDER is placed:**
```
1. Admin receives notification ✓
2. Manager (of that outlet) receives notification ✓
3. All Staff (of that outlet) receive notification ✓
4. Customer receives NO notification (per requirements) ✓
```

**When Order Status Changes:**
```
Preparing:
  - Customer receives notification with "Your order is being prepared"
  - Staff sees no notification (already handling)

Ready:
  - Customer receives notification "Your order is ready for pickup/delivery"
  - Delivery staff notified if delivery order

Out For Delivery:
  - Customer receives notification "Driver is on the way"
  - Delivery staff sees status

Done:
  - Customer receives notification "Order completed"
  - Option to leave feedback

Cancelled:
  - Customer receives notification "Order cancelled"
  - Reason provided
```

### 2.2 SOLUTION ARCHITECTURE

#### Technology Choice: Firebase Cloud Messaging (FCM)

**Why FCM?**
- ✅ Already using Firebase Firestore
- ✅ Works with PWA (Web Push)
- ✅ Works with React Native (future mobile app)
- ✅ Free tier generous
- ✅ Server-side targeting by role/topic
- ✅ Offline message queuing
- ✅ Simple SDK integration

**Alternative Considered:**
- ❌ OneSignal - Overkill for current phase
- ❌ Twilio - SMS only, different cost model
- ❌ Firebase Dynamic Links - Not for notifications

#### Implementation Strategy

```
┌─────────────────────────────────────────────────────────┐
│ FRONTEND (React App)                                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 1. Initialize FCM (onMountApp)                          │
│    └─ Request notification permission                  │
│    └─ Get FCM token from Firebase Messaging            │
│    └─ Send token to backend                            │
│                                                         │
│ 2. Subscribe to FCM messages                            │
│    └─ Handle incoming notifications                    │
│    └─ Show in-app toast/alert                          │
│    └─ Update order status in UI                        │
│                                                         │
│ 3. Enhanced Service Worker                             │
│    └─ Handle push messages when app closed            │
│    └─ Show system notifications                        │
│    └─ Handle notification clicks                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────┐
│ BACKEND (Express + Firestore)                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 1. New Endpoints                                        │
│    POST /notifications/token                           │
│      - Store FCM token + user role + outlet            │
│    POST /notifications/send                            │
│      - Send notification via FCM                       │
│    POST /orders/{id}/status (updated)                  │
│      - Trigger notifications when status changes       │
│                                                         │
│ 2. FCM Integration                                      │
│    - Firebase Admin SDK messaging                      │
│    - Topic-based subscriptions (admins, managers, staff)│
│    - Custom data payloads                              │
│                                                         │
│ 3. Notification Rules Engine                           │
│    - Determine who gets notified based on:             │
│      * Order status change                             │
│      * User role                                       │
│      * Outlet assignment                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
                          ↕
┌─────────────────────────────────────────────────────────┐
│ FIRESTORE (Data Storage)                                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ New Collections:                                        │
│ • notification_tokens                                  │
│   ├─ userId (from phone/email)                        │
│   ├─ fcmToken                                         │
│   ├─ role (admin/manager/staff/customer)             │
│   ├─ outletId                                        │
│   ├─ deviceInfo (browser, OS)                        │
│   └─ createdAt / updatedAt                           │
│                                                         │
│ • notification_log (optional - audit trail)           │
│   ├─ orderId                                         │
│   ├─ recipientRole                                   │
│   ├─ eventType (new_order, status_change)            │
│   ├─ sentAt                                          │
│   └─ deliveryStatus                                  │
│                                                         │
│ Updated Collections:                                    │
│ • orders (add field)                                  │
│   └─ notificationsSent: {                            │
│        admin: timestamp,                              │
│        manager: timestamp,                            │
│        staff: timestamp,                              │
│        customer: timestamp                            │
│      }                                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.3 FILES TO CREATE

#### 1. Frontend: `services/fcmService.ts` (NEW)
**Purpose**: FCM token management and initialization

```typescript
// Key functions:
- initializeFCM(): Promise<void>
  Initialize Firebase Messaging, request permission, get token

- getOrCreateFCMToken(): Promise<string>
  Retrieve existing token or get new one

- sendTokenToServer(token: string): Promise<void>
  Send token to backend for storage

- subscribeFCMMessages(): () => void
  Subscribe to incoming messages (app in foreground)

- unsubscribeFCMMessages(): void
  Cleanup listener
```

#### 2. Frontend: `services/notificationService.ts` (ENHANCED)
**Purpose**: Unified notification interface

```typescript
// Existing:
- requestPermission()
- show()
- notifyOfferReleases()
- simulateOrderStatus() ← REMOVE THIS

// New:
- handleIncomingMessage(payload): void
- notifyNewOrder(orderId, items): void
- notifyOrderStatusChange(orderId, status): void
- notifyStaffOrderAssignment(orderId): void
- showInAppNotification(title, body): void
```

#### 3. Frontend: `hooks/useFCMNotifications.ts` (NEW)
**Purpose**: React hook for FCM integration

```typescript
// Usage in App.tsx:
const { fcmToken, isInitialized } = useFCMNotifications()

// Handles:
- FCM initialization on mount
- Incoming message handling
- State updates
- Cleanup
```

#### 4. Backend: `routes/notifications.ts` (NEW)
**Purpose**: Notification endpoints

```typescript
// Endpoints:
POST /notifications/token
  - Register FCM token with user info

POST /notifications/send
  - Send notification to user/role/topic (internal only)

GET /notifications/tokens/:userId
  - Get user's registered tokens

DELETE /notifications/tokens/:tokenId
  - Unregister token
```

#### 5. Backend: `services/fcmService.ts` (NEW)
**Purpose**: Firebase Messaging integration

```typescript
// Key functions:
- sendNotificationToRole(orderId, role, message): Promise<void>
  Send to all admins/managers/staff

- sendNotificationToCustomer(orderId, customerId, message): Promise<void>
  Send to specific customer

- sendNotificationToOutlet(outletId, role, message): Promise<void>
  Send to outlet-specific users

- subscribeTopics(token, role, outletId): Promise<void>
  Subscribe user to topics
```

#### 6. Backend: `types/notification.ts` (NEW)
**Purpose**: Notification TypeScript types

```typescript
- DeviceToken (userId, token, role, outletId, createdAt)
- NotificationPayload (title, body, data, target)
- NotificationEvent (NEW_ORDER, STATUS_CHANGE, etc)
```

#### 7. Frontend: `public/sw-notifications.js` (ENHANCED)
**Purpose**: Service Worker push notification handling

```typescript
// Listen for push events
self.addEventListener('push', (event) => {
  Show notification to user even when app closed
})

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  Open app and navigate to order
})
```

### 2.4 FILES TO MODIFY

#### Frontend

1. **`App.tsx`**
   ```typescript
   // Add:
   - Import useFCMNotifications hook
   - useEffect(() => {
       const { fcmToken } = useFCMNotifications()
       // FCM now initialized
     }, [])
   - Remove notifyOfferReleases test code
   ```

2. **`services/firebaseClient.ts`**
   ```typescript
   // Add:
   - Import { getMessaging } from 'firebase/messaging'
   - Export getMessaging() function
   - Initialize messaging in Firebase app
   ```

3. **`services/orderApi.ts`**
   ```typescript
   // Modify saveFullOrderToServer():
   - After order saved, call notifyNewOrder()
   
   // Modify updateServerOrderStatus():
   - After status updated, call notifyOrderStatusChange()
   - Pass notification to customers/staff based on status
   ```

4. **`services/notification.ts`**
   ```typescript
   // Modify:
   - Rename to notificationService.ts (legacy)
   - Add new functions for order notifications
   - Remove simulateOrderStatus()
   ```

5. **`services/storage.ts`**
   ```typescript
   // Add:
   - saveFCMToken(token: string)
   - getFCMToken(): string | null
   ```

6. **`types.ts`**
   ```typescript
   // Add:
   - FCMTokenData interface
   - NotificationPreference interface
   ```

7. **`public/sw.js`**
   ```typescript
   // Add:
   - Push event listener
   - Notification click handler
   - Message event listener (for in-app FCM messages)
   ```

8. **`index.html`**
   ```html
   <!-- Already has manifest -->
   <!-- Ensure FCM script included in Service Worker registration -->
   ```

#### Backend

1. **`routes/orders.ts`**
   ```typescript
   // Modify PATCH /orders/:orderId/status:
   - Call notifyOrderStatusChange() after update
   - Send appropriate notifications based on new status
   ```

2. **`routes/orders.ts`** (AFTER modification)
   ```typescript
   // Add new endpoints:
   POST /notifications/token - Register device token
   POST /notifications/send - Send notification (admin only)
   ```

3. **`app.ts`**
   ```typescript
   // Add:
   - import notificationsRouter
   - app.use('/notifications', notificationsRouter)
   ```

4. **`types.ts`**
   ```typescript
   // Add notification-related types
   ```

5. **`config.ts`**
   // No changes needed, Firebase already configured

### 2.5 NOTIFICATION FLOW DIAGRAM

```
SCENARIO 1: Customer Places Order
─────────────────────────────────

Frontend:
  1. User clicks "Place Order"
  2. App.tsx calls saveFullOrderToServer(order)
  3. orderApi.ts calls firebaseClient to save
  4. Order document created in Firestore
     └─ Trigger: Cloud Function OR
     └─ Backend: subscribeServerOrders detects new order

Backend (on new order detection):
  1. Fetch order details
  2. Get Admin FCM tokens from notification_tokens collection
  3. Get Manager FCM tokens (for that outlet)
  4. Get Staff FCM tokens (for that outlet)
  5. Send FCM notifications:
     ├─ To Admins: "🍕 New Order #12345 - Rs 499"
     ├─ To Managers: "New Order #12345 from Outlet-1"
     └─ To Staff: "Incoming Order: 2x Margherita, 1x Tikka Burger"

Frontend (Admins/Managers/Staff):
  1. Browser receives FCM push notification
  2. If app is open:
     ├─ FCM message handler shows toast
     └─ Order list refreshes
  3. If app is closed:
     ├─ Service Worker receives push
     ├─ Shows system notification
     └─ User clicks → App opens to order


SCENARIO 2: Staff Changes Order Status to "Ready"
──────────────────────────────────────────────────

Frontend (Staff Admin Panel):
  1. Staff clicks "Ready" button on order
  2. App calls updateServerOrderStatus(orderId, 'ready')

Backend:
  1. Update order status in Firestore
  2. Fire notification logic:
     ├─ Check if delivery order
     ├─ Fetch customer FCM token
     ├─ Send: "Your order is ready! 🎉"
  3. Also notify staff if delivery assignment needed

Frontend (Customer):
  1. Customer receives notification
  2. If app open: Shows toast + updates order status
  3. If app closed: Shows system notification
  4. Customer clicks notification → Opens app to see order


SCENARIO 3: Delivery Assigned & Status Changes to "Out For Delivery"
────────────────────────────────────────────────────────────────────

Backend:
  1. Status updated to out_for_delivery
  2. Notifications sent to:
     ├─ Customer: "Driver on the way! 📍 [ETA]"
     └─ Delivery Staff: Order assigned to route

Frontend:
  Similar to Scenario 2
```

### 2.6 DATABASE SCHEMA ADDITIONS

#### New Firestore Collection: `notification_tokens`

```json
{
  "notification_tokens": {
    "{documentId}": {
      "userId": "customer_phone_or_admin_id",
      "fcmToken": "cPDfSkJqGMQSXqLvtG...",
      "role": "customer|admin|manager|staff",
      "outletId": "outlet-1",
      "phoneNumber": "+917818958571",
      "email": "customer@example.com",
      "deviceType": "browser|mobile",
      "deviceInfo": {
        "userAgent": "Mozilla/5.0...",
        "platform": "Web|iOS|Android"
      },
      "isActive": true,
      "createdAt": "2026-06-14T10:30:00Z",
      "updatedAt": "2026-06-14T10:30:00Z",
      "lastUsedAt": "2026-06-14T15:45:00Z"
    }
  }
}
```

#### Updated: `orders` Collection (add field)

```json
{
  "orders": {
    "ORDER_ID": {
      // ... existing fields ...
      "notificationsSent": {
        "new": {
          "admin": "2026-06-14T10:30:05Z",
          "manager": "2026-06-14T10:30:05Z",
          "staff": ["2026-06-14T10:30:06Z", "2026-06-14T10:30:07Z"]
        },
        "preparing": {
          "staff": "2026-06-14T10:35:00Z",
          "customer": null
        },
        "ready": {
          "customer": "2026-06-14T10:45:00Z"
        },
        "out_for_delivery": {
          "customer": "2026-06-14T11:00:00Z",
          "deliveryStaff": "2026-06-14T11:00:00Z"
        },
        "done": {
          "customer": "2026-06-14T11:30:00Z"
        }
      }
    }
  }
}
```

#### New Firestore Collection: `notification_log` (Optional - Audit Trail)

```json
{
  "notification_log": {
    "{documentId}": {
      "orderId": "ORDER_ID",
      "eventType": "NEW_ORDER|PREPARING|READY|OUT_FOR_DELIVERY|DONE|CANCELLED",
      "recipients": [
        {
          "role": "admin",
          "fcmToken": "token...",
          "status": "sent|failed|delivered",
          "sentAt": "2026-06-14T10:30:05Z",
          "error": null
        }
      ],
      "message": {
        "title": "🍕 New Order",
        "body": "Order #12345"
      }
    }
  }
}
```

### 2.7 NEW BACKEND ENDPOINTS

#### POST `/api/notifications/token`

**Purpose**: Register/update FCM token for a user

**Request Body**:
```json
{
  "fcmToken": "cPDfSkJqGMQSXqLvtG...",
  "role": "customer",
  "userId": "+917818958571",
  "outletId": "outlet-1",
  "deviceInfo": {
    "userAgent": "Mozilla/5.0...",
    "platform": "Web"
  }
}
```

**Response**:
```json
{
  "success": true,
  "tokenId": "token_doc_id",
  "message": "Token registered successfully"
}
```

**Security**: 
- ✅ Role validated against user
- ✅ Rate limited per IP
- ✅ Token expiration (30 days)

---

#### POST `/api/notifications/send` (Admin Only)

**Purpose**: Send notification manually (for emergencies, promos)

**Request Body**:
```json
{
  "targetRole": "admin|manager|staff|customer",
  "outletId": "outlet-1",
  "title": "Notification Title",
  "body": "Notification body",
  "orderId": "optional_order_id"
}
```

**Response**:
```json
{
  "success": true,
  "sent": 15,
  "failed": 1
}
```

---

### 2.8 SECURITY CONSIDERATIONS

#### Authentication for Notification Endpoints

**Current Issue**: No auth middleware

**Solution**:
```typescript
// Add middleware: requireAuth()
- Verify Firebase ID token
- Extract role from token
- Validate role permissions

// Only admins can POST /notifications/send
// All authenticated users can POST /notifications/token
// Only self can GET /notifications/tokens
```

#### Firestore Rules Update

```firestore
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    
    // Notification tokens - users can read/write own
    match /notification_tokens/{tokenId} {
      allow read: if request.auth != null;
      allow create, update: if request.auth != null 
        && request.resource.data.userId == request.auth.uid;
      allow delete: if request.auth != null 
        && resource.data.userId == request.auth.uid;
    }
    
    // Notification log - only admins read
    match /notification_log/{logId} {
      allow read: if isAdmin();
      allow create, update: if false; // Backend only
    }
    
    // Orders - existing rules + notification tracking
    match /orders/{orderId} {
      allow read: if true;
      allow create, update: if validOrder();
    }
  }
}

function isAdmin() {
  return request.auth != null 
    && request.auth.token.role == 'admin';
}

function validOrder() {
  return request.resource.data.id is string
    && request.resource.data.items is list
    && request.resource.data.total is number;
}
```

#### Environment Variables Required

```env
# Already have these:
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID

# Already have these (backend):
FIREBASE_SERVICE_ACCOUNT_BASE64
FIREBASE_PROJECT_ID

# No new variables needed!
# FCM enabled by default in Firebase project
```

### 2.9 IMPLEMENTATION CHECKLIST

#### Phase 1A: Frontend Foundation (Week 1)

- [ ] Create `services/fcmService.ts`
- [ ] Create `hooks/useFCMNotifications.ts`
- [ ] Update `services/firebaseClient.ts` to export messaging
- [ ] Update `services/storage.ts` with FCM token storage
- [ ] Update `types.ts` with notification types
- [ ] Update `App.tsx` to use useFCMNotifications hook
- [ ] Enhance `public/sw.js` for push handling
- [ ] Test FCM token generation in dev environment

#### Phase 1B: Backend Integration (Week 1-2)

- [ ] Create `services/fcmService.ts` (backend)
- [ ] Create `routes/notifications.ts` endpoints
- [ ] Update `app.ts` to include notifications router
- [ ] Update `routes/orders.ts` - PATCH status endpoint
- [ ] Add notification triggers on order creation
- [ ] Add notification triggers on status change
- [ ] Test endpoints with Postman
- [ ] Add error handling and logging

#### Phase 1C: Admin Panel Updates (Week 2)

- [ ] Update `AdminPanel.tsx` to handle notifications
- [ ] Show notification status in order list
- [ ] Add manual notification send button
- [ ] Display notification history
- [ ] Add notification preferences UI

#### Phase 1D: Testing & Deployment (Week 2)

- [ ] Unit tests for notification logic
- [ ] Integration tests with Firebase
- [ ] E2E testing: order → notification → UI
- [ ] Mobile/PWA testing
- [ ] Offline notification queuing
- [ ] Deploy to Vercel
- [ ] Monitor Firebase Messaging console

---

## PART 3: PHASE 1 FILE-BY-FILE IMPLEMENTATION GUIDE

### 3.1 NEW FILE: `frontend/services/fcmService.ts`

[DETAILED IMPLEMENTATION PROVIDED NEXT]

### 3.2 NEW FILE: `frontend/hooks/useFCMNotifications.ts`

[DETAILED IMPLEMENTATION PROVIDED NEXT]

### 3.3 MODIFIED FILE: `frontend/services/firebaseClient.ts`

[CHANGES SPECIFIED NEXT]

### 3.4 MODIFIED FILE: `frontend/App.tsx`

[SPECIFIC LINE CHANGES PROVIDED]

### 3.5 NEW FILE: `backend/services/fcmService.ts`

[DETAILED IMPLEMENTATION PROVIDED]

### 3.6 NEW FILE: `backend/routes/notifications.ts`

[DETAILED IMPLEMENTATION PROVIDED]

---

## PART 4: IMPLEMENTATION RISKS & MITIGATION

### 4.1 Identified Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| FCM token expiration | Notifications fail to deliver | Medium | Refresh tokens on app open, store expiry time |
| Permission denied by user | No notifications received | High | Graceful degradation, retry permission request |
| Firestore quota exceeded | Service outage | Low | Monitor quota, set alerts |
| Backend rate limiting | Notification delivery delayed | Medium | Implement queuing, batch send |
| Token storage breach | User privacy | Low | Use Firestore encryption, HTTPS only |
| Customer notification spam | Negative UX | Medium | Max 1 notification per status change |

### 4.2 Rollback Plan

If Phase 1 causes issues:
1. Disable FCM token registration endpoint
2. Keep existing browser notification as fallback
3. Revert notification triggers in orderApi.ts
4. Notification service still works for offers

---

## PART 5: TESTING STRATEGY

### 5.1 Unit Tests

**Test fcmService.ts**:
```typescript
describe('fcmService', () => {
  test('initializeFCM requests permission', async () => {...})
  test('getOrCreateFCMToken returns valid token', async () => {...})
  test('sendTokenToServer POSTs to correct endpoint', async () => {...})
})
```

**Test notificationService.ts**:
```typescript
describe('notificationService', () => {
  test('handleIncomingMessage shows toast', () => {...})
  test('notifyOrderStatusChange sends correct payload', () => {...})
})
```

### 5.2 Integration Tests

**Test FCM flow**:
```typescript
describe('FCM Integration', () => {
  test('Token registered → Notification sent → User receives', async () => {
    // 1. Create test user + get FCM token
    // 2. Send test notification via backend
    // 3. Assert notification received in app
  })
})
```

### 5.3 E2E Tests

**Test complete order flow**:
```typescript
describe('Order → Notification E2E', () => {
  test('Customer orders → Admin notified → Status updated → Customer notified', async () => {
    // 1. Place order as customer
    // 2. Wait for admin notification
    // 3. Admin updates status
    // 4. Verify customer receives notification
  })
})
```

### 5.4 Manual Testing Checklist

- [ ] Browser notifications work when app is open
- [ ] Browser notifications work when app is closed (tab background)
- [ ] Push notifications work on PWA (on Android Chrome)
- [ ] Click notification opens correct order
- [ ] Multiple FCM tokens per user handled correctly
- [ ] Token refresh works on app reopen
- [ ] Offline notifications queued and sent when online
- [ ] Admin can manually send notifications
- [ ] Notification history visible in admin panel

---

## PART 6: MIGRATION PLAN

### 6.1 Deployment Timeline

```
Week 1 (Jun 14-20):
  Day 1-2: Create FCM infrastructure files
  Day 3-4: Implement frontend FCM integration
  Day 5: Backend notification service setup
  Day 6-7: Testing in staging

Week 2 (Jun 21-27):
  Day 1-2: Integration testing
  Day 3-4: Admin panel notification UI
  Day 5: Final E2E testing
  Day 6-7: Production deployment
```

### 6.2 Rollout Strategy

**Stage 1: Internal Testing**
- Deploy to staging environment
- Test with internal team
- Monitor Firebase console

**Stage 2: Beta Users**
- Deploy to 50% of production
- Monitor error rates
- Collect feedback

**Stage 3: Full Rollout**
- Deploy to 100%
- Enable notifications for all roles
- Monitor delivery rates

### 6.3 Rollback Procedure

If issues occur:
1. Disable notification endpoints in Load Balancer
2. Revert orderApi.ts to previous version
3. Keep frontend changes (backwards compatible)
4. Notify users via in-app banner

---

## PART 7: PERFORMANCE CONSIDERATIONS

### 7.1 FCM Token Management

- Each device = 1 FCM token
- Each user role = different notification topics
- Tokens expire after 90 days (auto-refresh)
- Batch send notifications (max 500/second)

### 7.2 Firebase Firestore Impact

- New collection: `notification_tokens` (~100 KB per 10k users)
- New field on orders: `notificationsSent` (~500 bytes per order)
- Query impact: Minimal (indexed fields)
- Cost: ~$0.06 per 100k reads/writes

### 7.3 Bandwidth

- FCM message size: ~1-4 KB
- Per notification: ~2 requests (send + delivery tracking)
- Expected load: ~100-200 notifications/hour during peak

### 7.4 Latency SLA

- Order → Notification sent: < 2 seconds (target)
- FCM delivery: < 5 seconds (Firebase SLA: < 30 sec)
- Total user experience: < 10 seconds

---

## CONCLUSION

Phase 1 implementation requires:
- **3-4 backend files** (new + modifications)
- **3-4 frontend files** (new + modifications)
- **~500-600 lines of code** total
- **1-2 weeks** development time
- **No breaking changes** to existing code

Success metrics:
✅ Admin notified within 2 seconds of new order
✅ Customer notified when status changes
✅ Push notifications work on mobile/PWA
✅ 99%+ notification delivery rate
✅ Notification latency < 10 seconds

**Ready to proceed with implementation?** 

Next phase will detail exact code for each file.

---

**Document Version**: 1.0  
**Last Updated**: June 14, 2026  
**Next Review**: After Phase 1 implementation
