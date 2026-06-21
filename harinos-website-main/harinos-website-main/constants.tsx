
import { MenuItem, Category, OfferCard, OutletConfig } from './types';

// Edit only these outlet objects to route customers to the nearest outlet automatically.
// Keep `enabled: true` only for outlets that are currently active.
// Phone numbers can be written with `+91` or digits only.
export const OUTLET_LOCATIONS: OutletConfig[] = [
  // Outlet 1
  {
    id: 'outlet-1',

    // Enable / Disable
    enabled: true,

    // Outlet Details
    name: "Harino's Main Outlet",
    phone: '+917818958571',

    // Coordinates
    latitude: 28.011897,
    longitude: 77.675534,

    // Delivery Rules
    deliveryRadiusKm: 5,
    freeDeliveryRadiusKm: 3,
    freeDeliveryMinimumOrder: 150,
    minimumOrderIncrementPerKm: 100,
    deliveryChargePerKm: 15,
  },
];

// Edit only these three objects to manage all offers in the app.
// Supported condition examples:
// - "Apply on Pizza when selected size price is Rs 299 or more."
// - "Apply on Cheese & Onion Pizza when selected size price is Rs 129 or more."
// - "Apply on Burgers when cart total is Rs 249 or more."
// - "Apply on full menu when cart total is Rs 499 or more."
// If `offerPercentage` is empty, the card is treated as a display/info card only.
// `notifyCustomers: true` will send a browser notification to customers who have enabled notifications.
export const OFFER_CARDS: OfferCard[] = [
  // Offer Card 1
  {
    id: 'offer-card-1',

    // Enable / Disable
    enabled: false,

    // Images
    image: '/images/vegover.jpeg',

    // Offer
    offerTitle: 'Buy any Large Pizza and get a burger free',
    displayText: 'Season Offer.',

    // Offer Percentage
    // offerPercentage: 0,

    // Condition
    // Use "selected size price" for item-based rules.
    // Use "cart total" or "order total" for cart-based rules.
    condition: 'Apply on Pizza when selected size price is Rs 299 or more.',

    // Additional Item
    // This exact menu item name will auto-add to the cart when the condition is met.
    additionalItem: 'Stuffed Garlic Bread',

    // Additional Item Image
    additionalItemImage: '/images/stuffed.jpeg',

    // Notification
    notifyCustomers: true,
  },

  // Offer Card 2
  {
    id: 'offer-card-2',

    // Enable / Disable
    enabled: false,

    // Images
    image: '/images/hari.jpeg',

    // Offer
    offerTitle: "New launch: Harino's Special",
    displayText: 'Try our latest limited time dish',

    // Offer Percentage
    offerPercentage: undefined,

    // Condition
    // Mention a menu item name exactly to target only that item.
    condition: "Apply on Harino's Special when selected size price is Rs 219 or more.",

    // Additional Item
    // This exact menu item name will auto-add to the cart when the condition is met.
    additionalItem: 'Tikka Burger',

    // Additional Item Image
    additionalItemImage: '/images/tikkaburgar.jpeg',

    // Notification
    notifyCustomers: true,
  },

  // Offer Card 3
  {
    id: 'offer-card-3',

    // Enable / Disable
    enabled: false,

    // Images
    image: '/images/chocolava.jpeg',

    // Offer
    offerTitle: 'Store update or custom announcement',
    displayText: 'Keep this card for info, timings, launch news, bundle highlights, or any message you want to show.',

    // Offer Percentage
    offerPercentage: undefined,

    // Condition
    condition: 'Display only card. No automatic discount rule.',

    // Additional Item
    // This exact menu item name will auto-add to the cart when the condition is met.
    additionalItem: 'Cold Coffee',

    // Additional Item Image
    additionalItemImage: '/images/coldcoffee.jpeg',

    // Notification
    notifyCustomers: false,
  },
];

