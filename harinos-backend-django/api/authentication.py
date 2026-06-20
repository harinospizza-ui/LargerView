import base64
import json
import hmac
import hashlib
import time
import os
from django.conf import settings
from rest_framework import authentication
from rest_framework import exceptions

def hash_password(password: str) -> str:
    salt = os.urandom(16).hex()
    iterations = 10000
    dk = hashlib.pbkdf2_hmac('sha512', password.encode('utf-8'), salt.encode('utf-8'), iterations, 64)
    hash_hex = dk.hex()
    return f"pbkdf2${iterations}${salt}${hash_hex}"

def verify_password(password: str, stored_hash: str) -> bool:
    if not stored_hash.startswith('pbkdf2$'):
        return password == stored_hash
    parts = stored_hash.split('$')
    if len(parts) != 4:
        return False
    iterations = int(parts[1])
    salt = parts[2]
    expected_hash = parts[3]
    dk = hashlib.pbkdf2_hmac('sha512', password.encode('utf-8'), salt.encode('utf-8'), iterations, 64)
    return dk.hex() == expected_hash

def verify_jwt(token: str, secret: str) -> dict:
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        header, body, signature = parts
        
        # Verify HMAC signature
        hmac_obj = hmac.new(secret.encode('utf-8'), f"{header}.{body}".encode('utf-8'), hashlib.sha256)
        
        # Pad signature base64url if needed
        sig_rem = len(signature) % 4
        sig_padded = signature + ('=' * (4 - sig_rem) if sig_rem else '')
        expected_sig = base64.urlsafe_b64encode(hmac_obj.digest()).decode('utf-8').rstrip("=")
        
        if signature != expected_sig:
            return None
            
        # Decode body
        body_rem = len(body) % 4
        body_padded = body + ('=' * (4 - body_rem) if body_rem else '')
        payload = json.loads(base64.urlsafe_b64decode(body_padded.encode('utf-8')).decode('utf-8'))
        
        if payload.get('exp') and payload['exp'] < time.time():
            return None
            
        return payload
    except Exception:
        return None

def generate_jwt(payload: dict, secret: str) -> str:
    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode('utf-8')).decode('utf-8').rstrip("=")
    exp = int(time.time()) + 12 * 60 * 60  # 12 hours expiry
    body_data = {**payload, "exp": exp}
    body = base64.urlsafe_b64encode(json.dumps(body_data).encode('utf-8')).decode('utf-8').rstrip("=")
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode('utf-8'), f"{header}.{body}".encode('utf-8'), hashlib.sha256).digest()).decode('utf-8').rstrip("=")
    return f"{header}.{body}.{signature}"


class DjangoAuthenticatedUser:
    def __init__(self, username, role, is_authenticated=True):
        self.username = username
        self.role = role
        self.is_authenticated = is_authenticated

    def __str__(self):
        return self.username


class JWTAuthentication(authentication.BaseAuthentication):
    def authenticate(self, request):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return None
            
        token = auth_header[7:]
        payload = verify_jwt(token, settings.JWT_SECRET)
        if not payload:
            raise exceptions.AuthenticationFailed('Invalid or expired token')
            
        username = payload.get('username') or payload.get('id')
        role = payload.get('role') or 'customer'
        
        user = DjangoAuthenticatedUser(username=username, role=role)
        return (user, token)
