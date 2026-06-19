import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';

const parseServiceAccount = (): admin.ServiceAccount => {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (encoded) {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as admin.ServiceAccount;
  }
  if (raw) {
    return JSON.parse(raw) as admin.ServiceAccount;
  }
  throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_BASE64.');
};

const getFirestore = (): admin.firestore.Firestore => {
  if (!admin.apps.length) {
    const serviceAccount = parseServiceAccount();
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || 'harinos-12902',
    });
  }
  return admin.firestore();
};

const DEFAULT_MENU_ITEMS = [
  {
    id: 'p1_co',
    name: "Cheese & Onion Pizza",
    description: "Classic hand-stretched pizza topped with mozzarella and onions.",
    price: 99,
    category: 'Pizza',
    image: "/images/cheeseonion.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 99 }, { label: 'Medium', price: 219 }, { label: 'Large', price: 329 }]
  },
  {
    id: 'p1_t',
    name: "Cheese & Tomato",
    description: "Double mozzarella with fresh juicy tomatoes.",
    price: 119,
    category: 'Pizza',
    image: "/images/cheesetomato.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 119 }, { label: 'Medium', price: 239 }, { label: 'Large', price: 349 }]
  },
  {
    id: 'p1_cap',
    name: "Cheese & Capsicum",
    description: "Double mozzarella with crunchy green capsicum.",
    price: 119,
    category: 'Pizza',
    image: "/images/cheesecap.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 119 }, { label: 'Medium', price: 239 }, { label: 'Large', price: 349 }]
  },
  {
    id: 'p1_corn',
    name: "Cheese & Corn",
    description: "Sweet golden corn smothered in mozzarella.",
    price: 129,
    category: 'Pizza',
    image: "/images/sweetcorn.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 129 }, { label: 'Medium', price: 259 }, { label: 'Large', price: 369 }]
  },
  {
    id: 'p1_p',
    name: "Cheese & Paneer",
    description: "Soft paneer chunks smothered in mozzarella.",
    price: 129,
    category: 'Pizza',
    image: "/images/cheesepaneer.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 129 }, { label: 'Medium', price: 259 }, { label: 'Large', price: 369 }]
  },
  {
    id: 'p2_tp',
    name: "Tandoori Paneer (Paneer + Onion)",
    description: "Smoky tandoori marinated paneer with grilled onions.",
    price: 149,
    category: 'Pizza',
    image: "/images/tanduripaneer.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 149 }, { label: 'Medium', price: 289 }, { label: 'Large', price: 409 }]
  },
  {
    id: 'p_hs',
    name: "Harino's Special",
    description: "Signature masterpiece with paneer, corn, olives and secret spices.",
    price: 219,
    category: 'Pizza',
    image: "/images/hari.jpeg",
    vegetarian: true,
    available: true,
    popular: true,
    sizes: [{ label: 'Regular', price: 219 }, { label: 'Medium', price: 349 }, { label: 'Large', price: 499 }]
  },
  {
    id: 'm1_v',
    name: "Veg Steam Momos",
    description: "Delicate steamed veggie dumplings.",
    price: 40,
    category: 'Momos & Fries',
    image: "/images/steammomos.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 40 }, { label: 'Full', price: 60 }]
  },
  {
    id: 'b_tk',
    name: "Tikka Burger",
    description: "Spicy tikka patty with premium mayo.",
    price: 40,
    category: 'Burgers',
    image: "/images/tikkaburgar.jpeg",
    vegetarian: true,
    available: true
  },
  {
    id: 's_cl',
    name: "Choco Lava Cake",
    description: "Molten chocolate center cake.",
    price: 60,
    category: 'Sides & Snacks',
    image: "/images/chocolava.jpeg",
    vegetarian: true,
    available: true
  },
  {
    id: 'd_cc',
    name: "Cold Coffee",
    description: "Iced coffee blend.",
    price: 70,
    category: 'Beverages',
    image: "/images/coldcoffee.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 70 }]
  }
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { action } = req.query as { action?: string };

  try {
    const db = getFirestore();

    // 1. POST seed (/api/menu-items/seed)
    if (req.method === 'POST' && action === 'seed') {
      const items = req.body as any[];
      if (!Array.isArray(items)) {
        res.status(400).json({ success: false, message: 'Payload must be an array of menu items.' });
        return;
      }
      const batch = db.batch();
      for (const item of items) {
        const docRef = db.collection('menu_items').doc(item.id);
        batch.set(docRef, item, { merge: true });
      }
      await batch.commit();
      res.json({ success: true, count: items.length });
      return;
    }

    // 2. GET all menu items (/api/menu-items)
    if (req.method === 'GET') {
      const snapshot = await db.collection('menu_items').get();
      if (snapshot.empty) {
        const batch = db.batch();
        for (const item of DEFAULT_MENU_ITEMS) {
          const docRef = db.collection('menu_items').doc(item.id);
          batch.set(docRef, item);
        }
        await batch.commit();
        const seededSnapshot = await db.collection('menu_items').get();
        res.json({ success: true, menuItems: seededSnapshot.docs.map((doc) => doc.data()) });
        return;
      }
      res.json({ success: true, menuItems: snapshot.docs.map((doc) => doc.data()) });
      return;
    }

    // 3. POST save item (/api/menu-items)
    if (req.method === 'POST') {
      const item = req.body as any;
      if (!item.id || !item.name) {
        res.status(400).json({ success: false, message: 'Invalid item payload.' });
        return;
      }
      await db.collection('menu_items').doc(item.id).set(item, { merge: true });
      res.json({ success: true });
      return;
    }

    res.status(405).json({ success: false, message: 'Method not allowed' });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error.',
    });
  }
}
