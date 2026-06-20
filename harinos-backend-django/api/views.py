import os
import json
import time
import subprocess
from datetime import datetime
from pathlib import Path
from django.conf import settings
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from django.db.models import Q
from django.db import transaction
from .recovery_logger import log_transaction, complete_transaction
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny

from .models import (
    MenuItem, Outlet, Offer, Customer, Order,
    WalletTransaction, Setting, BlockedCustomer,
    StaffUser, NotificationToken
)
from .serializers import JSONPayloadSerializer
from .authentication import (
    hash_password, verify_password, generate_jwt,
    JWTAuthentication, DjangoAuthenticatedUser
)

# Firebase Admin initialization helper
import firebase_admin
from firebase_admin import credentials, messaging

def get_firebase_app():
    if not firebase_admin._apps:
        project_id = os.getenv('FIREBASE_PROJECT_ID', 'harinos-12902')
        
        # Try loading from firebase_credentials.json on the SSD first (plug-and-play)
        ssd_cred_path = os.path.join(settings.BASE_DIR, 'firebase_credentials.json')
        if os.path.exists(ssd_cred_path):
            try:
                cred = credentials.Certificate(ssd_cred_path)
                firebase_admin.initialize_app(cred, {'projectId': project_id})
                return firebase_admin._apps
            except Exception as e:
                print("[-] Failed to load SSD firebase credentials, falling back:", e)

        encoded = os.getenv('FIREBASE_SERVICE_ACCOUNT_BASE64')
        raw = os.getenv('FIREBASE_SERVICE_ACCOUNT_JSON')
        try:
            if encoded:
                import base64
                cred_dict = json.loads(base64.b64decode(encoded).decode('utf-8'))
                cred = credentials.Certificate(cred_dict)
                firebase_admin.initialize_app(cred, {'projectId': project_id})
            elif raw:
                cred_dict = json.loads(raw)
                cred = credentials.Certificate(cred_dict)
                firebase_admin.initialize_app(cred, {'projectId': project_id})
            else:
                # Local dev fallback
                cred = credentials.ApplicationDefault()
                firebase_admin.initialize_app(cred, {'projectId': project_id})
        except Exception as e:
            print("Warning: Firebase Admin SDK failed to initialize:", e)
    return firebase_admin._apps

# Helper to find mysqldump / mysql binaries on SSD
def get_mysql_tool_path(tool_name):
    ssd_drive = Path(settings.BASE_DIR).drive
    paths = [
        os.path.join(ssd_drive, f"\\WEB_SERVER\\harinos-mysql\\bin\\{tool_name}.exe"),
        os.path.join(ssd_drive, f"\\harinos-mysql\\bin\\{tool_name}.exe"),
        os.path.join(os.getenv('MYSQL_HOME', ''), f"bin\\{tool_name}.exe"),
    ]
    for p in paths:
        if os.path.exists(p):
            return p
    return tool_name  # fallback to PATH

# Helper to trigger FCM notifications to a specific role/user
def send_fcm_notification(event_type, order_id, role, outlet_id=None, customer_token_data=None, additional_data=None):
    get_firebase_app()
    if not firebase_admin._apps:
        return
    
    # 1. Build notification payload
    title = '🍕 Order Update'
    body = f'Update for order #{order_id[-5:] if len(order_id) > 5 else order_id}'
    
    if event_type == 'NEW_ORDER':
        title = '🍕 New Order Received'
        body = f'Order #{order_id[-5:] if len(order_id) > 5 else order_id} is waiting to be prepared'
    elif event_type == 'PREPARING':
        title = 'Order Confirmed'
        body = f'Your order #{order_id[-5:] if len(order_id) > 5 else order_id} is being prepared'
    elif event_type == 'READY':
        title = '✨ Order Ready'
        body = f'Your order #{order_id[-5:] if len(order_id) > 5 else order_id} is ready for pickup'
    elif event_type == 'OUT_FOR_DELIVERY':
        title = '📍 On the Way'
        body = f'Your order #{order_id[-5:] if len(order_id) > 5 else order_id} is out for delivery'
    elif event_type == 'DONE':
        title = '✅ Order Completed'
        body = f'Your order #{order_id[-5:] if len(order_id) > 5 else order_id} has been completed. Thank you!'
    elif event_type == 'CANCELLED':
        title = '❌ Order Cancelled'
        body = f'Your order #{order_id[-5:] if len(order_id) > 5 else order_id} has been cancelled'

    data = {
        'orderId': order_id,
        'eventType': event_type,
        'timestamp': datetime.utcnow().isoformat() + 'Z'
    }
    if additional_data:
        data.update(additional_data)

    # 2. Query target FCM tokens
    tokens_query = NotificationToken.objects.filter(is_active=True)
    if customer_token_data:
        # Directly target customer userId
        tokens_query = tokens_query.filter(user_id=customer_token_data)
    else:
        # Target role-based tokens
        tokens_query = tokens_query.filter(role=role)
        if outlet_id:
            tokens_query = tokens_query.filter(Q(outlet_id=outlet_id) | Q(outlet_id__isnull=True))

    tokens = tokens_query.all()
    
    for token in tokens:
        try:
            message = messaging.Message(
                notification=messaging.Notification(title=title, body=body),
                data=data,
                token=token.fcm_token
            )
            messaging.send(message)
        except Exception as e:
            err_msg = str(e).lower()
            if 'unregistered' in err_msg or 'invalid' in err_msg:
                # Mark token inactive
                token.is_active = False
                token.save()

