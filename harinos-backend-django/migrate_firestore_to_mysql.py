import os
import sys
import json
import base64
from datetime import datetime
from django.utils.dateparse import parse_datetime
from django.utils import timezone

# 1. Initialize Django context
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'harinos_backend.settings')

import django
django.setup()

# Import Django models
from api.models import (
    MenuItem, Outlet, Offer, Customer, Order,
    WalletTransaction, Setting, BlockedCustomer,
    StaffUser, NotificationToken
)

# 2. Initialize Firebase Admin SDK
import firebase_admin
from firebase_admin import credentials, firestore

def get_firestore_client():
    encoded = os.getenv('FIREBASE_SERVICE_ACCOUNT_BASE64')
    raw = os.getenv('FIREBASE_SERVICE_ACCOUNT_JSON')
    project_id = os.getenv('FIREBASE_PROJECT_ID', 'harinos-12902')

    if encoded:
        cred_dict = json.loads(base64.b64decode(encoded).decode('utf-8'))
        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred, {'projectId': project_id})
    elif raw:
        cred_dict = json.loads(raw)
        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred, {'projectId': project_id})
    else:
        raise ValueError("Missing FIREBASE_SERVICE_ACCOUNT_BASE64 or FIREBASE_SERVICE_ACCOUNT_JSON environment variables.")
    
    return firestore.client()

def parse_iso_datetime(dt_str):
    if not dt_str:
        return timezone.now()
    try:
        dt = parse_datetime(dt_str)
        return dt if dt else timezone.now()
    except Exception:
        return timezone.now()

