import React, { useState } from 'react';
import { MenuItem, Category, AdminSession, OutletConfig, OfferCard, Order } from '../types';
import { saveMenuItemToServer, saveOutletToServer, saveOfferToServer, deleteOutletFromServer } from '../services/orderApi';
import { MENU_ITEMS } from '../constants';

interface AdminMenuProps {
  session: AdminSession;
  menuItems: MenuItem[];
  outlets: OutletConfig[];
  offers: OfferCard[];
  onRefresh: () => void;
  activeTab: 'menu' | 'outlets' | 'offers';
  orders?: Order[];
}

export const AdminMenu: React.FC<AdminMenuProps> = ({
  session,
  menuItems,
  outlets,
  offers,
  onRefresh,
  activeTab,
  orders,
}) => {
  // Menu Item Form State
  const [isAddingItem, setIsAddingItem] = useState(false);

  const auditWarnings = React.useMemo(() => {
    const warnings: string[] = [];
    const dbItemMap = new Map<string, MenuItem>();
    const dbItemCounts = new Map<string, number>();

    menuItems.forEach((item) => {
      dbItemMap.set(item.id, item);
      dbItemCounts.set(item.id, (dbItemCounts.get(item.id) || 0) + 1);

      // Check database item fields
      if (!item.category) {
        warnings.push(`Database item "${item.name}" (ID: ${item.id}) is missing a category.`);
      }
      if (!item.image) {
        warnings.push(`Database item "${item.name}" (ID: ${item.id}) is missing an image path.`);
      }
    });

    // 1. Check for duplicates in db menuItems
    dbItemCounts.forEach((count, id) => {
      if (count > 1) {
        warnings.push(`Duplicate database entry found for item ID "${id}" (${count} times).`);
      }
    });

    // 2. Loop through static MENU_ITEMS to check status
    MENU_ITEMS.forEach((staticItem) => {
      const dbItem = dbItemMap.get(staticItem.id);
      if (!dbItem) {
        warnings.push(`Static item "${staticItem.name}" (ID: ${staticItem.id}) is missing from the database.`);
      } else {
        const validCategories = Object.values(Category);
        if (dbItem.available && !validCategories.includes(dbItem.category)) {
          warnings.push(`Item "${dbItem.name}" (ID: ${dbItem.id}) is marked available but has an invalid category "${dbItem.category}", hiding it from the customer menu.`);
        }
      }
    });

    return warnings;
  }, [menuItems]);

  // Outlet Form State
  const [editingOutlet, setEditingOutlet] = useState<OutletConfig | null>(null);
  const [isAddingOutlet, setIsAddingOutlet] = useState(false);
  const [outletName, setOutletName] = useState('');
  const [outletAddress, setOutletAddress] = useState('');
  const [outletPhone, setOutletPhone] = useState('');
  const [outletLat, setOutletLat] = useState('26.85');
  const [outletLng, setOutletLng] = useState('75.80');
  const [outletRadius, setOutletRadius] = useState('7');
  const [outletFreeRadius, setOutletFreeRadius] = useState('3');
  const [outletMinOrder, setOutletMinOrder] = useState('150');
  const [outletIncrementPerKm, setOutletIncrementPerKm] = useState('0');
  const [outletChargePerKm, setOutletChargePerKm] = useState('15');
  const [outletManager, setOutletManager] = useState('');

  const startEditOutlet = (outlet: OutletConfig) => {
    setEditingOutlet(outlet);
    setIsAddingOutlet(false);
    setOutletName(outlet.name);
    setOutletAddress(outlet.address || '');
    setOutletPhone(outlet.phone);
    setOutletLat(String(outlet.latitude));
    setOutletLng(String(outlet.longitude));
    setOutletRadius(String(outlet.deliveryRadiusKm));
    setOutletFreeRadius(String(outlet.freeDeliveryRadiusKm));
    setOutletMinOrder(String(outlet.freeDeliveryMinimumOrder));
    setOutletIncrementPerKm(String(outlet.minimumOrderIncrementPerKm));
    setOutletChargePerKm(String(outlet.deliveryChargePerKm));
    setOutletManager(outlet.managerName || '');
  };
  const [newItemId, setNewItemId] = useState('');
  const [newItemName, setNewItemName] = useState('');
  const [newItemDesc, setNewItemDesc] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<Category>(Category.PIZZA);
  const [newItemImage, setNewItemImage] = useState('');
  const [newItemSpicy, setNewItemSpicy] = useState(false);
  const [newItemPopular, setNewItemPopular] = useState(false);

  // Operations
  const toggleItemAvailability = async (item: MenuItem) => {
    const updated = { ...item, available: !item.available };
    await saveMenuItemToServer(updated);
    onRefresh();
  };

  const updateItemPrice = async (item: MenuItem, newPrice: number) => {
    if (isNaN(newPrice) || newPrice < 0) return;
    const updated = { ...item, price: newPrice };
    await saveMenuItemToServer(updated);
    onRefresh();
  };

  const updateSizePrice = async (item: MenuItem, sizeIndex: number, newPrice: number) => {
    if (isNaN(newPrice) || newPrice < 0 || !item.sizes) return;
    const nextSizes = [...item.sizes];
    nextSizes[sizeIndex] = { ...nextSizes[sizeIndex], price: newPrice };
    const updated = { ...item, sizes: nextSizes };
    if (sizeIndex === 0) {
      updated.price = newPrice;
    }
    await saveMenuItemToServer(updated);
    onRefresh();
  };

  const toggleOutletEnabled = async (outlet: OutletConfig) => {
    const updated = { ...outlet, enabled: !outlet.enabled };
    await saveOutletToServer(updated);
    onRefresh();
  };

  const toggleOfferEnabled = async (offer: OfferCard) => {
    const updated = { ...offer, enabled: !offer.enabled };
    await saveOfferToServer(updated);
    onRefresh();
  };

  if (activeTab === 'menu') {
    return (
      <section className="relative mx-auto max-w-6xl p-4 animate-fade-in">
        <h3 className="mb-4 font-display text-2xl font-bold">Dynamic Menu Management</h3>

        {auditWarnings.length > 0 && (
          <div className="mb-6 p-4 rounded-3xl border border-red-500/20 bg-red-950/20 text-red-200 text-xs font-bold space-y-1.5 shadow-lg shadow-red-950/30">
            <h4 className="text-sm font-black uppercase tracking-wider flex items-center gap-2 text-red-300">
              ⚠️ Menu Configuration Warnings ({auditWarnings.length})
            </h4>
            <ul className="list-disc pl-5 space-y-1">
              {auditWarnings.map((warn, i) => (
                <li key={i}>{warn}</li>
              ))}
            </ul>
          </div>
        )}
        
        {/* Add Menu Item Panel */}
        <div className="mb-6 rounded-3xl border border-white/10 bg-white/[0.02] p-5 shadow-lg">
          <button
            onClick={() => setIsAddingItem(!isAddingItem)}
            className="w-full text-left font-display font-bold text-lg flex justify-between items-center outline-none"
          >
            <span>➕ Add New Menu Item</span>
            <span className="text-slate-400">{isAddingItem ? 'Close' : 'Expand'}</span>
          </button>
          
          {isAddingItem && (
            <div className="mt-5 space-y-4 max-w-xl">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Item ID (must start with p1_ for pizzas)</label>
                  <input value={newItemId} onChange={e => setNewItemId(e.target.value)} placeholder="p1_onion" className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-red-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Item Name</label>
                  <input value={newItemName} onChange={e => setNewItemName(e.target.value)} placeholder="Double Cheese Margherita" className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-red-500" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Description</label>
                <textarea value={newItemDesc} onChange={e => setNewItemDesc(e.target.value)} placeholder="Double loaded cheese with herbs" className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-red-500 h-20" />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Category</label>
                  <select value={newItemCategory} onChange={e => setNewItemCategory(e.target.value as any)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-red-500">
                    {Object.values(Category).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Base Price (Rs)</label>
                  <input type="number" value={newItemPrice} onChange={e => setNewItemPrice(e.target.value)} placeholder="199" className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-red-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Image URL</label>
                  <input value={newItemImage} onChange={e => setNewItemImage(e.target.value)} placeholder="/icon-192.png" className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-red-500" />
                </div>
              </div>

              <div className="flex gap-6 pt-2">
                <label className="flex items-center gap-2 font-bold cursor-pointer">
                  <input type="checkbox" checked={newItemSpicy} onChange={e => setNewItemSpicy(e.target.checked)} className="w-4 h-4 rounded text-red-600 focus:ring-0 bg-transparent border-white/20" />
                  <span>Spicy</span>
                </label>
                <label className="flex items-center gap-2 font-bold cursor-pointer">
                  <input type="checkbox" checked={newItemPopular} onChange={e => setNewItemPopular(e.target.checked)} className="w-4 h-4 rounded text-red-600 focus:ring-0 bg-transparent border-white/20" />
                  <span>Popular / Bestseller</span>
                </label>
              </div>

              <button
                type="button"
                onClick={async () => {
                  if (!newItemId.trim() || !newItemName.trim() || !newItemPrice.trim()) {
                    alert('Please fill out Name, ID and Base Price.');
                    return;
                  }
                  
                  const priceNum = parseFloat(newItemPrice);
                  const sizes = newItemCategory === Category.PIZZA ? [
                    { label: 'Regular', price: priceNum },
                    { label: 'Medium', price: priceNum + 100 },
                    { label: 'Large', price: priceNum + 200 }
                  ] : undefined;

                  const item: MenuItem = {
                    id: newItemId,
                    name: newItemName,
                    description: newItemDesc,
                    price: priceNum,
                    category: newItemCategory,
                    image: newItemImage || '/icon-192.png',
                    vegetarian: true,
                    spicy: newItemSpicy,
                    popular: newItemPopular,
                    available: true,
                    sizes
                  };

                  try {
                    await saveMenuItemToServer(item);
                    alert('Menu item added successfully.');
                    setNewItemId('');
                    setNewItemName('');
                    setNewItemDesc('');
                    setNewItemPrice('');
                    setNewItemImage('');
                    setIsAddingItem(false);
                    onRefresh();
                  } catch (err) {
                    alert('Failed to save menu item.');
                  }
                }}
                className="bg-red-650 hover:bg-red-500 text-white rounded-2xl px-6 py-3.5 text-xs font-black uppercase tracking-widest transition-premium"
              >
                Save Item
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {menuItems.map((item) => (
            <div key={item.id} className={`rounded-2xl p-4 flex gap-4 shadow-2xl glass-card transition-premium ${!item.available ? 'opacity-50 grayscale-[30%] border border-red-500/20' : ''}`}>
              <img src={item.image} className="w-20 h-20 rounded-xl object-cover" onError={(e) => { e.currentTarget.src = '/icon-192.png'; }} />
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <div className="font-bold flex items-center gap-2">
                    {item.name}
                    {item.vegetarian && <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" title="Vegetarian"></span>}
                  </div>
                  <div className="text-xs text-slate-400 capitalize">{item.category}</div>
                  
                  {item.sizes && item.sizes.length > 0 ? (
                    <div className="mt-2 space-y-1.5">
                      {item.sizes.map((sz, idx) => (
                        <div key={sz.label} className="flex items-center justify-between gap-2 text-xs text-slate-300">
                          <span>{sz.label}:</span>
                          <div className="flex items-center gap-1">
                            <span className="text-slate-500 font-bold">Rs</span>
                            <input
                              type="number"
                              defaultValue={sz.price}
                              onBlur={(e) => updateSizePrice(item, idx, parseFloat(e.target.value))}
                              className="w-16 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-right text-white font-bold outline-none focus:border-red-500/80 transition-premium"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                      <span>Price:</span>
                      <div className="flex items-center gap-1">
                        <span className="text-slate-500 font-bold">Rs</span>
                        <input
                          type="number"
                          defaultValue={item.price}
                          onBlur={(e) => updateItemPrice(item, parseFloat(e.target.value))}
                          className="w-16 bg-slate-900 border border-white/10 rounded px-1.5 py-0.5 text-right text-white font-bold outline-none focus:border-red-500/80 transition-premium"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex justify-between items-center">
                  <button
                    onClick={() => toggleItemAvailability(item)}
                    className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-premium ${
                      item.available ? 'bg-green-600/20 border border-green-500 text-green-300 hover:bg-green-600/35' : 'bg-red-600/20 border border-red-500 text-red-300 hover:bg-red-650/35'
                    }`}
                  >
                    {item.available ? 'In Stock' : 'Out of Stock'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (activeTab === 'outlets') {
    return (
      <section className="relative mx-auto max-w-6xl p-4 animate-fade-in">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-display text-2xl font-bold">Outlets Configuration</h3>
          {session.role === 'admin' && (
            <button
              onClick={() => {
                setIsAddingOutlet(true);
                setEditingOutlet(null);
                setOutletName('');
                setOutletAddress('');
                setOutletPhone('');
                setOutletLat('26.85');
                setOutletLng('75.80');
                setOutletRadius('7');
                setOutletFreeRadius('3');
                setOutletMinOrder('150');
                setOutletIncrementPerKm('0');
                setOutletChargePerKm('15');
                setOutletManager('');
              }}
              className="rounded-xl bg-red-650 hover:bg-red-600 text-white font-bold px-3 py-1.5 text-[10px] uppercase tracking-wider transition-premium active:scale-95"
            >
              ➕ Add Outlet
            </button>
          )}
        </div>

        {/* Add Outlet Form */}
        {isAddingOutlet && (
          <div className="mb-6 p-5 border border-white/10 bg-white/[0.04] rounded-3xl space-y-4 animate-slide-up">
            <h4 className="text-lg font-display font-bold text-red-300">Create New Outlet</h4>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Outlet Name</label>
                <input type="text" placeholder="e.g. Malviya Nagar" value={outletName} onChange={e => setOutletName(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Phone Number</label>
                <input type="text" placeholder="e.g. 9829012345" value={outletPhone} onChange={e => setOutletPhone(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Manager Name</label>
                <input type="text" placeholder="e.g. Rajesh Kumar" value={outletManager} onChange={e => setOutletManager(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Address</label>
              <input type="text" placeholder="e.g. Plot 15, Sector 5, Malviya Nagar" value={outletAddress} onChange={e => setOutletAddress(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
            </div>
            <div className="grid gap-4 sm:grid-cols-5">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Latitude</label>
                <input type="number" step="0.0001" value={outletLat} onChange={e => setOutletLat(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Longitude</label>
                <input type="number" step="0.0001" value={outletLng} onChange={e => setOutletLng(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Del. Radius (km)</label>
                <input type="number" value={outletRadius} onChange={e => setOutletRadius(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Free Radius (km)</label>
                <input type="number" value={outletFreeRadius} onChange={e => setOutletFreeRadius(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Free Del. Min Order (Rs)</label>
                <input type="number" value={outletMinOrder} onChange={e => setOutletMinOrder(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Delivery Charge Per Km (Rs)</label>
                <input type="number" value={outletChargePerKm} onChange={e => setOutletChargePerKm(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Min Order Increment Per Km (Rs)</label>
                <input type="number" value={outletIncrementPerKm} onChange={e => setOutletIncrementPerKm(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setIsAddingOutlet(false)}
                className="px-4 py-2 rounded-xl text-[10px] font-bold uppercase bg-white/5 text-slate-400 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!outletName.trim() || !outletPhone.trim()) {
                    alert('Name and Phone are required.');
                    return;
                  }
                  const newOutlet: OutletConfig = {
                    id: `outlet_${Date.now()}`,
                    enabled: true,
                    name: outletName.trim(),
                    address: outletAddress.trim() || undefined,
                    phone: outletPhone.trim(),
                    latitude: parseFloat(outletLat) || 26.85,
                    longitude: parseFloat(outletLng) || 75.80,
                    deliveryRadiusKm: parseFloat(outletRadius) || 7,
                    freeDeliveryRadiusKm: parseFloat(outletFreeRadius) || 3,
                    freeDeliveryMinimumOrder: parseFloat(outletMinOrder) || 150,
                    minimumOrderIncrementPerKm: parseFloat(outletIncrementPerKm) || 0,
                    deliveryChargePerKm: parseFloat(outletChargePerKm) || 15,
                    managerName: outletManager.trim() || undefined,
                  };
                  try {
                    await saveOutletToServer(newOutlet);
                    alert('Outlet created successfully.');
                    setIsAddingOutlet(false);
                    onRefresh();
                  } catch {
                    alert('Failed to save outlet.');
                  }
                }}
                className="px-4 py-2 rounded-xl text-[10px] font-bold uppercase bg-green-700 hover:bg-green-600 text-white"
              >
                Create Outlet
              </button>
            </div>
          </div>
        )}

        {/* Edit Outlet Form */}
        {editingOutlet && (
          <div className="mb-6 p-5 border border-white/10 bg-white/[0.04] rounded-3xl space-y-4 animate-slide-up">
            <h4 className="text-lg font-display font-bold text-red-300">Edit Outlet: {editingOutlet.name}</h4>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Outlet Name</label>
                <input type="text" value={outletName} onChange={e => setOutletName(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Phone Number</label>
                <input type="text" value={outletPhone} onChange={e => setOutletPhone(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Manager Name</label>
                <input type="text" value={outletManager} onChange={e => setOutletManager(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Address</label>
              <input type="text" value={outletAddress} onChange={e => setOutletAddress(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
            </div>
            <div className="grid gap-4 sm:grid-cols-5">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Latitude</label>
                <input type="number" step="0.0001" value={outletLat} onChange={e => setOutletLat(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Longitude</label>
                <input type="number" step="0.0001" value={outletLng} onChange={e => setOutletLng(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Del. Radius (km)</label>
                <input type="number" value={outletRadius} onChange={e => setOutletRadius(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Free Radius (km)</label>
                <input type="number" value={outletFreeRadius} onChange={e => setOutletFreeRadius(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Free Del. Min Order (Rs)</label>
                <input type="number" value={outletMinOrder} onChange={e => setOutletMinOrder(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Delivery Charge Per Km (Rs)</label>
                <input type="number" value={outletChargePerKm} onChange={e => setOutletChargePerKm(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Min Order Increment Per Km (Rs)</label>
                <input type="number" value={outletIncrementPerKm} onChange={e => setOutletIncrementPerKm(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditingOutlet(null)}
                className="px-4 py-2 rounded-xl text-[10px] font-bold uppercase bg-white/5 text-slate-400 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!outletName.trim() || !outletPhone.trim()) {
                    alert('Name and Phone are required.');
                    return;
                  }
                  const updated: OutletConfig = {
                    ...editingOutlet,
                    name: outletName.trim(),
                    address: outletAddress.trim() || undefined,
                    phone: outletPhone.trim(),
                    latitude: parseFloat(outletLat) || 26.85,
                    longitude: parseFloat(outletLng) || 75.80,
                    deliveryRadiusKm: parseFloat(outletRadius) || 7,
                    freeDeliveryRadiusKm: parseFloat(outletFreeRadius) || 3,
                    freeDeliveryMinimumOrder: parseFloat(outletMinOrder) || 150,
                    minimumOrderIncrementPerKm: parseFloat(outletIncrementPerKm) || 0,
                    deliveryChargePerKm: parseFloat(outletChargePerKm) || 15,
                    managerName: outletManager.trim() || undefined,
                  };
                  try {
                    await saveOutletToServer(updated);
                    alert('Outlet updated successfully.');
                    setEditingOutlet(null);
                    onRefresh();
                  } catch {
                    alert('Failed to update outlet.');
                  }
                }}
                className="px-4 py-2 rounded-xl text-[10px] font-bold uppercase bg-green-700 hover:bg-green-600 text-white"
              >
                Save Changes
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {outlets.map((outlet) => (
            <div key={outlet.id} className={`rounded-3xl p-5 border border-white/10 shadow-2xl glass-card transition-premium flex flex-col justify-between ${!outlet.enabled ? 'opacity-40 grayscale-[20%]' : ''}`}>
              <div>
                <div className="flex justify-between items-center mb-3">
                  <span className="text-lg font-display font-bold">{outlet.name}</span>
                  <button
                    onClick={() => toggleOutletEnabled(outlet)}
                    className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-premium ${
                      outlet.enabled ? 'bg-green-600/20 border border-green-500 text-green-300 hover:bg-green-600/45 animate-fade-in' : 'bg-red-600/20 border border-red-500 text-red-300 hover:bg-red-650/45 animate-fade-in'
                    }`}
                  >
                    {outlet.enabled ? 'Live' : 'Inactive'}
                  </button>
                </div>
                <p className="text-xs text-slate-400 font-medium mb-3">📍 Address: {outlet.address || 'Not specified'}</p>
                <div className="text-xs text-slate-350 space-y-1 font-semibold mb-4">
                  <div>Phone: <span className="text-white font-bold">{outlet.phone}</span></div>
                  {outlet.managerName && <div>Manager: <span className="text-white font-bold">{outlet.managerName}</span></div>}
                  <div>Coords: <span className="text-white/80">{outlet.latitude}, {outlet.longitude}</span></div>
                  <div>Radius: <span className="text-red-400 font-bold">{outlet.deliveryRadiusKm} Km</span> (Free under {outlet.freeDeliveryRadiusKm} Km)</div>
                  <div>Min Order Free Delivery: <span className="text-green-400 font-bold">Rs {outlet.freeDeliveryMinimumOrder}</span></div>
                  <div>Charges: <span className="text-orange-400 font-bold">Rs {outlet.deliveryChargePerKm}/km</span> (+ Rs {outlet.minimumOrderIncrementPerKm}/km min order step)</div>
                </div>
              </div>
              {session.role === 'admin' && (
                <div className="mt-2 pt-3 border-t border-white/10 flex gap-2">
                  <button
                    onClick={() => startEditOutlet(outlet)}
                    className="rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 text-[10px] uppercase tracking-wider transition-premium active:scale-95"
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm(`Are you sure you want to DELETE the outlet "${outlet.name}"? This action cannot be undone.`)) {
                        try {
                          await deleteOutletFromServer(outlet.id);
                          alert('Outlet deleted successfully.');
                          onRefresh();
                        } catch (err: any) {
                          alert(err.message || 'Failed to delete outlet.');
                        }
                      }
                    }}
                    className="rounded-xl bg-red-850 hover:bg-red-700 text-white font-bold px-3 py-1.5 text-[10px] uppercase tracking-wider transition-premium active:scale-95"
                  >
                    🗑️ Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    );
  }

  const sundayDhamakaCount = React.useMemo(() => {
    if (!orders) return 0;
    return orders.filter((order) =>
      order.items.some((item) => item.appliedOfferId === 'offer-sunday-dhamaka' || item.sourceOfferId === 'offer-sunday-dhamaka')
    ).length;
  }, [orders]);

  if (activeTab === 'offers') {
    return (
      <section className="relative mx-auto max-w-6xl p-4 animate-fade-in">
        <h3 className="mb-4 font-display text-2xl font-bold">Offers & Disount Rules</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {offers.map((offer) => (
            <div key={offer.id} className={`rounded-3xl p-5 border border-white/10 shadow-2xl glass-card transition-premium ${!offer.enabled ? 'opacity-40 grayscale-[20%]' : ''}`}>
              <div className="flex justify-between items-center mb-3">
                <span className="text-lg font-display font-bold">{offer.offerTitle}</span>
                <button
                  onClick={() => toggleOfferEnabled(offer)}
                  className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-premium ${
                    offer.enabled ? 'bg-green-600/20 border border-green-500 text-green-300 hover:bg-green-600/40' : 'bg-red-600/20 border border-red-500 text-red-300 hover:bg-red-650/40'
                  }`}
                >
                  {offer.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
              <p className="text-xs text-slate-400 font-medium mb-3">💬 Display: {offer.displayText}</p>
              <div className="text-xs text-slate-300 space-y-1 font-semibold">
                <div>Condition: <span className="text-red-400 font-bold">{offer.condition}</span></div>
                {offer.id === 'offer-sunday-dhamaka' && (
                  <div className="mt-2 text-emerald-400 font-bold">
                    🎉 Total Sunday Dhamaka Orders: {sundayDhamakaCount}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return null;
};
