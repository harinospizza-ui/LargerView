import { MENU_ITEMS } from './constants';
import {
  CartItem,
  Category,
  CategoryFilter,
  MenuItem,
  OfferCard,
  PricedCartItem,
} from './types';

type MinimumAmountScope = 'item' | 'cart';

interface ParsedOfferCondition {
  amountScope: MinimumAmountScope;
  minimumAmount?: number;
  matchedItems: MenuItem[];
  matchedCategory?: Category;
}

const CATEGORY_KEYWORDS: Array<{ category: Category; keywords: string[] }> = [
  { category: Category.PIZZA, keywords: ['pizza', 'pizzas'] },
  { category: Category.MOMOS, keywords: ['momos', 'momo'] },
  { category: Category.FRIES, keywords: ['fries'] },
  { category: Category.BURGERS, keywords: ['burger', 'burgers'] },
  { category: Category.SIDES, keywords: ['sides', 'side order', 'side orders', 'garlic bread', 'calzone'] },
  { category: Category.BEVERAGES, keywords: ['beverage', 'beverages', 'drink', 'drinks'] },
];

const CART_SCOPE_KEYWORDS = [
  'cart total',
  'order total',
  'cart value',
  'order value',
  'bill total',
  'bill amount',
  'subtotal',
  'full order',
  'full bill',
  'entire bill',
];

const NON_ACTIONABLE_CONDITION_KEYWORDS = [
  'display only',
  'no automatic discount rule',
  'no automatic rule',
  'announcement only',
  'info only',
  'information only',
];

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isOfferConditionNonActionable = (offer: OfferCard): boolean => {
  const normalizedCondition = normalizeText(offer.condition);
  return NON_ACTIONABLE_CONDITION_KEYWORDS.some((keyword) =>
    normalizedCondition.includes(normalizeText(keyword)),
  );
};

const extractMinimumAmount = (condition: string): number | undefined => {
  const matchers = [
    /(?:above|over|at least|minimum(?: order)?(?: amount)?|more than|or more|or above|and above)\s*(?:of\s*)?(?:rs\.?|inr|₹)?\s*(\d+)/i,
    /(?:rs\.?|inr|₹)\s*(\d+)/i,
    /(\d+)\s*(?:or more|or above|and above|\+)/i,
  ];

  for (const matcher of matchers) {
    const match = condition.match(matcher);
    if (match) {
      return Number(match[1]);
    }
  }

  return undefined;
};

const getAmountScope = (condition: string): MinimumAmountScope => {
  const normalizedCondition = normalizeText(condition);
  return CART_SCOPE_KEYWORDS.some((keyword) => normalizedCondition.includes(keyword)) ? 'cart' : 'item';
};

const findMatchedItems = (condition: string): MenuItem[] => {
  const normalizedCondition = normalizeText(condition);

  return MENU_ITEMS.filter((item) => normalizedCondition.includes(normalizeText(item.name)));
};

const findMenuItemByName = (itemName: string): MenuItem | undefined => {
  const normalizedItemName = normalizeText(itemName);

  return MENU_ITEMS.find((item) => {
    const normalizedMenuName = normalizeText(item.name);
    return (
      normalizedMenuName === normalizedItemName ||
      normalizedMenuName.includes(normalizedItemName) ||
      normalizedItemName.includes(normalizedMenuName)
    );
  });
};

const findMatchedCategory = (condition: string): Category | undefined => {
  const normalizedCondition = normalizeText(condition);

  const categoryEntry = CATEGORY_KEYWORDS.find(({ keywords }) =>
    keywords.some((keyword) => normalizedCondition.includes(keyword)),
  );

  return categoryEntry?.category;
};

const parseOfferCondition = (offer: OfferCard): ParsedOfferCondition => {
  const matchedItems = findMatchedItems(offer.condition);

  return {
    amountScope: getAmountScope(offer.condition),
    minimumAmount: extractMinimumAmount(offer.condition),
    matchedItems,
    matchedCategory: matchedItems.length ? undefined : findMatchedCategory(offer.condition),
  };
};

export const getItemBasePrice = (
  item: Pick<MenuItem, 'price' | 'sizes'>,
  selectedSize?: string,
): number => {
  if (!selectedSize || !item.sizes?.length) {
    return item.price;
  }

  const matchedSize = item.sizes.find((size) => size.label === selectedSize);
  return matchedSize ? matchedSize.price : item.price;
};