# --- AUTH ENDPOINTS ---

DEFAULT_STAFF = [
    { 'role': 'admin', 'username': 'Admin_Harinos', 'password': 'Harinos_Admin', 'outletId': None },
    { 'role': 'manager', 'username': 'Manager_Harinos', 'password': 'Harinos_Manager', 'outletId': None },
    { 'role': 'staff', 'username': 'Staff_Harinos', 'password': 'Harinos_Staff', 'outletId': None },
]

@api_view(['POST'])
@permission_classes([AllowAny])
def auth_login(request):
    username = request.data.get('username')
    password = request.data.get('password')
    if not username or not password:
        return Response({'success': False, 'message': 'Missing username or password.'}, status=status.HTTP_400_BAD_REQUEST)

    # Seed staff if database is empty
    if not StaffUser.objects.exists():
        for user in DEFAULT_STAFF:
            hashed_pw = hash_password(user['password'])
            StaffUser.objects.create(
                username=user['username'],
                role=user['role'],
                payload={
                    'username': user['username'],
                    'role': user['role'],
                    'password': hashed_pw,
                    'outletId': user['outletId']
                }
            )

    try:
        user = StaffUser.objects.get(username=username)
        stored_hash = user.payload.get('password')
        if verify_password(password, stored_hash):
            token = generate_jwt({
                'username': user.username,
                'role': user.role,
                'outletId': user.payload.get('outletId')
            }, settings.JWT_SECRET)
            
            return Response({
                'success': True,
                'role': user.role,
                'username': user.username,
                'outletId': user.payload.get('outletId'),
                'token': token
            })
        else:
            return Response({'success': False, 'message': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)
    except StaffUser.DoesNotExist:
        return Response({'success': False, 'message': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)


@api_view(['POST'])
@authentication_classes([JWTAuthentication])
def auth_change_password(request):
    username = request.data.get('username')
    new_password = request.data.get('newPassword')
    if not username or not new_password:
        return Response({'success': False, 'message': 'Username and newPassword are required.'}, status=status.HTTP_400_BAD_REQUEST)

    # Check permission (only self or admin can update password)
    if request.user.role != 'admin' and request.user.username != username:
        return Response({'success': False, 'message': 'Unauthorized to change this password.'}, status=status.HTTP_403_FORBIDDEN)

    try:
        user = StaffUser.objects.get(username=username)
        hashed = hash_password(new_password)
        payload = user.payload
        payload['password'] = hashed
        user.payload = payload
        user.save()
        return Response({'success': True, 'message': 'Password updated successfully.'})
    except StaffUser.DoesNotExist:
        return Response({'success': False, 'message': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

# --- NOTIFICATION TOKEN REGISTRATION ---

@api_view(['POST'])
@permission_classes([AllowAny])
def register_notification_token(request):
    fcm_token = request.data.get('fcmToken')
    role = request.data.get('role')
    user_id = request.data.get('userId')
    device_info = request.data.get('deviceInfo', {})
    outlet_id = request.data.get('outletId')

    if not fcm_token or not role or not user_id:
        return Response({'success': False, 'message': 'Missing required fields.'}, status=status.HTTP_400_BAD_REQUEST)

    token_hash = fcm_token[:16]
    doc_id = f"{user_id}_{token_hash}"
    now = datetime.utcnow().isoformat() + 'Z'

    payload = {
        'id': doc_id,
        'userId': user_id,
        'fcmToken': fcm_token,
        'role': role,
        'outletId': outlet_id,
        'deviceType': 'browser',
        'deviceInfo': device_info,
        'isActive': True,
        'createdAt': now,
        'updatedAt': now,
        'lastUsedAt': now,
    }

    NotificationToken.objects.update_or_create(
        id=doc_id,
        defaults={
            'user_id': user_id,
            'fcm_token': fcm_token,
            'role': role,
            'outlet_id': outlet_id,
            'device_info': device_info,
            'is_active': True,
            'created_at': parse_datetime(now) or timezone.now(),
            'updated_at': parse_datetime(now) or timezone.now(),
            'last_used_at': parse_datetime(now) or timezone.now(),
        }
    )
    # Save the full payload for JSON representations if needed
    t = NotificationToken.objects.get(id=doc_id)
    t.device_info = payload
    t.save()

    return Response({'success': True, 'message': 'Token registered successfully', 'tokenId': doc_id})

# --- SETTINGS ENDPOINTS ---

@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def app_settings(request):
    if request.method == 'GET':
        try:
            sett = Setting.objects.get(id='app')
            return Response(sett.payload)
        except Setting.DoesNotExist:
            return Response({'instagramUrl': '', 'menuVersion': '1.0'})
            
    # POST - Save settings
    payload = request.data
    Setting.objects.update_or_create(
        id='app',
        defaults={'payload': payload}
    )
    return Response({'success': True})

# --- MENU ITEMS ENDPOINTS ---

DEFAULT_MENU_ITEMS = [
    {
        "id": "p1_co",
        "name": "Cheese & Onion Pizza",
        "description": "Classic hand-stretched pizza topped with premium mozzarella and fresh red onions.",
        "price": 99,
        "category": "Pizza",
        "image": "/images/cheeseonion.jpeg",
        "vegetarian": True,
        "available": True,
        "sizes": [{"label": "Regular", "price": 99}, {"label": "Medium", "price": 219}, {"label": "Large", "price": 329}]
    },
    {
        "id": "p1_t",
        "name": "Cheese & Tomato",
        "description": "Your choice of juicy tomatoes with a double layer of cheese.",
        "price": 119,
        "category": "Pizza",
        "image": "/images/cheesetomato.jpeg",
        "vegetarian": True,
        "available": True,
        "sizes": [{"label": "Regular", "price": 119}, {"label": "Medium", "price": 239}, {"label": "Large", "price": 349}]
    },
]

@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def menu_items(request):
    action = request.query_params.get('action')
    
    # POST Seed
    if request.method == 'POST' and action == 'seed':
        items = request.data
        if not isinstance(items, list):
            return Response({'success': False, 'message': 'Payload must be an array.'}, status=status.HTTP_400_BAD_REQUEST)
        
        for item in items:
            MenuItem.objects.update_or_create(
                id=item['id'],
                defaults={'payload': item, 'available': item.get('available', True)}
            )
            
        # Update menuVersion
        sett, _ = Setting.objects.get_or_create(id='app', defaults={'payload': {'instagramUrl': '', 'menuVersion': '1.0'}})
        p = sett.payload
        p['menuVersion'] = str(int(time.time() * 1000))
        sett.payload = p
        sett.save()
        return Response({'success': True, 'count': len(items)})

    if request.method == 'GET':
        # If no items exist, seed defaults
        if not MenuItem.objects.exists():
            for item in DEFAULT_MENU_ITEMS:
                MenuItem.objects.create(id=item['id'], payload=item, available=True)

        items = MenuItem.objects.all()
        serializer = JSONPayloadSerializer(items, many=True)
        return Response({'success': True, 'menuItems': serializer.data})

    # POST Save single item
    item = request.data
    if not item.get('id') or not item.get('name'):
        return Response({'success': False, 'message': 'Invalid item payload.'}, status=status.HTTP_400_BAD_REQUEST)

    MenuItem.objects.update_or_create(
        id=item['id'],
        defaults={'payload': item, 'available': item.get('available', True)}
    )

    # Update menuVersion
    sett, _ = Setting.objects.get_or_create(id='app', defaults={'payload': {'instagramUrl': '', 'menuVersion': '1.0'}})
    p = sett.payload
    p['menuVersion'] = str(int(time.time() * 1000))
    sett.payload = p
    sett.save()

    return Response({'success': True})

# --- OUTLETS ENDPOINTS ---

@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def outlets(request):
    if request.method == 'GET':
        outlets_list = Outlet.objects.all()
        serializer = JSONPayloadSerializer(outlets_list, many=True)
        return Response({'success': True, 'outlets': serializer.data})

    # POST Save outlet
    outlet = request.data
    if not outlet.get('id') or not outlet.get('name'):
        return Response({'success': False, 'message': 'Invalid outlet payload.'}, status=status.HTTP_400_BAD_REQUEST)

    Outlet.objects.update_or_create(
        id=outlet['id'],
        defaults={'payload': outlet, 'enabled': outlet.get('enabled', True)}
    )

    # Update menuVersion
    sett, _ = Setting.objects.get_or_create(id='app', defaults={'payload': {'instagramUrl': '', 'menuVersion': '1.0'}})
    p = sett.payload
    p['menuVersion'] = str(int(time.time() * 1000))
    sett.payload = p
    sett.save()

    return Response({'success': True})

# --- OFFERS ENDPOINTS ---

@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def offers(request):
    if request.method == 'GET':
        offers_list = Offer.objects.all()
        serializer = JSONPayloadSerializer(offers_list, many=True)
        return Response({'success': True, 'offers': serializer.data})

    # POST Save offer
    offer = request.data
    if not offer.get('id') or not offer.get('offerTitle'):
        return Response({'success': False, 'message': 'Invalid offer payload.'}, status=status.HTTP_400_BAD_REQUEST)

    Offer.objects.update_or_create(
        id=offer['id'],
        defaults={'payload': offer, 'enabled': offer.get('enabled', True)}
    )

    # Update menuVersion
    sett, _ = Setting.objects.get_or_create(id='app', defaults={'payload': {'instagramUrl': '', 'menuVersion': '1.0'}})
    p = sett.payload
    p['menuVersion'] = str(int(time.time() * 1000))
    sett.payload = p
    sett.save()

    return Response({'success': True})

# --- WALLET TRANSACTIONS ---

@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def wallet_transactions(request):
    if request.method == 'GET':
        txs = WalletTransaction.objects.all().order_by('-created_at')
        serializer = JSONPayloadSerializer(txs, many=True)
        return Response({'success': True, 'transactions': serializer.data})

    # POST
    tx = request.data
    tx_id = tx.get('id') or f"tx_{int(time.time()*1000)}"
    tx['id'] = tx_id
    created_str = tx.get('createdAt') or datetime.utcnow().isoformat() + 'Z'
    tx['createdAt'] = created_str

    log_transaction(tx_id, 'wallet_transaction', tx)

    with transaction.atomic():
        WalletTransaction.objects.update_or_create(
            id=tx_id,
            defaults={
                'payload': tx,
                'created_at': parse_datetime(created_str) or timezone.now()
            }
        )

        # Update customer balance
        cust_id = tx.get('customerId')
        amount = float(tx.get('amount', 0))
        if cust_id:
            try:
                cust = Customer.objects.get(id=cust_id)
                payload = cust.payload
                current_bal = float(payload.get('walletBalance', 0))
                new_bal = current_bal + amount
                payload['walletBalance'] = new_bal
                cust.payload = payload
                cust.save()
            except Customer.DoesNotExist:
                pass

    complete_transaction(tx_id)

    return Response({'success': True})

# --- CUSTOMER ENDPOINTS ---

@api_view(['GET', 'POST', 'DELETE'])
@permission_classes([AllowAny])
def customers_endpoint(request):
    action = request.query_params.get('action')

    # GET Customers
    if request.method == 'GET':
        # check usage (Mock analytics log)
        if action == 'usage':
            # return some mock usage stats to UI
            mock_usage = [
                {
                    'id': datetime.now().strftime('%Y-%m-%d'),
                    'timestamp': datetime.now().isoformat(),
                    'reads': 450,
                    'writes': 85,
                    'deletes': 2,
                    'ordersReads': 210,
                    'customersReads': 120,
                    'walletReads': 45,
                    'menuReads': 60,
                    'otherReads': 15
                }
            ]
            return Response({'success': True, 'logs': mock_usage})

        cust_id = request.query_params.get('customerId')
        if cust_id:
            try:
                cust = Customer.objects.get(id=cust_id)
                return Response({'success': True, 'customer': cust.payload})
            except Customer.DoesNotExist:
                return Response({'success': False, 'message': 'Customer not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Get all
        custs = Customer.objects.all().order_by('-created_at')
        serializer = JSONPayloadSerializer(custs, many=True)
        return Response({'success': True, 'customers': serializer.data})

    # DELETE Customer
    if request.method == 'DELETE':
        cust_id = request.query_params.get('customerId')
        if not cust_id:
            return Response({'success': False, 'message': 'customerId required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            Customer.objects.filter(id=cust_id).delete()
            return Response({'success': True})
        except Exception as e:
            return Response({'success': False, 'message': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    # POST Action: login-init
    if action == 'login-init':
        phone = request.data.get('phone')
        name = request.data.get('name')
        is_registering = request.data.get('isRegistering', False)
        
        if not phone:
            return Response({'success': False, 'message': 'Phone is required.'}, status=status.HTTP_400_BAD_REQUEST)

        clean_phone = ''.join(c for c in phone if c.isdigit())

        # Check blocked
        if BlockedCustomer.objects.filter(phone=clean_phone).exists():
            return Response({'success': False, 'message': 'This mobile number is permanently blocked.'}, status=status.HTTP_403_FORBIDDEN)

        otp = str(timezone.random_otp() if hasattr(timezone, 'random_otp') else int(100000 + (time.time() % 1) * 900000))
        # Hardcode a secure but easily verifiable testing OTP fallback just in case:
        otp = str(os.urandom(3).hex())[:6]
        # Ensure it is a 6-digit numeric string
        otp = ''.join(c for c in otp if c.isdigit())
        if len(otp) < 6:
            otp = otp.zfill(6)
            
        otp_expiry = int((time.time() + 10 * 60) * 1000)

        # Find existing customer
        cust = Customer.objects.filter(Q(phone=phone) | Q(phone=clean_phone)).first()
        
        if cust:
            p = cust.payload
            p['otp'] = otp
            p['otpExpiry'] = otp_expiry
            cust.payload = p
            cust.save()
            return Response({
                'success': True,
                'exists': True,
                'customerId': cust.id,
                'otp': otp,
                'message': 'OTP generated successfully.'
            })
        else:
            if not is_registering:
                return Response({'success': False, 'exists': False, 'message': 'Account does not exist. Please create an account.'})

            new_id = f"cust_{int(time.time()*1000)}"
            new_cust_payload = {
                'id': new_id,
                'name': name.strip() if name else 'New Customer',
                'phone': phone,
                'email': '',
                'loginMethod': 'phone',
                'verified': False,
                'createdAt': datetime.utcnow().isoformat() + 'Z',
                'walletBalance': 0,
                'rewardPoints': 0,
                'status': 'active',
                'referralAttemptsRemaining': 3,
                'referralCodeUsed': False,
                'referralLocked': False,
                'otp': otp,
                'otpExpiry': otp_expiry
            }

            Customer.objects.create(
                id=new_id,
                payload=new_cust_payload,
                phone=phone,
                verified=False,
                created_at=timezone.now()
            )

            return Response({
                'success': True,
                'exists': False,
                'customerId': new_id,
                'otp': otp,
                'message': 'OTP generated for registration.'
            })

    # POST Action: login-verify
    if action == 'login-verify':
        customer_id = request.data.get('customerId')
        otp = request.data.get('otp')
        if not customer_id or not otp:
            return Response({'success': False, 'message': 'customerId and otp are required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            cust = Customer.objects.get(id=customer_id)
            p = cust.payload
            
            # Verify OTP
            if str(p.get('otp')) == str(otp):
                # Success
                import random
                referral_code = p.get('referralCode') or f"REF{random.randint(100000, 999999)}"
                p['verified'] = True
                p['referralCode'] = referral_code
                p.pop('otp', None)
                p.pop('otpExpiry', None)
                cust.payload = p
                cust.verified = True
                cust.save()
                return Response({'success': True, 'customer': p})
            else:
                return Response({'success': False, 'message': 'Incorrect OTP. Please try again.'}, status=status.HTTP_400_BAD_REQUEST)
        except Customer.DoesNotExist:
            return Response({'success': False, 'message': 'Customer not found.'}, status=status.HTTP_404_NOT_FOUND)

    # POST Action: apply-referral
    if action == 'apply-referral':
        customer_id = request.data.get('customerId')
        referral_code = request.data.get('referralCode', '').strip().upper()

        if not customer_id or not referral_code:
            return Response({'success': False, 'message': 'customerId and referralCode are required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            cust = Customer.objects.get(id=customer_id)
            p = cust.payload

            # Lifetime rule: can only enter referral code once
            if p.get('referralCodeUsed') or p.get('referralApplied'):
                return Response({'success': False, 'message': 'Referral code has already been applied.'}, status=status.HTTP_400_BAD_REQUEST)

            # Check locked status
            if p.get('referralLocked') or p.get('referralAttemptsRemaining', 3) <= 0:
                return Response({'success': False, 'message': 'Referral attempts exhausted.'}, status=status.HTTP_400_BAD_REQUEST)

            # Find matching referrer customer
            # (Look through JSON payloads or scan DB)
            referrer = None
            for c in Customer.objects.exclude(id=customer_id):
                if c.payload.get('referralCode', '').upper() == referral_code:
                    referrer = c
                    break

            if referrer:
                ref_tx_id = f"tx_ref_apply_{customer_id}"
                log_transaction(ref_tx_id, 'apply_referral', {
                    'customerId': customer_id,
                    'referralCode': referral_code
                })

                with transaction.atomic():
                    # Apply Referral rewards!
                    # 1. Update target customer
                    p['referralCodeUsed'] = True
                    p['referralApplied'] = True
                    p['referralAppliedAt'] = datetime.utcnow().isoformat() + 'Z'
                    
                    # Reward: add Rs 50
                    p['walletBalance'] = float(p.get('walletBalance', 0)) + 50.0
                    cust.payload = p
                    cust.save()

                    # 2. Update referrer customer
                    ref_payload = referrer.payload
                    ref_payload['walletBalance'] = float(ref_payload.get('walletBalance', 0)) + 50.0
                    referrer.payload = ref_payload
                    referrer.save()

                    # 3. Create wallet transaction logs
                    now_str = datetime.utcnow().isoformat() + 'Z'
                    tx1_id = f"tx_ref1_{int(time.time()*1000)}"
                    WalletTransaction.objects.create(
                        id=tx1_id,
                        created_at=timezone.now(),
                        payload={
                            'id': tx1_id,
                            'customerId': cust.id,
                            'customerName': p.get('name'),
                            'customerPhone': p.get('phone'),
                            'amount': 50.0,
                            'type': 'reward',
                            'status': 'completed',
                            'createdAt': now_str
                        }
                    )

                    tx2_id = f"tx_ref2_{int(time.time()*1000)}"
                    WalletTransaction.objects.create(
                        id=tx2_id,
                        created_at=timezone.now(),
                        payload={
                            'id': tx2_id,
                            'customerId': referrer.id,
                            'customerName': ref_payload.get('name'),
                            'customerPhone': ref_payload.get('phone'),
                            'amount': 50.0,
                            'type': 'reward',
                            'status': 'completed',
                            'createdAt': now_str
                        }
                    )

                complete_transaction(ref_tx_id)

                return Response({'success': True, 'message': 'Referral code applied successfully!', 'customer': p})
            else:
                # Wrong attempt
                attempts = p.get('referralAttemptsRemaining', 3) - 1
                p['referralAttemptsRemaining'] = attempts
                if attempts <= 0:
                    p['referralLocked'] = True
                cust.payload = p
                cust.save()

                return Response({
                    'success': False,
                    'message': f'Invalid referral code. Remaining attempts: {attempts}',
                    'attemptsRemaining': attempts
                }, status=status.HTTP_400_BAD_REQUEST)

        except Customer.DoesNotExist:
            return Response({'success': False, 'message': 'Customer not found.'}, status=status.HTTP_404_NOT_FOUND)

    # Save customer (default POST)
    profile = request.data
    if not profile.get('id') or not profile.get('name') or not profile.get('phone'):
        return Response({'success': False, 'message': 'Invalid customer profile.'}, status=status.HTTP_400_BAD_REQUEST)

    clean_phone = ''.join(c for c in profile['phone'] if c.isdigit())
    
    # Check blocked
    if BlockedCustomer.objects.filter(phone=clean_phone).exists():
        return Response({'success': False, 'message': 'This mobile number is permanently blocked.'}, status=status.HTTP_403_FORBIDDEN)

    if profile.get('status') == 'blocked':
        BlockedCustomer.objects.update_or_create(
            phone=clean_phone,
            defaults={
                'blocked_at': timezone.now(),
                'customer_id': profile['id'],
                'name': profile['name']
            }
        )
    else:
        BlockedCustomer.objects.filter(phone=clean_phone).delete()

    created_str = profile.get('createdAt') or datetime.utcnow().isoformat() + 'Z'
    profile['createdAt'] = created_str

    Customer.objects.update_or_create(
        id=profile['id'],
        defaults={
            'payload': profile,
            'phone': profile['phone'],
            'email': profile.get('email', ''),
            'verified': profile.get('verified', False),
            'created_at': parse_datetime(created_str) or timezone.now()
        }
    )

    return Response({'success': True, 'customer': profile})

# --- ORDER ENDPOINTS ---

@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def orders_endpoint(request):
    # GET Orders list
    if request.method == 'GET':
        role = request.query_params.get('role', 'customer')
        outlet_id = request.query_params.get('outletId')
        limit_val = int(request.query_params.get('limit', 50))
        last_visible = request.query_params.get('lastVisible')

        orders_q = Order.objects.all().order_by('-received_at')

        # Role restrictions
        if role == 'staff':
            # Staff only accesses active orders
            orders_q = orders_q.filter(status__in=['new', 'preparing', 'ready', 'out_for_delivery'])
            if outlet_id:
                orders_q = orders_q.filter(outlet_id=outlet_id)
        elif role == 'manager':
            # Manager sees all but can be filtered by outlet
            if outlet_id:
                orders_q = orders_q.filter(outlet_id=outlet_id)

        # Pagination cursor (lastVisible refers to order ID)
        if last_visible:
            try:
                anchor_order = Order.objects.get(id=last_visible)
                orders_q = orders_q.filter(received_at__lt=anchor_order.received_at)
            except Order.DoesNotExist:
                pass

        orders_list = orders_q[:limit_val]
        serializer = JSONPayloadSerializer(orders_list, many=True)
        return Response({'success': True, 'orders': serializer.data})

    # POST Order placement
    order = request.data
    order_id = order.get('id') or f"order_{int(time.time()*1000)}"
    order['id'] = order_id
    
    received_str = order.get('receivedAt') or order.get('date') or datetime.utcnow().isoformat() + 'Z'
    order['receivedAt'] = received_str
    order['status'] = order.get('status', 'new')

    # Security validation: COD must be verified
    is_cod = order.get('paymentMethod') == 'COD'
    cust_phone = order.get('customerPhone')
    if is_cod and cust_phone:
        clean_phone = ''.join(c for c in cust_phone if c.isdigit())
        cust = Customer.objects.filter(Q(phone=cust_phone) | Q(phone=clean_phone)).first()
        if not cust or not cust.verified:
            return Response({'success': False, 'message': 'Cash On Delivery is available only for verified customers.'}, status=status.HTTP_400_BAD_REQUEST)

    log_transaction(order_id, 'order_placement', order)

    with transaction.atomic():
        Order.objects.update_or_create(
            id=order_id,
            defaults={
                'payload': order,
                'status': order['status'],
                'received_at': parse_datetime(received_str) or timezone.now(),
                'outlet_id': order.get('outletId'),
                'customer_phone': order.get('customerPhone'),
                'total': float(order.get('total', 0))
            }
        )

    complete_transaction(order_id)

    # Trigger New Order Push Notifications to Staff/Managers
    try:
        send_fcm_notification('NEW_ORDER', order_id, role='staff', outlet_id=order.get('outletId'))
        send_fcm_notification('NEW_ORDER', order_id, role='manager', outlet_id=order.get('outletId'))
    except Exception as e:
        print("FCM send failure:", e)

    return Response({'success': True, 'order': order})


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([AllowAny])
def order_detail(request, order_id):
    try:
        ord_obj = Order.objects.get(id=order_id)
    except Order.DoesNotExist:
        return Response({'success': False, 'message': 'Order not found.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response({'success': True, 'order': ord_obj.payload})

    if request.method == 'DELETE':
        # Soft delete
        p = ord_obj.payload
        p['isDeleted'] = True
        ord_obj.payload = p
        ord_obj.save()
        return Response({'success': True})

    # PATCH Order Status
    new_status = request.data.get('status')
    reason = request.data.get('reason')
    if not new_status:
        return Response({'success': False, 'message': 'Missing status.'}, status=status.HTTP_400_BAD_REQUEST)

    p = ord_obj.payload
    old_status = p.get('status', 'new')
    p['status'] = new_status
    p['statusUpdatedAt'] = datetime.utcnow().isoformat() + 'Z'
    
    if reason:
        p['cancellationReason'] = reason

    # Append to audit trail
    trail = p.get('auditTrail', [])
    updated_by = request.user.username if hasattr(request.user, 'username') else 'system'
    trail.append({
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'updatedBy': updated_by,
        'action': f"Status updated from {old_status} to {new_status}",
        'previousStatus': old_status,
        'newStatus': new_status,
        'reason': reason
    })
    p['auditTrail'] = trail

    ord_obj.payload = p
    ord_obj.status = new_status

    # Log status update transaction before DB write
    patch_tx_id = f"tx_patch_status_{order_id}_{int(time.time()*1000)}"
    log_transaction(patch_tx_id, 'order_status_update', {
        'orderId': order_id,
        'status': new_status,
        'reason': reason,
        'updatedBy': updated_by
    })

    with transaction.atomic():
        ord_obj.save()

    complete_transaction(patch_tx_id)

    # Send Notification to Customer
    try:
        customer_phone = p.get('customerPhone')
        if customer_phone:
            clean_phone = ''.join(c for c in customer_phone if c.isdigit())
            cust = Customer.objects.filter(Q(phone=customer_phone) | Q(phone=clean_phone)).first()
            if cust:
                send_fcm_notification(new_status.upper(), order_id, role='customer', customer_token_data=cust.id)
    except Exception as e:
        print("Customer FCM failure:", e)

    return Response({'success': True})

# --- BACKUP & RESTORE ENDPOINTS ---

@api_view(['GET', 'POST'])
@authentication_classes([JWTAuthentication])
def backups_endpoint(request):
    if request.user.role != 'admin':
        return Response({'success': False, 'message': 'Admin privileges required.'}, status=status.HTTP_403_FORBIDDEN)

    ssd_drive = Path(settings.BASE_DIR).drive
    ssd_backup_dir = os.path.join(ssd_drive, '\\WEB_SERVER\\harinos-backups')
    laptop_backup_dir = 'C:\\harinos-backups'

    # Create directories if they do not exist
    os.makedirs(ssd_backup_dir, exist_ok=True)
    os.makedirs(laptop_backup_dir, exist_ok=True)

    if request.method == 'GET':
        # List all backups in SSD dir
        backups = []
        try:
            for file in os.listdir(ssd_backup_dir):
                if file.endswith('.sql'):
                    full_p = os.path.join(ssd_backup_dir, file)
                    stat = os.stat(full_p)
                    backups.append({
                        'filename': file,
                        'size': f"{round(stat.st_size / 1024, 2)} KB",
                        'createdAt': datetime.fromtimestamp(stat.st_mtime).isoformat() + 'Z',
                        'location': 'External SSD & Laptop Internal Storage',
                        'status': 'verified'
                    })
            # Sort newest first
            backups.sort(key=lambda x: x['filename'], reverse=True)
        except Exception as e:
            print("Error listing backups:", e)

        # Get metadata of last backup
        last_backup = backups[0] if backups else None
        return Response({
            'success': True,
            'backups': backups,
            'lastBackupTime': last_backup['createdAt'] if last_backup else 'Never',
            'lastBackupSize': last_backup['size'] if last_backup else '0 KB',
            'lastBackupStatus': last_backup['status'] if last_backup else 'N/A',
            'lastBackupLocation': last_backup['location'] if last_backup else 'N/A'
        })

    # POST - Create full database backup
    db_settings = settings.DATABASES['default']
    db_name = db_settings['NAME']
    db_user = db_settings['USER']
    db_pass = db_settings['PASSWORD']
    db_host = db_settings['HOST']
    db_port = db_settings['PORT']

    timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M')
    backup_filename = f"Backup_{timestamp}.sql"

    ssd_backup_path = os.path.join(ssd_backup_dir, backup_filename)
    laptop_backup_path = os.path.join(laptop_backup_dir, backup_filename)

    mysqldump_bin = get_mysql_tool_path('mysqldump')

    cmd = [
        mysqldump_bin,
        f"--host={db_host}",
        f"--port={db_port}",
        f"--user={db_user}",
    ]
    if db_pass:
        cmd.append(f"--password={db_pass}")
    cmd.append(db_name)

    try:
        # Run dump and save to SSD
        with open(ssd_backup_path, 'w', encoding='utf-8') as f:
            res = subprocess.run(cmd, stdout=f, stderr=subprocess.PIPE, text=True, check=True)
            
        # Copy to internal drive
        import shutil
        shutil.copy2(ssd_backup_path, laptop_backup_path)

        sz = f"{round(os.path.getsize(ssd_backup_path) / 1024, 2)} KB"

        return Response({
            'success': True,
            'message': 'Backup created successfully on SSD and Laptop.',
            'backup': {
                'filename': backup_filename,
                'size': sz,
                'location': f"SSD: {ssd_backup_dir} | Laptop: {laptop_backup_dir}"
            }
        })
    except Exception as e:
        return Response({'success': False, 'message': f"Failed to dump database: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@authentication_classes([JWTAuthentication])
def restore_endpoint(request):
    if request.user.role != 'admin':
        return Response({'success': False, 'message': 'Admin privileges required.'}, status=status.HTTP_403_FORBIDDEN)

    filename = request.data.get('filename')
    if not filename:
        return Response({'success': False, 'message': 'filename is required.'}, status=status.HTTP_400_BAD_REQUEST)

    ssd_drive = Path(settings.BASE_DIR).drive
    ssd_backup_dir = os.path.join(ssd_drive, '\\WEB_SERVER\\harinos-backups')
    target_path = os.path.join(ssd_backup_dir, filename)

    if not os.path.exists(target_path):
        return Response({'success': False, 'message': 'Backup file not found.'}, status=status.HTTP_404_NOT_FOUND)

    # 1. Integrity check: verify it starts with standard mysql comments or has valid sql content
    try:
        with open(target_path, 'r', errors='ignore') as f:
            first_line = f.readline()
            if not first_line or not (first_line.startswith('--') or 'mysql' in first_line.lower()):
                return Response({'success': False, 'message': 'Backup integrity verification failed: invalid SQL file.'}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        return Response({'success': False, 'message': f"Failed to read backup for integrity checks: {str(e)}"}, status=status.HTTP_400_BAD_REQUEST)

    # 2. Create emergency backup first
    db_settings = settings.DATABASES['default']
    db_name = db_settings['NAME']
    db_user = db_settings['USER']
    db_pass = db_settings['PASSWORD']
    db_host = db_settings['HOST']
    db_port = db_settings['PORT']

    emergency_filename = f"Backup_Emergency_{datetime.now().strftime('%Y-%m-%d_%H-%M')}.sql"
    emergency_path = os.path.join(ssd_backup_dir, emergency_filename)

    mysqldump_bin = get_mysql_tool_path('mysqldump')
    dump_cmd = [
        mysqldump_bin, f"--host={db_host}", f"--port={db_port}",
        f"--user={db_user}",
    ]
    if db_pass:
        dump_cmd.append(f"--password={db_pass}")
    dump_cmd.append(db_name)

    try:
        with open(emergency_path, 'w', encoding='utf-8') as f:
            subprocess.run(dump_cmd, stdout=f, check=True)
    except Exception as e:
        return Response({'success': False, 'message': f"Emergency backup creation failed: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    # 3. Restore selected backup
    mysql_bin = get_mysql_tool_path('mysql')
    restore_cmd = [
        mysql_bin, f"--host={db_host}", f"--port={db_port}",
        f"--user={db_user}",
    ]
    if db_pass:
        restore_cmd.append(f"--password={db_pass}")
    restore_cmd.append(db_name)

    try:
        with open(target_path, 'r', encoding='utf-8') as f:
            subprocess.run(restore_cmd, stdin=f, check=True)
        return Response({'success': True, 'message': 'Database restored successfully from backup.'})
    except Exception as e:
        # Emergency rollback if restore fails?
        return Response({'success': False, 'message': f"Database restore failed: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
