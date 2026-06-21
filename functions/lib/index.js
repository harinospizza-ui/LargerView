"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onSecurityLogCreated = exports.onStoreConfigChanged = exports.onOrderDeleted = exports.onOrderUpdated = exports.onOrderCreated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();
/**
 * Helper to dispatch FCM notifications to target tokens
 * Automatically cleans up invalid/expired tokens
 */
async function sendNotificationToTokens(tokens, title, body, data = {}) {
    if (tokens.length === 0)
        return { sent: 0, failed: 0, removed: 0 };
    // Remove duplicates
    const uniqueTokensMap = new Map();
    tokens.forEach(t => uniqueTokensMap.set(t.fcmToken, t));
    const uniqueTokensList = Array.from(uniqueTokensMap.values());
    let sent = 0;
    let failed = 0;
    let removed = 0;
    const badge = "/icon-192.png";
    const icon = "/icon-192.png";
    const promises = uniqueTokensList.map(async (tokenData) => {
        const message = {
            token: tokenData.fcmToken,
            notification: {
                title,
                body,
            },
            data: {
                ...data,
                badge,
                icon,
                click_action: "/",
            },
            android: {
                notification: {
                    sound: "default",
                    clickAction: "FLUTTER_NOTIFICATION_CLICK",
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: "default",
                    },
                },
            },
        };
        try {
            await messaging.send(message);
            sent++;
            // Log notification success in daily stats
            await logNotificationStats(true);
        }
        catch (error) {
            failed++;
            await logNotificationStats(false);
            const errorMsg = error.message || "";
            const isUnregistered = error.code === "messaging/registration-token-not-registered" ||
                error.code === "messaging/invalid-registration-token" ||
                errorMsg.includes("unregistered") ||
                errorMsg.includes("invalid-registration-token");
            if (isUnregistered) {
                try {
                    // Delete token from database
                    await db.collection("notification_tokens").doc(tokenData.id).delete();
                    removed++;
                    await logTokenRemoval();
                    console.log(`[FCM Clean] Cleaned up invalid token: ${tokenData.id}`);
                }
                catch (dbErr) {
                    console.warn(`[FCM Clean] Failed to remove invalid token: ${tokenData.id}`, dbErr);
                }
            }
            else {
                console.warn(`[FCM send failed] Token: ${tokenData.id}, Error:`, error);
            }
        }
    });
    await Promise.all(promises);
    return { sent, failed, removed };
}
/**
 * Statistics Logging Helpers
 */
async function logNotificationStats(success) {
    const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const statsRef = db.collection("notification_stats").doc(todayStr);
    try {
        await db.runTransaction(async (transaction) => {
            const snap = await transaction.get(statsRef);
            const data = snap.exists ? snap.data() || {} : {};
            const sentCount = data.sent || 0;
            const failedCount = data.failed || 0;
            transaction.set(statsRef, {
                sent: success ? sentCount + 1 : sentCount,
                failed: success ? failedCount : failedCount + 1,
                updatedAt: new Date().toISOString()
            }, { merge: true });
        });
    }
    catch (err) {
        console.error("Failed to log notification stats:", err);
    }
}
async function logTokenRemoval() {
    const todayStr = new Date().toISOString().slice(0, 10);
    const statsRef = db.collection("notification_stats").doc(todayStr);
    try {
        await statsRef.set({
            removedTokens: admin.firestore.FieldValue.increment(1)
        }, { merge: true });
    }
    catch (err) {
        console.error("Failed to log token removal stats:", err);
    }
}
/**
 * 1. Order Created Trigger
 * Notifies Admins, Managers, and Staff of new orders
 */
exports.onOrderCreated = (0, firestore_1.onDocumentCreated)("orders/{orderId}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const order = snap.data();
    const orderId = event.params.orderId;
    const title = "🍕 New Order Received";
    const body = `Order #${orderId.slice(-5)} (${order.orderType || 'takeaway'}) is waiting to be prepared.`;
    // Fetch token subscribers
    const tokensSnap = await db.collection("notification_tokens")
        .where("isActive", "==", true)
        .get();
    const allTokens = tokensSnap.docs.map(d => d.data());
    // Filter based on roles and outletId
    const targets = allTokens.filter(token => {
        if (token.role === "admin")
            return true;
        if (token.role === "manager" || token.role === "staff") {
            // If order specifies outletId, check matching outlet
            if (order.outletId && token.outletId) {
                return token.outletId === order.outletId;
            }
            return true;
        }
        return false;
    });
    await sendNotificationToTokens(targets, title, body, {
        orderId,
        eventType: "NEW_ORDER",
        outletId: order.outletId || "",
        orderType: order.orderType || "takeaway"
    });
});
/**
 * 2. Order Updated (Status / Cancellation) Trigger
 * Notifies customers of status changes, and notifies staff of cancellations
 */
