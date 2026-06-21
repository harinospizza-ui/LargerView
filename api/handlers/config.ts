import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  res.json({
    apiKey: (process.env.VITE_FIREBASE_API_KEY || '').trim(),
    authDomain: (process.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
    projectId: (process.env.VITE_FIREBASE_PROJECT_ID || '').trim(),
    storageBucket: (process.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
    messagingSenderId: (process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
    appId: (process.env.VITE_FIREBASE_APP_ID || '').trim(),
    vapidKey: (process.env.VITE_FIREBASE_VAPID_KEY || '').trim(),
  });
}
