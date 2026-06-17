import { Router } from 'express';
import { getOrderStore } from '../storage/index.js';
import { MenuItem, OutletConfig, OfferCard } from '../types.js';

const router = Router();

// Menu Items
router.get('/menu-items', async (_req, res, next) => {
  try {
    const items = await getOrderStore().getMenuItems();
    res.json({ success: true, menuItems: items });
  } catch (error) {
    next(error);
  }
});

router.post('/menu-items', async (req, res, next) => {
  try {
    const item = req.body as Partial<MenuItem>;
    if (!item.id || !item.name || typeof item.price !== 'number') {
      res.status(400).json({ success: false, message: 'Invalid menu item payload.' });
      return;
    }
    await getOrderStore().saveMenuItem(item as MenuItem);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/menu-items/seed', async (req, res, next) => {
  try {
    const items = req.body as MenuItem[];
    if (!Array.isArray(items)) {
      res.status(400).json({ success: false, message: 'Payload must be an array of menu items.' });
      return;
    }
    const store = getOrderStore();
    for (const item of items) {
      await store.saveMenuItem(item);
    }
    res.json({ success: true, count: items.length });
  } catch (error) {
    next(error);
  }
});

// Outlets
router.get('/outlets', async (_req, res, next) => {
  try {
    const outlets = await getOrderStore().getOutlets();
    res.json({ success: true, outlets });
  } catch (error) {
    next(error);
  }
});

router.post('/outlets', async (req, res, next) => {
  try {
    const outlet = req.body as Partial<OutletConfig>;
    if (!outlet.id || !outlet.name || !outlet.phone) {
      res.status(400).json({ success: false, message: 'Invalid outlet payload.' });
      return;
    }
    await getOrderStore().saveOutlet(outlet as OutletConfig);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/outlets/seed', async (req, res, next) => {
  try {
    const outlets = req.body as OutletConfig[];
    if (!Array.isArray(outlets)) {
      res.status(400).json({ success: false, message: 'Payload must be an array of outlets.' });
      return;
    }
    const store = getOrderStore();
    for (const outlet of outlets) {
      await store.saveOutlet(outlet);
    }
    res.json({ success: true, count: outlets.length });
  } catch (error) {
    next(error);
  }
});

// Offers
router.get('/offers', async (_req, res, next) => {
  try {
    const offers = await getOrderStore().getOffers();
    res.json({ success: true, offers });
  } catch (error) {
    next(error);
  }
});

router.post('/offers', async (req, res, next) => {
  try {
    const offer = req.body as Partial<OfferCard>;
    if (!offer.id || !offer.offerTitle) {
      res.status(400).json({ success: false, message: 'Invalid offer payload.' });
      return;
    }
    await getOrderStore().saveOffer(offer as OfferCard);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post('/offers/seed', async (req, res, next) => {
  try {
    const offers = req.body as OfferCard[];
    if (!Array.isArray(offers)) {
      res.status(400).json({ success: false, message: 'Payload must be an array of offers.' });
      return;
    }
    const store = getOrderStore();
    for (const offer of offers) {
      await store.saveOffer(offer);
    }
    res.json({ success: true, count: offers.length });
  } catch (error) {
    next(error);
  }
});

export default router;