exports.onOrderUpdated = (0, firestore_1.onDocumentUpdated)("orders/{orderId}", async (event) => {
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    if (!beforeSnap || !afterSnap)
        return;
    const before = beforeSnap.data();
    const after = afterSnap.data();
    const orderId = event.params.orderId;
    const previousStatus = before.status || "new";
    const currentStatus = after.status || "new";
    // Check if status changed
    if (previousStatus === currentStatus)
        return;
    // 2a. Notify Customer
    if (after.customerId) {
        const customerTokensSnap = await db.collection("notification_tokens")
            .where("userId", "==", after.customerId)
            .where("role", "==", "customer")
            .where("isActive", "==", true)
            .get();
        const customerTokens = customerTokensSnap.docs.map(d => d.data());
        let title = "Order Update";
        let body = `Your order status changed to ${currentStatus}.`;
        if (currentStatus === "preparing") {
            title = "Order Confirmed";
            body = `Your order #${orderId.slice(-5)} is now being prepared.`;
        }
        else if (currentStatus === "ready") {
            title = "✨ Order Ready";
            body = `Your order #${orderId.slice(-5)} is ready for pickup.`;
        }
        else if (currentStatus === "out_for_delivery") {
            title = "📍 Out for Delivery";
            body = `Your order #${orderId.slice(-5)} is on the way.`;
        }
        else if (currentStatus === "done") {
            title = "✅ Order Completed";
            body = `Thank you! Your order #${orderId.slice(-5)} has been completed.`;
        }
        else if (currentStatus === "cancelled") {
            title = "❌ Order Cancelled";
            body = `Your order #${orderId.slice(-5)} was cancelled: ${after.cancellationReason || 'No reason specified'}`;
        }
        await sendNotificationToTokens(customerTokens, title, body, {
            orderId,
            eventType: currentStatus.toUpperCase()
        });
    }
    // 2b. If cancelled, notify Staff, Managers, and Admins
    if (currentStatus === "cancelled") {
        const title = "⚠️ Order Cancelled";
        const body = `Order #${orderId.slice(-5)} has been cancelled. Reason: ${after.cancellationReason || 'N/A'}`;
        const tokensSnap = await db.collection("notification_tokens")
            .where("isActive", "==", true)
            .get();
        const allTokens = tokensSnap.docs.map(d => d.data());
        const targets = allTokens.filter(token => {
            if (token.role === "admin")
                return true;
            if (token.role === "manager" || token.role === "staff") {
                if (after.outletId && token.outletId) {
                    return token.outletId === after.outletId;
                }
                return true;
            }
            return false;
        });
        await sendNotificationToTokens(targets, title, body, {
            orderId,
            eventType: "ORDER_CANCELLED",
            outletId: after.outletId || "",
            reason: after.cancellationReason || ""
        });
    }
});
/**
 * 3. Order Deleted Trigger
 * Notifies Admins of order deletions (soft or hard deletes)
 */
exports.onOrderDeleted = (0, firestore_1.onDocumentDeleted)("orders/{orderId}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const order = snap.data();
    const orderId = event.params.orderId;
    const title = "🗑️ Order Record Deleted";
    const body = `Order #${orderId.slice(-5)} was permanently deleted from the database.`;
    // Fetch admin tokens only
    const tokensSnap = await db.collection("notification_tokens")
        .where("role", "==", "admin")
        .where("isActive", "==", true)
        .get();
    const adminTokens = tokensSnap.docs.map(d => d.data());
    await sendNotificationToTokens(adminTokens, title, body, {
        orderId,
        eventType: "ORDER_DELETED",
        total: String(order.total || 0)
    });
});
/**
 * 4. Store Status Changes Trigger
 * Notifies Managers and Admins when store configuration or status updates
 */
exports.onStoreConfigChanged = (0, firestore_1.onDocumentUpdated)("settings/{settingId}", async (event) => {
    if (event.params.settingId !== "app")
        return;
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    if (!beforeSnap || !afterSnap)
        return;
    const before = beforeSnap.data();
    const after = afterSnap.data();
    // Check if store open/closed configuration changed
    if (before.storeOpen === after.storeOpen)
        return;
    const title = "🏪 Store Status Changed";
    const body = `Harino's Pizza is now ${after.storeOpen ? 'OPEN' : 'CLOSED'} for orders.`;
    const tokensSnap = await db.collection("notification_tokens")
        .where("isActive", "==", true)
        .get();
    const allTokens = tokensSnap.docs.map(d => d.data());
    // Notify Admins and Managers
    const targets = allTokens.filter(token => token.role === "admin" || token.role === "manager");
    await sendNotificationToTokens(targets, title, body, {
        eventType: "STORE_STATUS_CHANGED",
        storeOpen: String(after.storeOpen)
    });
});
/**
 * 5. System Alerts / Security Events Trigger
 * Notifies Admins of critical events (Quota warnings, forced session invalidations, security blocks)
 */
exports.onSecurityLogCreated = (0, firestore_1.onDocumentCreated)("security_logs/{logId}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const log = snap.data();
    // Filter for critical levels/actions only
    const isCritical = log.action?.includes("QUOTA") ||
        log.action?.includes("LIMIT") ||
        log.action?.includes("FORCE") ||
        log.action?.includes("SECURITY") ||
        log.action?.includes("FAIL");
    if (!isCritical)
        return;
    const title = "🚨 System Security Alert";
    const body = `[${log.action || 'ALERT'}] ${log.details || 'A critical system event occurred.'}`;
    const tokensSnap = await db.collection("notification_tokens")
        .where("role", "==", "admin")
        .where("isActive", "==", true)
        .get();
    const adminTokens = tokensSnap.docs.map(d => d.data());
    await sendNotificationToTokens(adminTokens, title, body, {
        eventType: "SYSTEM_ALERT",
        logId: event.params.logId
    });
});
//# sourceMappingURL=index.js.map