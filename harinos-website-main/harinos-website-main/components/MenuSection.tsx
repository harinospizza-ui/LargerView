import React, { useState } from 'react';
import { MenuItem, OfferCard, Category } from '../types';
import {
  getDiscountedUnitPrice,
  getOfferConditionLabel,
  getOfferMinimumScope,
  getMatchingDiscountOffer,
  isOfferUnlocked,
} from '../offerUtils';

interface MenuSectionProps {
  items: MenuItem[];
  onAddToCart: (item: MenuItem, selectedSize?: string) => void;
  offers: OfferCard[];
  cartSubtotal: number;
}

interface MenuCardProps {
  item: MenuItem;
  offers: OfferCard[];
  cartSubtotal: number;
  onAdd: (selectedSize?: string) => void;
}

const MenuCard: React.FC<MenuCardProps> = ({ item, offers, cartSubtotal, onAdd }) => {
  const [selectedSize, setSelectedSize] = useState<string>(item.sizes?.[0]?.label ?? '');
  const [isAdding, setIsAdding] = useState(false);

  const currentBasePrice =
    item.sizes?.find((size) => size.label === selectedSize)?.price ?? item.price;
  const previewOffer = getMatchingDiscountOffer(offers, item);
  const previewAmount = cartSubtotal + currentBasePrice;
  const offerUnlocked = previewOffer ? isOfferUnlocked(previewOffer, currentBasePrice, previewAmount) : false;
  const activeOffer = offerUnlocked ? previewOffer : undefined;
  const discountedPrice = getDiscountedUnitPrice(currentBasePrice, activeOffer);
  const hasDiscount = discountedPrice < currentBasePrice;

  const handleAddClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    setIsAdding(true);
    onAdd(selectedSize || undefined);
    window.setTimeout(() => setIsAdding(false), 500);
  };

  return (
    <div
      className={`group flex h-full flex-col overflow-hidden rounded-[2rem] border border-orange-100 bg-white shadow-sm transition-all duration-500 ${
        item.available ? 'hover:-translate-y-1.5 hover:shadow-2xl' : 'pointer-events-none opacity-60 grayscale'
      }`}
    >
      <div className="relative h-28 overflow-hidden">
        <img
          src={item.image}
          alt={item.name}
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent" />

        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-green-700 shadow-sm">
            Veg
          </span>
          {item.popular && (
            <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-amber-950 shadow-sm">
              Popular
            </span>
          )}
          {item.spicy && (
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-white shadow-sm">
              Spicy
            </span>
          )}
          {previewOffer?.offerPercentage && (
            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-white shadow-sm">
              Save {previewOffer.offerPercentage}%
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-display font-bold leading-snug text-slate-900 truncate" title={item.name}>{item.name}</h3>
            <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500 line-clamp-1">{item.description}</p>
          </div>

          <div className="text-right shrink-0">
            <div className="text-base font-display font-bold text-red-600 font-black">Rs {discountedPrice}</div>
            {hasDiscount && <div className="text-[10px] text-slate-400 line-through">Rs {currentBasePrice}</div>}
          </div>
        </div>

        {item.sizes && (
          <div className="mt-2 flex rounded-xl border border-orange-100 bg-orange-50/70 p-0.5">
            {item.sizes.map((size) => (
              <button
                key={size.label}
                onClick={() => setSelectedSize(size.label)}
                className={`flex-1 rounded-lg px-2 py-1 text-[8px] font-black uppercase tracking-[0.15em] transition-all ${
                  selectedSize === size.label
                    ? 'bg-white text-red-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {size.label}
              </button>
            ))}
          </div>
        )}

        {previewOffer && (
          <div className="mt-2 rounded-xl border border-orange-100 bg-orange-50/60 px-2.5 py-1">
            <div className="text-[8px] font-black uppercase tracking-[0.22em] text-orange-700">
              {previewOffer.offerTitle}
            </div>
            <div className="mt-0.5 text-[9px] leading-relaxed text-slate-600">
              {getOfferConditionLabel(previewOffer)}
              {!offerUnlocked
                ? getOfferMinimumScope(previewOffer) === 'cart'
                  ? ' Add more to unlock.'
                  : ' Upgrade size.'
                : ''}
            </div>
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 mt-auto">
          <span className="text-[8px] font-black uppercase tracking-[0.22em] text-slate-400">{item.category}</span>
          <button
            onClick={handleAddClick}
            className={`inline-flex h-8 min-w-[80px] items-center justify-center rounded-xl px-3 text-[8px] font-black uppercase tracking-[0.22em] btn-hover-scale ${
              isAdding ? 'bg-green-600 text-white' : 'bg-red-600 text-white hover:bg-red-700 hover:shadow-lg hover:shadow-red-600/20'
            }`}
          >
            {isAdding ? 'Added' : item.available ? 'Add' : 'Unavailable'}
          </button>
        </div>
      </div>
    </div>
  );
};

const MenuRow: React.FC<{
  title: string;
  items: MenuItem[];
  offers: OfferCard[];
  cartSubtotal: number;
  onAddToCart: (item: MenuItem, selectedSize?: string) => void;
}> = ({ title, items, offers, cartSubtotal, onAddToCart }) => {
  if (items.length === 0) return null;
  return (
    <div className="mb-12 animate-slide-up">
      <div className="flex items-center justify-between mb-4 border-b border-orange-100 pb-2">
        <h3 className="font-display text-2xl font-bold text-slate-800">{title}</h3>
        <span className="text-xs font-semibold text-slate-400 bg-orange-50 px-3 py-1 rounded-full border border-orange-100/50">{items.length} Options</span>
      </div>
      <div className="flex overflow-x-auto pb-4 gap-6 snap-x snap-mandatory scroll-smooth hide-scrollbar px-1">
        {items.map((item) => (
          <div key={item.id} className="w-[290px] md:w-[340px] shrink-0 snap-start">
            <MenuCard
              item={item}
              offers={offers}
              cartSubtotal={cartSubtotal}
              onAdd={(selectedSize) => onAddToCart(item, selectedSize)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

const MenuSection: React.FC<MenuSectionProps> = ({ items, onAddToCart, offers, cartSubtotal }) => {
  // Grouping logic
  const pizzas = items.filter((item) => item.category === Category.PIZZA);
  
  // Pizza subcategories/series
  const cheesePizzas = pizzas.filter((item) => item.id.startsWith('p1_') || item.id === 'p1_co' || item.id === 'p1_t' || item.id === 'p1_cap' || item.id === 'p1_corn' || item.id === 'p1_p');
  const paneerPizzas = pizzas.filter((item) => item.id.startsWith('p2_') || item.id === 'p2_tp' || item.id === 'p2_pm' || item.id === 'p2_tkp' || item.id === 'p2_up');
  const vegPizzas = pizzas.filter((item) => item.id.startsWith('p3_') || item.id === 'p3_mt' || item.id === 'p3_vo');
  const crunchPizzas = pizzas.filter((item) => item.id.startsWith('p4_') || item.id === 'p4_mc' || item.id === 'p4_cs' || item.id === 'p4_vl');
  const signaturePizzas = pizzas.filter((item) => item.id === 'p_hs');
  
  const otherPizzas = pizzas.filter(
    (item) =>
      !cheesePizzas.includes(item) &&
      !paneerPizzas.includes(item) &&
      !vegPizzas.includes(item) &&
      !crunchPizzas.includes(item) &&
      !signaturePizzas.includes(item)
  );

  const momos = items.filter((item) => item.category === Category.MOMOS);
  const fries = items.filter((item) => item.category === Category.FRIES);

  const burgers = items.filter((item) => item.category === Category.BURGERS);
  const sides = items.filter((item) => item.category === Category.SIDES);
  const beverages = items.filter((item) => item.category === Category.BEVERAGES);

  return (
    <div className="space-y-4">
      {/* Pizzas */}
      {pizzas.length > 0 && (
        <>
          <MenuRow title="Cheese Series" items={cheesePizzas} offers={offers} cartSubtotal={cartSubtotal} onAddToCart={onAddToCart} />
          <MenuRow title="Paneer Specials" items={paneerPizzas} offers={offers} cartSubtotal={cartSubtotal} onAddToCart={onAddToCart} />
          <MenuRow title="Veg Specials" items={vegPizzas} offers={offers} cartSubtotal={cartSubtotal} onAddToCart={onAddToCart} />
          <MenuRow title="Crunch & Fusion" items={crunchPizzas} offers={offers} cartSubtotal={cartSubtotal} onAddToCart={onAddToCart} />
          <MenuRow title="Harino's Signature" items={signaturePizzas} offers={offers} cartSubtotal={cartSubtotal} onAddToCart={onAddToCart} />
          <MenuRow title="Other Pizzas" items={otherPizzas} offers={offers} cartSubtotal={cartSubtotal} onAddToCart={onAddToCart} />
        </>
      )}

      {/* Momos & Fries */}
      {momos.length > 0 && (
        <MenuRow title="Steamed & Fried Momos" items={momos} offers={offers} cartSubtotal={cartSubtotal} onAddToCart={onAddToCart} />
      )}
      {fries.length > 0 && (
        <MenuRow title="Crispy French Fries" items={fries} offers={offers} cartSubtotal={cartSubtotal} onAddToCart={onAddToCart} />
      )}

      {/* Burgers */}
      {burgers.length > 0 && (
        <MenuRow title="Delicious Burgers" items={burgers} offers={offers} cartSubtotal={cartSubtotal} onAddToCart={onAddToCart} />
      )}

      {/* Sides */}
      {sides.length > 0 && (
        <MenuRow title="Side Orders & Calzones" items={sides} offers={offers} cartSubtotal={cartSubtotal} onAddToCart={onAddToCart} />
      )}

      {/* Beverages */}
      {beverages.length > 0 && (
        <MenuRow title="Refreshing Beverages" items={beverages} offers={offers} cartSubtotal={cartSubtotal} onAddToCart={onAddToCart} />
      )}
    </div>
  );
};

export default MenuSection;