export const getCartItemId = (
  item: Pick<CartItem, 'id' | 'selectedSize' | 'isOfferBonus' | 'sourceOfferId'>,
): string => {
  const sizeSuffix = item.selectedSize ? `-${item.selectedSize}` : '';
  return item.isOfferBonus
    ? `bonus-${item.sourceOfferId ?? 'offer'}-${item.id}${sizeSuffix}`
    : `${item.id}${sizeSuffix}`;
};

export const normalizeStoredCartItem = (item: MenuItem & Partial<CartItem>): CartItem => ({
  ...item,
  quantity: Math.max(1, item.quantity ?? 1),
  selectedSize: item.selectedSize,
  basePrice: item.basePrice ?? getItemBasePrice(item, item.selectedSize),
});

const offerTargetsItem = (offer: OfferCard, item: Pick<MenuItem, 'id' | 'category'>): boolean => {
  const parsedCondition = parseOfferCondition(offer);

  if (parsedCondition.matchedItems.length) {
    return parsedCondition.matchedItems.some((matchedItem) => matchedItem.id === item.id);
  }

  if (parsedCondition.matchedCategory) {
    return parsedCondition.matchedCategory === item.category;
  }

  return true;
};

export const offerMeetsMinimumAmount = (offer: OfferCard, amount: number): boolean => {
  const parsedCondition = parseOfferCondition(offer);
  return !parsedCondition.minimumAmount || amount >= parsedCondition.minimumAmount;
};

export const getOfferMinimumScope = (offer: OfferCard): MinimumAmountScope =>
  parseOfferCondition(offer).amountScope;

export const isOfferUnlocked = (
  offer: OfferCard,
  itemAmount: number,
  cartAmount: number,
): boolean => {
  const parsedCondition = parseOfferCondition(offer);
  const amountToCheck = parsedCondition.amountScope === 'cart' ? cartAmount : itemAmount;
  return !parsedCondition.minimumAmount || amountToCheck >= parsedCondition.minimumAmount;
};

export const getMatchingDiscountOffer = (
  offers: OfferCard[],
  item: Pick<MenuItem, 'id' | 'category'>,
): OfferCard | undefined =>
  offers.find(
    (offer) =>
      offer.enabled &&
      !isOfferConditionNonActionable(offer) &&
      !!offer.offerPercentage &&
      offerTargetsItem(offer, item),
  );

export const getApplicableDiscountOffer = (
  offers: OfferCard[],
  item: Pick<MenuItem, 'id' | 'category'>,
  itemAmount: number,
  cartAmount: number,
): OfferCard | undefined => {
  if (item.category === Category.PIZZA && isSundayDhamakaActive(offers)) {
    return undefined;
  }

  for (const offer of offers) {
    if (
      !offer.enabled ||
      isOfferConditionNonActionable(offer) ||
      !offer.offerPercentage ||
      !offerTargetsItem(offer, item)
    ) {
      continue;
    }

    const parsedCondition = parseOfferCondition(offer);
    const amountToCheck = parsedCondition.amountScope === 'cart' ? cartAmount : itemAmount;

    if (!parsedCondition.minimumAmount || amountToCheck >= parsedCondition.minimumAmount) {
      return offer;
    }
  }

  return undefined;
};

export const getDiscountedUnitPrice = (basePrice: number, offer?: OfferCard): number => {
  if (!offer?.offerPercentage) {
    return basePrice;
  }

  return Math.round(basePrice * (1 - offer.offerPercentage / 100));
};

export const buildPricedCart = (cart: CartItem[], offers: OfferCard[]): PricedCartItem[] => {
  const cartSubtotal = cart.reduce((sum, item) => sum + item.basePrice * item.quantity, 0);

  return cart.map((item) => {
    if (item.isOfferBonus) {
      const sourceOffer = offers.find((offer) => offer.id === item.sourceOfferId);

      return {
        ...item,
        discountedPrice: 0,
        totalPrice: 0,
        appliedOfferId: item.sourceOfferId,
        appliedOfferTitle: sourceOffer?.offerTitle ?? 'Auto Added',
      };
    }

    const lineAmount = item.basePrice * item.quantity;
    const matchedOffer = getApplicableDiscountOffer(offers, item, lineAmount, cartSubtotal);
    const discountedPrice = getDiscountedUnitPrice(item.basePrice, matchedOffer);

    return {
      ...item,
      discountedPrice,
      totalPrice: discountedPrice * item.quantity,
      appliedOfferId: matchedOffer?.id,
      appliedOfferTitle: matchedOffer?.offerTitle,
    };
  });
};

export const getOfferConditionLabel = (offer: OfferCard): string => offer.condition;