def main():
    print("--- Starting Harino's Pizza Data Migration from Firestore to MySQL ---")
    
    try:
        db = get_firestore_client()
    except Exception as e:
        print(f"Error connecting to Firebase: {e}")
        print("Please ensure your FIREBASE_SERVICE_ACCOUNT_BASE64 env variable is set.")
        sys.exit(1)

    # 1. Migrate Settings
    print("\n1. Migrating settings...")
    Setting.objects.all().delete()
    settings_ref = db.collection('settings')
    firestore_settings_count = 0
    for doc in settings_ref.stream():
        firestore_settings_count += 1
        payload = doc.to_dict()
        Setting.objects.create(id=doc.id, payload=payload)
    print(f"   Settings: Firestore ({firestore_settings_count}) -> MySQL ({Setting.objects.count()})")

    # 2. Migrate Menu Items
    print("\n2. Migrating menu items...")
    MenuItem.objects.all().delete()
    menu_ref = db.collection('menu_items')
    firestore_menu_count = 0
    for doc in menu_ref.stream():
        firestore_menu_count += 1
        payload = doc.to_dict()
        MenuItem.objects.create(
            id=doc.id,
            payload=payload,
            available=payload.get('available', True)
        )
    print(f"   Menu Items: Firestore ({firestore_menu_count}) -> MySQL ({MenuItem.objects.count()})")

    # 3. Migrate Outlets
    print("\n3. Migrating outlets...")
    Outlet.objects.all().delete()
    outlets_ref = db.collection('outlets')
    firestore_outlets_count = 0
    for doc in outlets_ref.stream():
        firestore_outlets_count += 1
        payload = doc.to_dict()
        Outlet.objects.create(
            id=doc.id,
            payload=payload,
            enabled=payload.get('enabled', True)
        )
    print(f"   Outlets: Firestore ({firestore_outlets_count}) -> MySQL ({Outlet.objects.count()})")

    # 4. Migrate Offers
    print("\n4. Migrating offers...")
    Offer.objects.all().delete()
    offers_ref = db.collection('offers')
    firestore_offers_count = 0
    for doc in offers_ref.stream():
        firestore_offers_count += 1
        payload = doc.to_dict()
        Offer.objects.create(
            id=doc.id,
            payload=payload,
            enabled=payload.get('enabled', True)
        )
    print(f"   Offers: Firestore ({firestore_offers_count}) -> MySQL ({Offer.objects.count()})")

    # 5. Migrate Blocked Customers
    print("\n5. Migrating blocked customers list...")
    BlockedCustomer.objects.all().delete()
    blocked_ref = db.collection('blocked_customers')
    firestore_blocked_count = 0
    for doc in blocked_ref.stream():
        firestore_blocked_count += 1
        payload = doc.to_dict()
        BlockedCustomer.objects.create(
            phone=doc.id,
            blocked_at=parse_iso_datetime(payload.get('blockedAt')),
            customer_id=payload.get('customerId', ''),
            name=payload.get('name', '')
        )
    print(f"   Blocked Customers: Firestore ({firestore_blocked_count}) -> MySQL ({BlockedCustomer.objects.count()})")

    # 6. Migrate Staff Users
    print("\n6. Migrating staff users...")
    StaffUser.objects.all().delete()
    users_ref = db.collection('users')
    firestore_users_count = 0
    for doc in users_ref.stream():
        firestore_users_count += 1
        payload = doc.to_dict()
        StaffUser.objects.create(
            username=doc.id,
            payload=payload,
            role=payload.get('role', 'staff')
        )
    print(f"   Staff Users: Firestore ({firestore_users_count}) -> MySQL ({StaffUser.objects.count()})")

    # 7. Migrate Notification Tokens
    print("\n7. Migrating notification tokens...")
    NotificationToken.objects.all().delete()
    tokens_ref = db.collection('notification_tokens')
    firestore_tokens_count = 0
    for doc in tokens_ref.stream():
        firestore_tokens_count += 1
        payload = doc.to_dict()
        created_at = parse_iso_datetime(payload.get('createdAt'))
        updated_at = parse_iso_datetime(payload.get('updatedAt'))
        last_used = parse_iso_datetime(payload.get('lastUsedAt'))
        NotificationToken.objects.create(
            id=doc.id,
            user_id=payload.get('userId', ''),
            fcm_token=payload.get('fcmToken', ''),
            role=payload.get('role', 'customer'),
            outlet_id=payload.get('outletId'),
            device_type=payload.get('deviceType', 'browser'),
            device_info=payload.get('deviceInfo', {}),
            is_active=payload.get('isActive', True),
            created_at=created_at,
            updated_at=updated_at,
            last_used_at=last_used
        )
    print(f"   Notification Tokens: Firestore ({firestore_tokens_count}) -> MySQL ({NotificationToken.objects.count()})")

    # 8. Migrate Wallet Transactions
    print("\n8. Migrating wallet transactions...")
    WalletTransaction.objects.all().delete()
    tx_ref = db.collection('wallet_transactions')
    firestore_tx_count = 0
    for doc in tx_ref.stream():
        firestore_tx_count += 1
        payload = doc.to_dict()
        WalletTransaction.objects.create(
            id=doc.id,
            payload=payload,
            created_at=parse_iso_datetime(payload.get('createdAt'))
        )
    print(f"   Wallet Transactions: Firestore ({firestore_tx_count}) -> MySQL ({WalletTransaction.objects.count()})")

    # 9. Migrate Customers
    print("\n9. Migrating customers profiles...")
    Customer.objects.all().delete()
    cust_ref = db.collection('customers')
    firestore_cust_count = 0
    for doc in cust_ref.stream():
        firestore_cust_count += 1
        payload = doc.to_dict()
        Customer.objects.create(
            id=doc.id,
            payload=payload,
            phone=payload.get('phone', ''),
            email=payload.get('email'),
            verified=payload.get('verified', False),
            created_at=parse_iso_datetime(payload.get('createdAt'))
        )
    print(f"   Customers: Firestore ({firestore_cust_count}) -> MySQL ({Customer.objects.count()})")

    # 10. Migrate Orders
    print("\n10. Migrating orders...")
    Order.objects.all().delete()
    orders_ref = db.collection('orders')
    firestore_orders_count = 0
    for doc in orders_ref.stream():
        firestore_orders_count += 1
        payload = doc.to_dict()
        received_at = parse_iso_datetime(payload.get('receivedAt') or payload.get('date'))
        Order.objects.create(
            id=doc.id,
            payload=payload,
            status=payload.get('status', 'new'),
            received_at=received_at,
            outlet_id=payload.get('outletId'),
            customer_phone=payload.get('customerPhone'),
            total=float(payload.get('total', 0.0))
        )
    print(f"    Orders: Firestore ({firestore_orders_count}) -> MySQL ({Order.objects.count()})")

    print("\n--- MIGRATION COMPLETE! ---")
    print(f"Total entries loaded in local MySQL on SSD: {MenuItem.objects.count() + Outlet.objects.count() + Offer.objects.count() + Customer.objects.count() + Order.objects.count() + WalletTransaction.objects.count()}")

if __name__ == '__main__':
    main()
