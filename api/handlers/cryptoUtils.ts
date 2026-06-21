import crypto from 'crypto';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 10000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash.startsWith('pbkdf2$')) {
    // Plaintext fallback (for migration)
    return password === storedHash;
  }
  const parts = storedHash.split('$');
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const hash = parts[3];
  const testHash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  return testHash === hash;
}

export function generateToken(payload: any, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12 hours expiry
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${header}.${body}`);
  const signature = hmac.digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string, secret: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(`${header}.${body}`);
    const expectedSignature = hmac.digest('base64url');
    if (signature !== expectedSignature) return null;
    
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}