export const getOfferActionTarget = (
  offer: OfferCard,
): { category: CategoryFilter; item?: MenuItem } => {
  const parsedCondition = parseOfferCondition(offer);

  if (parsedCondition.matchedItems.length === 1) {
    const [item] = parsedCondition.matchedItems;
    return { category: item.category, item };
  }

  if (parsedCondition.matchedItems.length > 1) {
    const firstCategory = parsedCondition.matchedItems[0].category;
    const sameCategory = parsedCondition.matchedItems.every((item) => item.category === firstCategory);
    return { category: sameCategory ? firstCategory : 'All' };
  }

  if (parsedCondition.matchedCategory) {
    return { category: parsedCondition.matchedCategory };
  }

  return { category: 'All' };
};

export const getOfferActionLabel = (offer: OfferCard): string => {
  const target = getOfferActionTarget(offer);

  if (target.item) {
    return `View ${target.item.name}`;
  }

  if (target.category !== 'All') {
    return `View ${target.category}`;
  }

  return 'Browse Menu';
};

export const getOfferNotificationMessage = (offer: OfferCard): string => {
  const extraItemText = offer.additionalItem ? ` Bonus highlight: ${offer.additionalItem}.` : '';
  return `${offer.displayText} ${offer.condition}${extraItemText}`.trim();
};

export const getOfferReleaseSignature = (offers: OfferCard[]): string =>
  offers
    .filter((offer) => offer.enabled && offer.notifyCustomers)
    .map((offer) => [
      offer.id,
      offer.offerTitle,
      offer.displayText,
      offer.offerPercentage ?? '',
      offer.condition,
      offer.additionalItem ?? '',
      offer.additionalItemImage ?? '',
    ].join('|'))
    .join('||');

export const doesOfferConditionMatchCart = (offer: OfferCard, cart: CartItem[]): boolean => {
  if (isOfferConditionNonActionable(offer)) {
    return false;
  }

  const customerCart = cart.filter((item) => !item.isOfferBonus);
  if (!customerCart.length) {
    return false;
  }

  const cartSubtotal = customerCart.reduce((sum, item) => sum + item.basePrice * item.quantity, 0);

  return customerCart.some((item) => {
    if (!offerTargetsItem(offer, item)) {
      return false;
    }

    const lineAmount = item.basePrice * item.quantity;
    return isOfferUnlocked(offer, lineAmount, cartSubtotal);
  });
};

export const isSundayDhamakaActive = (offers: OfferCard[]): boolean => {
  const sundayDhamaka = offers.find((o) => o.id === 'offer-sunday-dhamaka');
  if (!sundayDhamaka || !sundayDhamaka.enabled) return false;
  return new Date().getDay() === 0;
};

export const getSundayDhamakaBonusItems = (cart: CartItem[], offers: OfferCard[]): CartItem[] => {
  if (!isSundayDhamakaActive(offers)) {
    return [];
  }

  const bonusItems: CartItem[] = [];
  const largePizzas = cart.filter(
    (item) => !item.isOfferBonus && item.category === Category.PIZZA && item.selectedSize === 'Large'
  );

  for (const item of largePizzas) {
    const regularItem: CartItem = {
      ...item,
      id: item.id,
      name: item.name,
      description: item.description,
      price: item.price,
      category: item.category,
      image: item.image,
      vegetarian: true,
      available: true,
      sizes: item.sizes,
      quantity: item.quantity,
      selectedSize: 'Regular',
      basePrice: 0,
      isOfferBonus: true,
      sourceOfferId: 'offer-sunday-dhamaka',
      originalPrice: getItemBasePrice(item, 'Regular'),
    };
    bonusItems.push(regularItem);
  }

  return bonusItems;
};

export const getAutomaticOfferBonusItems = (cart: CartItem[], offers: OfferCard[]): CartItem[] => {
  const standardBonus = offers
    .filter((offer) => offer.enabled && !!offer.additionalItem)
    .flatMap((offer) => {
      if (!doesOfferConditionMatchCart(offer, cart) || !offer.additionalItem) {
        return [];
      }

      const bonusMenuItem = findMenuItemByName(offer.additionalItem);
      if (!bonusMenuItem || !bonusMenuItem.available) {
        return [];
      }

      return [
        {
          ...bonusMenuItem,
          quantity: 1,
          selectedSize: bonusMenuItem.sizes?.[0]?.label,
          basePrice: 0,
          isOfferBonus: true,
          sourceOfferId: offer.id,
          originalPrice: getItemBasePrice(bonusMenuItem, bonusMenuItem.sizes?.[0]?.label),
        },
      ];
    });

  const sundayBonus = getSundayDhamakaBonusItems(cart, offers);
  return [...standardBonus, ...sundayBonus];
};
