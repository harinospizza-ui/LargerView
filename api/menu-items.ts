import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';
import { trackUsage } from './firestoreUsage.js';

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
    "id": "p1_co",
    "name": "Cheese & Onion Pizza",
    "description": "Classic hand-stretched pizza topped with premium mozzarella and fresh red onions.",
    "price": 99,
    "category": "Pizza",
    "image": "/images/cheeseonion.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 99
      },
      {
        "label": "Medium",
        "price": 219
      },
      {
        "label": "Large",
        "price": 329
      }
    ]
  },
  {
    "id": "p1_t",
    "name": "Cheese & Tomato",
    "description": "Your choice of juicy tomatoes with a double layer of cheese.",
    "price": 119,
    "category": "Pizza",
    "image": "/images/cheesetomato.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 119
      },
      {
        "label": "Medium",
        "price": 239
      },
      {
        "label": "Large",
        "price": 349
      }
    ]
  },
  {
    "id": "p1_cap",
    "name": "Cheese & Capsicum",
    "description": "Your choice of crisp capsicum with a double layer of cheese.",
    "price": 119,
    "category": "Pizza",
    "image": "/images/cheesecap.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 119
      },
      {
        "label": "Medium",
        "price": 239
      },
      {
        "label": "Large",
        "price": 349
      }
    ]
  },
  {
    "id": "p1_corn",
    "name": "Cheese & Corn",
    "description": "Sweet golden corn smothered in mozzarella.",
    "price": 129,
    "category": "Pizza",
    "image": "/images/sweetcorn.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 129
      },
      {
        "label": "Medium",
        "price": 259
      },
      {
        "label": "Large",
        "price": 369
      }
    ]
  },
  {
    "id": "p1_p",
    "name": "Cheese & Paneer",
    "description": "Soft paneer chunks smothered in mozzarella.",
    "price": 129,
    "category": "Pizza",
    "image": "/images/cheesepaneer.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 129
      },
      {
        "label": "Medium",
        "price": 259
      },
      {
        "label": "Large",
        "price": 369
      }
    ]
  },
  {
    "id": "p2_tp",
    "name": "Tandoori Paneer (Paneer + Onion)",
    "description": "Smoky tandoori marinated paneer with grilled onions.",
    "price": 149,
    "category": "Pizza",
    "image": "/images/tanduripaneer.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 149
      },
      {
        "label": "Medium",
        "price": 289
      },
      {
        "label": "Large",
        "price": 409
      }
    ]
  },
  {
    "id": "p2_pm",
    "name": "Paneer Masala (Paneer + Blended Spices)",
    "description": "Masala spiced paneer chunks paired with tangy Blended Spices.",
    "price": 149,
    "category": "Pizza",
    "image": "/images/paneermasala.jpeg",
    "vegetarian": true,
    "available": false,
    "sizes": [
      {
        "label": "Regular",
        "price": 149
      },
      {
        "label": "Medium",
        "price": 289
      },
      {
        "label": "Large",
        "price": 409
      }
    ]
  },
  {
    "id": "p2_tkp",
    "name": "Teekha Paneer (Paneer + Hot Chilly)",
    "description": "Spicy paneer pizza for those who love a hot kick.",
    "price": 149,
    "category": "Pizza",
    "image": "/images/teekhapaneer.jpeg",
    "vegetarian": true,
    "available": true,
    "spicy": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 149
      },
      {
        "label": "Medium",
        "price": 289
      },
      {
        "label": "Large",
        "price": 409
      }
    ]
  },
  {
    "id": "p2_up",
    "name": "Ultimate Paneer (Paneer + Corn)",
    "description": "The dream combo of grilled paneer and sweet corn.",
    "price": 159,
    "category": "Pizza",
    "image": "/images/ultimatepaneer.jpeg",
    "vegetarian": true,
    "available": true,
    "popular": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 159
      },
      {
        "label": "Medium",
        "price": 299
      },
      {
        "label": "Large",
        "price": 419
      }
    ]
  },
  {
    "id": "p3_mt",
    "name": "Masala Twist (Veg + Blended Spices)",
    "description": "Mixed veggies with a Blended spices twist.",
    "price": 169,
    "category": "Pizza",
    "image": "/images/masala.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 169
      },
      {
        "label": "Medium",
        "price": 289
      },
      {
        "label": "Large",
        "price": 409
      }
    ]
  },
  {
    "id": "p3_vo",
    "name": "Veg Overloaded",
    "description": "A mountain of fresh vegetables, corn, and extra cheese.",
    "price": 169,
    "category": "Pizza",
    "image": "/images/vegover.jpeg",
    "vegetarian": true,
    "available": true,
    "popular": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 169
      },
      {
        "label": "Medium",
        "price": 299
      },
      {
        "label": "Large",
        "price": 429
      }
    ]
  },
  {
    "id": "p4_mc",
    "name": "Mighty Crunch (Onion + Tomato)",
    "description": "Extra crunchy base with your choice of onion & tomato toppings.",
    "price": 139,
    "category": "Pizza",
    "image": "/images/mightycrunch.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 139
      },
      {
        "label": "Medium",
        "price": 279
      },
      {
        "label": "Large",
        "price": 379
      }
    ]
  },
  {
    "id": "p4_cs",
    "name": "Chilli Shot (Onion + Capsicum)",
    "description": "Hot chilli infused base with crunchy onion & capsicum.",
    "price": 139,
    "category": "Pizza",
    "image": "/images/chillishot.jpeg",
    "vegetarian": true,
    "available": true,
    "spicy": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 139
      },
      {
        "label": "Medium",
        "price": 279
      },
      {
        "label": "Large",
        "price": 379
      }
    ]
  },
  {
    "id": "p4_vl",
    "name": "Veggie Lover",
    "description": "The absolute favorite for vegetable enthusiasts.",
    "price": 139,
    "category": "Pizza",
    "image": "/images/veglover.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 139
      },
      {
        "label": "Medium",
        "price": 259
      },
      {
        "label": "Large",
        "price": 379
      }
    ]
  },
  {
    "id": "p_hs",
    "name": "Harino's Special",
    "description": "The ultimate signature masterpiece loaded with premium paneer, golden corn, tangy olives, and secret house spices. Truly because Hari knows best!",
    "price": 219,
    "category": "Pizza",
    "image": "/images/hari.jpeg",
    "vegetarian": true,
    "available": true,
    "popular": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 219
      },
      {
        "label": "Medium",
        "price": 349
      },
      {
        "label": "Large",
        "price": 499
      }
    ]
  },
  {
    "id": "m1_v",
    "name": "Veg Steam Momos",
    "description": "Delicate steamed veggie dumplings.",
    "price": 40,
    "category": "Momos & Fries",
    "image": "/images/steammomos.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 40
      },
      {
        "label": "Full",
        "price": 60
      }
    ]
  },
  {
    "id": "m1_s",
    "name": "Soya Steam Momos",
    "description": "Steamed momos with protein-rich soya filling.",
    "price": 30,
    "category": "Momos & Fries",
    "image": "/images/steammomos.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 30
      },
      {
        "label": "Full",
        "price": 50
      }
    ]
  },
  {
    "id": "m2_v",
    "name": "Veg Fried Momos",
    "description": "Crispy fried vegetable dumplings.",
    "price": 40,
    "category": "Momos & Fries",
    "image": "/images/friedmomos.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 40
      },
      {
        "label": "Full",
        "price": 60
      }
    ]
  },
  {
    "id": "m2_s",
    "name": "Soya Fried Momos",
    "description": "Golden fried soya dumplings.",
    "price": 30,
    "category": "Momos & Fries",
    "image": "/images/friedmomos.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 30
      },
      {
        "label": "Full",
        "price": 50
      }
    ]
  },
  {
    "id": "m3_v",
    "name": "Veg Tandoori Momos",
    "description": "Grilled veg momos in tandoori marinade.",
    "price": 50,
    "category": "Momos & Fries",
    "image": "/images/tandurimomos.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 50
      },
      {
        "label": "Full",
        "price": 70
      }
    ]
  },
  {
    "id": "m3_s",
    "name": "Soya Tandoori Momos",
    "description": "Smoky tandoori soya momos.",
    "price": 40,
    "category": "Momos & Fries",
    "image": "/images/tandurimomos.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 40
      },
      {
        "label": "Full",
        "price": 60
      }
    ]
  },
  {
    "id": "m4_v",
    "name": "Veg Cheese Momos",
    "description": "Veg momos with a liquid cheese heart.",
    "price": 70,
    "category": "Momos & Fries",
    "image": "/images/cheesemomos.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 70
      },
      {
        "label": "Full",
        "price": 100
      }
    ]
  },
  {
    "id": "m4_s",
    "name": "Soya Cheese Momos",
    "description": "Soya momos stuffed with cheese.",
    "price": 60,
    "category": "Momos & Fries",
    "image": "/images/cheesemomos.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 60
      },
      {
        "label": "Full",
        "price": 90
      }
    ]
  },
  {
    "id": "m5_v",
    "name": "Veg Crunchy Momos",
    "description": "Extra crispy breaded veg momos.",
    "price": 70,
    "category": "Momos & Fries",
    "image": "/images/crunchymomos.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 70
      },
      {
        "label": "Full",
        "price": 100
      }
    ]
  },
  {
    "id": "m5_s",
    "name": "Soya Crunchy Momos",
    "description": "Breaded crunchy soya dumplings.",
    "price": 60,
    "category": "Momos & Fries",
    "image": "/images/crunchymomos.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 60
      },
      {
        "label": "Full",
        "price": 90
      }
    ]
  },
  {
    "id": "m6_v",
    "name": "Veg Gravy Momos",
    "description": "Veg momos tossed in spicy house gravy.",
    "price": 80,
    "category": "Momos & Fries",
    "image": "/images/gravymomos.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 80
      },
      {
        "label": "Full",
        "price": 120
      }
    ]
  },
  {
    "id": "m6_s",
    "name": "Soya Gravy Momos",
    "description": "Soya momos served in rich spicy gravy.",
    "price": 70,
    "category": "Momos & Fries",
    "image": "/images/gravymomos.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 70
      },
      {
        "label": "Full",
        "price": 110
      }
    ]
  },
  {
    "id": "f_pp",
    "name": "Peri Peri Fries",
    "description": "Crispy fries with hot peri peri dust.",
    "price": 50,
    "category": "Momos & Fries",
    "image": "/images/periperi.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 50
      },
      {
        "label": "Full",
        "price": 100
      }
    ]
  },
  {
    "id": "f_ch",
    "name": "Cheese Fries",
    "description": "Fries topped with melted cheese sauce.",
    "price": 70,
    "category": "Momos & Fries",
    "image": "/images/cheesefries.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 70
      },
      {
        "label": "Full",
        "price": 140
      }
    ]
  },
  {
    "id": "f_vg",
    "name": "Veggies Fries",
    "description": "Loaded fries with fresh vegetable toppings.",
    "price": 80,
    "category": "Momos & Fries",
    "image": "/images/vegifries.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 80
      },
      {
        "label": "Full",
        "price": 160
      }
    ]
  },
  {
    "id": "f_inferno",
    "name": "Inferno Fries",
    "description": "Loaded fries with fresh vegetable toppings.",
    "price": 80,
    "category": "Momos & Fries",
    "image": "/images/infernofries.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Half",
        "price": 80
      },
      {
        "label": "Full",
        "price": 160
      }
    ]
  },
  {
    "id": "b_tk",
    "name": "Tikka Burger",
    "description": "Spicy tikka patty with premium mayo.",
    "price": 40,
    "category": "Burgers",
    "image": "/images/tikkaburgar.jpeg",
    "vegetarian": true,
    "available": true
  },
  {
    "id": "b_cl",
    "name": "Classic Burger",
    "description": "The original veg burger experience.",
    "price": 50,
    "category": "Burgers",
    "image": "/images/classicburger.jpeg",
    "vegetarian": true,
    "available": true
  },
  {
    "id": "b_ch",
    "name": "Cheese Burger",
    "description": "Classic burger with extra cheese slice.",
    "price": 60,
    "category": "Burgers",
    "image": "/images/cheeseburger.jpeg",
    "vegetarian": true,
    "available": true
  },
  {
    "id": "b_pn",
    "name": "Paneer Burger",
    "description": "Fresh paneer slab with spicy sauce.",
    "price": 60,
    "category": "Burgers",
    "image": "/images/paneerburger.jpeg",
    "vegetarian": true,
    "available": true
  },
  {
    "id": "b_td",
    "name": "Tandoori Burger",
    "description": "Smoky tandoori patty burger.",
    "price": 60,
    "category": "Burgers",
    "image": "/images/tanduriburger.jpeg",
    "vegetarian": true,
    "available": true
  },
  {
    "id": "b_cp",
    "name": "Cheese & Paneer Burger",
    "description": "Double the joy with cheese and paneer.",
    "price": 70,
    "category": "Burgers",
    "image": "/images/cheesepaneerburger.jpeg",
    "vegetarian": true,
    "available": true
  },
  {
    "id": "b_in",
    "name": "Inferno Burger",
    "description": "Extremely spicy for the brave.",
    "price": 70,
    "category": "Burgers",
    "image": "/images/infernoburger.jpeg",
    "vegetarian": true,
    "available": true,
    "spicy": true
  },
  {
    "id": "b_cv",
    "name": "Veg Carnival Burger",
    "description": "Jumbo burger loaded with everything.",
    "price": 90,
    "category": "Burgers",
    "image": "/images/vegcar.jpeg",
    "vegetarian": true,
    "available": true,
    "popular": true
  },
  {
    "id": "s_cl",
    "name": "Choco Lava Cake",
    "description": "Molten chocolate center cake.",
    "price": 60,
    "category": "Side-Orders",
    "image": "/images/chocolava.jpeg",
    "vegetarian": true,
    "available": true
  },
  {
    "id": "s_gb",
    "name": "Garlic Bread",
    "description": "Freshly baked garlic butter bread.",
    "price": 80,
    "category": "Side-Orders",
    "image": "/images/garlicbread.jpeg",
    "vegetarian": true,
    "available": true
  },
  {
    "id": "s_sg",
    "name": "Stuffed Garlic Bread",
    "description": "Loaded with cheese, corn, and onion.",
    "price": 120,
    "category": "Side-Orders",
    "image": "/images/stuffed.jpeg",
    "vegetarian": true,
    "available": true
  },
  {
    "id": "s_zp",
    "name": "Zingi Parcel",
    "description": "Paneer stuffed savory parcels.",
    "price": 70,
    "category": "Side-Orders",
    "image": "/images/zingi.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "2-Pieces",
        "price": 70
      },
      {
        "label": "4-Pieces",
        "price": 130
      }
    ]
  },
  {
    "id": "s_cz",
    "name": "Calzone",
    "description": "Folded pizza pocket stuffed with toppings.",
    "price": 70,
    "category": "Side-Orders",
    "image": "/images/calzone.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "1-Piece",
        "price": 70
      },
      {
        "label": "2-Pieces",
        "price": 130
      }
    ]
  },
  {
    "id": "s_cp",
    "name": "Chilli Potato",
    "description": "Crispy honey chilli glazed potato fingers.",
    "price": 90,
    "category": "Side-Orders",
    "image": "/images/chillipotato.jpeg",
    "vegetarian": true,
    "available": true
  },
  {
    "id": "s_hp",
    "name": "Honey Chilli Potato",
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 149
      }
    ]
  },
  {
    "id": "g_vburg",
    "name": "Veggie Burger",
    "description": "Crispy vegetable patty in soft buns with fresh lettuce and mayo.",
    "price": 59,
    "category": "Sides",
    "image": "/images/vegburgar.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 59
      }
    ]
  },
  {
    "id": "g_tburg",
    "name": "Tikka Burger",
    "description": "Paneer tikka spiced patty with fresh veggies and tandoori sauce.",
    "price": 79,
    "category": "Sides",
    "image": "/images/tikkaburgar.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 79
      }
    ]
  },
  {
    "id": "g_ff",
    "name": "French Fries",
    "description": "Golden salted potato fries.",
    "price": 80,
    "category": "Sides",
    "image": "/images/frenchfries.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 80
      }
    ]
  },
  {
    "id": "g_mf",
    "name": "Masala Fries",
    "description": "Potato fries tossed in spicy masala blend.",
    "price": 90,
    "category": "Sides",
    "image": "/images/masalafries.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 90
      }
    ]
  },
  {
    "id": "d_clc",
    "name": "Choco Lava Cake",
    "description": "Delicious chocolate cake with gooey chocolate center.",
    "price": 99,
    "category": "Desserts",
    "image": "/images/chocolava.jpeg",
    "vegetarian": true,
    "available": true,
    "sizes": [
      {
        "label": "Regular",
        "price": 99
      }
    ]
  },
  {
    "id": "d_cc",
    "name": "Cold Coffee",
    "description": "Chilled smooth coffee drink.",
    "price": 80,
    "category": "Beverages",
    "image": "/images/coldcoffee.jpeg",
    "vegetarian": true,
    "available": false,
    "sizes": [
      {
        "label": "Regular",
        "price": 80
      }
    ]
  },
  {
    "id": "d_ccwi",
    "name": "Cold Coffee with Ice-Cream",
    "description": "Iced creamy coffee blend.",
    "price": 100,
    "category": "Beverages",
    "image": "/images/coldcoffeeice.jpeg",
    "vegetarian": true,
    "available": false,
    "sizes": [
      {
        "label": "Regular",
        "price": 100
      }
    ]
  },
  {
    "id": "d_vm",
    "name": "Virgin Mojito",
    "description": "Mint and lime refresher.",
    "price": 100,
    "category": "Beverages",
    "image": "/images/virgin.jpeg",
    "vegetarian": true,
    "available": false
  },
  {
    "id": "d_cm",
    "name": "Curacao Mojito",
    "description": "Blue orange citrus mojito.",
    "price": 100,
    "category": "Beverages",
    "image": "/images/blue.jpeg",
    "vegetarian": true,
    "available": false
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
      // Update menu version
      const settingsRef = db.collection('settings').doc('app');
      batch.set(settingsRef, { menuVersion: Date.now().toString() }, { merge: true });

      await batch.commit();
      await trackUsage({ writes: items.length + 1 });
      res.json({ success: true, count: items.length });
      return;
    }

    // 2. GET all menu items (/api/menu-items)
    if (req.method === 'GET') {
      const snapshot = await db.collection('menu_items').get();
      const existingIds = new Set(snapshot.docs.map((doc) => doc.id));
      const missingItems = DEFAULT_MENU_ITEMS.filter((item) => !existingIds.has(item.id));
      
      if (missingItems.length > 0) {
        const batch = db.batch();
        for (const item of missingItems) {
          const docRef = db.collection('menu_items').doc(item.id);
          batch.set(docRef, item);
        }
        await batch.commit();
        const seededSnapshot = await db.collection('menu_items').get();
        await trackUsage({ reads: snapshot.size + seededSnapshot.size, writes: missingItems.length, menuReads: snapshot.size + seededSnapshot.size });
        res.json({ success: true, menuItems: seededSnapshot.docs.map((doc) => doc.data()) });
        return;
      }
      
      await trackUsage({ reads: snapshot.size, menuReads: snapshot.size });
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
      await db.collection('settings').doc('app').set({ menuVersion: Date.now().toString() }, { merge: true });
      await trackUsage({ writes: 2 });
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