export const MENU_ITEMS: MenuItem[] = [
  // --- PIZZAS: 1. Margherita Series ---
  {
    id: 'p1_co',
    name: "Cheese & Onion Pizza",
    description: "Classic hand-stretched pizza topped with premium mozzarella and fresh red onions.",
    price: 99,
    category: Category.PIZZA,
    image: "/images/cheeseonion.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 99 }, { label: 'Medium', price: 219 }, { label: 'Large', price: 329 }]
  },
  {
    id: 'p1_t',
    name: "Cheese & Tomato",
    description: "Your choice of juicy tomatoes with a double layer of cheese.",
    price: 119,
    category: Category.PIZZA,
    image: "/images/cheesetomato.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 119 }, { label: 'Medium', price: 239 }, { label: 'Large', price: 349 }]
  },
  {
    id: 'p1_cap',
    name: "Cheese & Capsicum",
    description: "Your choice of crisp capsicum with a double layer of cheese.",
    price: 119,
    category: Category.PIZZA,
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
    category: Category.PIZZA,
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
    category: Category.PIZZA,
    image: "/images/cheesepaneer.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 129 }, { label: 'Medium', price: 259 }, { label: 'Large', price: 369 }]
  },


  // --- PIZZAS: 2. Paneer Special Pizzas ---
  {
    id: 'p2_tp',
    name: "Tandoori Paneer (Paneer + Onion)",
    description: "Smoky tandoori marinated paneer with grilled onions.",
    price: 149,
    category: Category.PIZZA,
    image: "/images/tanduripaneer.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 149 }, { label: 'Medium', price: 289 }, { label: 'Large', price: 409 }]
  },
  {
    id: 'p2_pm',
    name: "Paneer Masala (Paneer + Blended Spices)",
    description: "Masala spiced paneer chunks paired with tangy Blended Spices.",
    price: 149,
    category: Category.PIZZA,
    image: "/images/paneermasala.jpeg",
    vegetarian: true,
    available: false,
    sizes: [{ label: 'Regular', price: 149 }, { label: 'Medium', price: 289 }, { label: 'Large', price: 409 }]
  },
  {
    id: 'p2_tkp',
    name: "Teekha Paneer (Paneer + Hot Chilly)",
    description: "Spicy paneer pizza for those who love a hot kick.",
    price: 149,
    category: Category.PIZZA,
    image: "/images/teekhapaneer.jpeg",
    vegetarian: true,
    available: true,
    spicy: true,
    sizes: [{ label: 'Regular', price: 149 }, { label: 'Medium', price: 289 }, { label: 'Large', price: 409 }]
  },
  {
    id: 'p2_up',
    name: "Ultimate Paneer (Paneer + Corn)",
    description: "The dream combo of grilled paneer and sweet corn.",
    price: 159,
    category: Category.PIZZA,
    image: "/images/ultimatepaneer.jpeg",
    vegetarian: true,
    available: true,
    popular: true,
    sizes: [{ label: 'Regular', price: 159 }, { label: 'Medium', price: 299 }, { label: 'Large', price: 419 }]
  },

  // --- PIZZAS: 3. Veg Special Pizzas ---
  {
    id: 'p3_mt',
    name: "Masala Twist (Veg + Blended Spices)",
    description: "Mixed veggies with a Blended spices twist.",
    price: 169,
    category: Category.PIZZA,
    image: "/images/masala.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 169 }, { label: 'Medium', price: 289 }, { label: 'Large', price: 409 }]
  },
  {
    id: 'p3_vo',
    name: "Veg Overloaded",
    description: "A mountain of fresh vegetables, corn, and extra cheese.",
    price: 169,
    category: Category.PIZZA,
    image: "/images/vegover.jpeg",
    vegetarian: true,
    available: true,
    popular: true,
    sizes: [{ label: 'Regular', price: 169 }, { label: 'Medium', price: 299 }, { label: 'Large', price: 429 }]
  },

  // --- PIZZAS: 4. Crunch & Fusion ---
  {
    id: 'p4_mc',
    name: "Mighty Crunch (Onion + Tomato)",
    description: "Extra crunchy base with your choice of onion & tomato toppings.",
    price: 139,
    category: Category.PIZZA,
    image: "/images/mightycrunch.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 139 }, { label: 'Medium', price: 279 }, { label: 'Large', price: 379 }]
  },
  {
    id: 'p4_cs',
    name: "Chilli Shot (Onion + Capsicum)",
    description: "Hot chilli infused base with crunchy onion & capsicum.",
    price: 139,
    category: Category.PIZZA,
    image: "/images/chillishot.jpeg",
    vegetarian: true,
    available: true,
    spicy: true,
    sizes: [{ label: 'Regular', price: 139 }, { label: 'Medium', price: 279 }, { label: 'Large', price: 379 }]
  },
  {
    id: 'p4_vl',
    name: "Veggie Lover",
    description: "The absolute favorite for vegetable enthusiasts.",
    price: 139,
    category: Category.PIZZA,
    image: "/images/veglover.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 139 }, { label: 'Medium', price: 259 }, { label: 'Large', price: 379 }]
  },

  // --- PIZZAS: 5. Harino's Special ---
  {
    id: 'p_hs',
    name: "Harino's Special",
    description: "The ultimate signature masterpiece loaded with premium paneer, golden corn, tangy olives, and secret house spices. Truly because Hari knows best!",
    price: 219,
    category: Category.PIZZA,
    image: "/images/hari.jpeg",
    vegetarian: true,
    available: true,
    popular: true,
    sizes: [{ label: 'Regular', price: 219 }, { label: 'Medium', price: 349 }, { label: 'Large', price: 499 }]
  },

  // --- MOMOS ---
  {
    id: 'm1_v',
    name: "Veg Steam Momos",
    description: "Delicate steamed veggie dumplings.",
    price: 40,
    category: Category.MOMOS,
    image: "/images/steammomos.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 40 }, { label: 'Full', price: 60 }]
  },
  {
    id: 'm1_s',
    name: "Soya Steam Momos",
    description: "Steamed momos with protein-rich soya filling.",
    price: 30,
    category: Category.MOMOS,
    image: "/images/steammomos.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 30 }, { label: 'Full', price: 50 }]
  },
  {
    id: 'm2_v',
    name: "Veg Fried Momos",
    description: "Crispy fried vegetable dumplings.",
    price: 40,
    category: Category.MOMOS,
    image: "/images/friedmomos.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 40 }, { label: 'Full', price: 60 }]
  },
  {
    id: 'm2_s',
    name: "Soya Fried Momos",
    description: "Golden fried soya dumplings.",
    price: 30,
    category: Category.MOMOS,
    image: "/images/friedmomos.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 30 }, { label: 'Full', price: 50 }]
  },
  {
    id: 'm3_v',
    name: "Veg Tandoori Momos",
    description: "Grilled veg momos in tandoori marinade.",
    price: 50,
    category: Category.MOMOS,
    image: "/images/tandurimomos.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 50 }, { label: 'Full', price: 70 }]
  },
  {
    id: 'm3_s',
    name: "Soya Tandoori Momos",
    description: "Smoky tandoori soya momos.",
    price: 40,
    category: Category.MOMOS,
    image: "/images/tandurimomos.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 40 }, { label: 'Full', price: 60 }]
  },
  {
    id: 'm4_v',
    name: "Veg Cheese Momos",
    description: "Veg momos with a liquid cheese heart.",
    price: 70,
    category: Category.MOMOS,
    image: "/images/cheesemomos.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 70 }, { label: 'Full', price: 100 }]
  },
  {
    id: 'm4_s',
    name: "Soya Cheese Momos",
    description: "Soya momos stuffed with cheese.",
    price: 60,
    category: Category.MOMOS,
    image: "/images/cheesemomos.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 60 }, { label: 'Full', price: 90 }]
  },
  {
    id: 'm5_v',
    name: "Veg Crunchy Momos",
    description: "Extra crispy breaded veg momos.",
    price: 70,
    category: Category.MOMOS,
    image: "/images/crunchymomos.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 70 }, { label: 'Full', price: 100 }]
  },
  {
    id: 'm5_s',
    name: "Soya Crunchy Momos",
    description: "Breaded crunchy soya dumplings.",
    price: 60,
    category: Category.MOMOS,
    image: "/images/crunchymomos.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 60 }, { label: 'Full', price: 90 }]
  },
  {
    id: 'm6_v',
    name: "Veg Gravy Momos",
    description: "Veg momos tossed in spicy house gravy.",
    price: 80,
    category: Category.MOMOS,
    image: "/images/gravymomos.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 80 }, { label: 'Full', price: 120 }]
  },
  {
    id: 'm6_s',
    name: "Soya Gravy Momos",
    description: "Soya momos served in rich spicy gravy.",
    price: 70,
    category: Category.MOMOS,
    image: "/images/gravymomos.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 70 }, { label: 'Full', price: 110 }]
  },

  // --- FRIES ---
  {
    id: 'f_pp',
    name: "Peri Peri Fries",
    description: "Crispy fries with hot peri peri dust.",
    price: 50,
    category: Category.FRIES,
    image: "/images/periperi.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 50 }, { label: 'Full', price: 100 }]
  },
  {
    id: 'f_ch',
    name: "Cheese Fries",
    description: "Fries topped with melted cheese sauce.",
    price: 70,
    category: Category.FRIES,
    image: "/images/cheesefries.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 70 }, { label: 'Full', price: 140 }]
  },
  {
    id: 'f_vg',
    name: "Veggies Fries",
    description: "Loaded fries with fresh vegetable toppings.",
    price: 80,
    category: Category.FRIES,
    image: "/images/vegifries.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 80 }, { label: 'Full', price: 160 }]
  },
    {
    id: 'f_inferno',
    name: "Inferno Fries",
    description: "Loaded fries with fresh vegetable toppings.",
    price: 80,
    category: Category.FRIES,
    image: "/images/infernofries.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Half', price: 80 }, { label: 'Full', price: 160 }]
  },

  // --- BURGERS ---
  { id: 'b_tk', name: "Tikka Burger", description: "Spicy tikka patty with premium mayo.", price: 40, category: Category.BURGERS, image: "/images/tikkaburgar.jpeg", vegetarian: true, available: true },
  { id: 'b_cl', name: "Classic Burger", description: "The original veg burger experience.", price: 50, category: Category.BURGERS, image: "/images/classicburger.jpeg", vegetarian: true, available: true },
  { id: 'b_ch', name: "Cheese Burger", description: "Classic burger with extra cheese slice.", price: 60, category: Category.BURGERS, image: "/images/cheeseburger.jpeg", vegetarian: true, available: true },
  { id: 'b_pn', name: "Paneer Burger", description: "Fresh paneer slab with spicy sauce.", price: 60, category: Category.BURGERS, image: "/images/paneerburger.jpeg", vegetarian: true, available: true },
  { id: 'b_td', name: "Tandoori Burger", description: "Smoky tandoori patty burger.", price: 60, category: Category.BURGERS, image: "/images/tanduriburger.jpeg", vegetarian: true, available: true },
  { id: 'b_cp', name: "Cheese & Paneer Burger", description: "Double the joy with cheese and paneer.", price: 70, category: Category.BURGERS, image: "/images/cheesepaneerburger.jpeg", vegetarian: true, available: true },
  { id: 'b_in', name: "Inferno Burger", description: "Extremely spicy for the brave.", price: 70, category: Category.BURGERS, image: "/images/infernoburger.jpeg", vegetarian: true, available: true, spicy: true },
  { id: 'b_cv', name: "Veg Carnival Burger", description: "Jumbo burger loaded with everything.", price: 90, category: Category.BURGERS, image: "/images/vegcar.jpeg", vegetarian: true, available: true, popular: true },

  // --- SIDE ORDERS & SNACKS ---
  { id: 's_cl', name: "Choco Lava Cake", description: "Molten chocolate center cake.", price: 60, category: Category.SIDES, image: "/images/chocolava.jpeg", vegetarian: true, available: true },
  { id: 's_gb', name: "Garlic Bread", description: "Freshly baked garlic butter bread.", price: 80, category: Category.SIDES, image: "/images/garlicbread.jpeg", vegetarian: true, available: true },
  { id: 's_sg', name: "Stuffed Garlic Bread", description: "Loaded with cheese, corn, and onion.", price: 120, category: Category.SIDES, image: "/images/stuffed.jpeg", vegetarian: true, available: true },
  {
    id: 's_zp',
    name: "Zingi Parcel",
    description: "Paneer stuffed savory parcels.",
    price: 70,
    category: Category.SIDES,
    image: "/images/zingi.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: '2-Pieces', price: 70 }, { label: '4-Pieces', price: 130 }]
  },
  {
    id: 's_cz',
    name: "Calzone",
    description: "Folded pizza pocket stuffed with toppings.",
    price: 70,
    category: Category.SIDES,
    image: "/images/calzone.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: '1-Piece', price: 70 }, { label: '2-Pieces', price: 130 }]
  },
  { id: 's_cp', name: "Chilli Potato", description: "Crispy honey chilli glazed potato fingers.", price: 90, category: Category.SIDES, image: "/images/chillipotato.jpeg", vegetarian: true, available: true },
  { id: 's_hp', name: "Honey Chilli Potato", description: "Sweet and spicy crispy potato snack.", price: 100, category: Category.SIDES, image: "/images/chillipotato.jpeg", vegetarian: true, available: true },

  // --- BEVERAGES ---
  {
    id: 'd_cc',
    name: "Cold Coffee",
    description: "Iced coffee blend.",
    price: 70,
    category: Category.BEVERAGES,
    image: "/images/coldcoffee.jpeg",
    vegetarian: true,
    available: true,
    sizes: [{ label: 'Regular', price: 70 }]
  },
    {
    id: 'd_ccwi',
    name: "Cold Coffee with Ice-Cream",
    description: "Iced creamy coffee blend.",
    price: 100,
    category: Category.BEVERAGES,
    image: "/images/coldcoffeeice.jpeg",
    vegetarian: true,
    available: false,
    sizes: [{ label: 'Regular', price: 100 }]
  },
  { id: 'd_vm', name: "Virgin Mojito", description: "Mint and lime refresher.", price: 100, category: Category.BEVERAGES, image: "/images/virgin.jpeg", vegetarian: true, available: false },
  { id: 'd_cm', name: "Curacao Mojito", description: "Blue orange citrus mojito.", price: 100, category: Category.BEVERAGES, image: "/images/blue.jpeg", vegetarian: true, available: false }
];
