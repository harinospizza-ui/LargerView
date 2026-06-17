
import React from 'react';
import { Order } from '../types';
import { getDisplayOrderId } from '../App';

interface PastOrdersProps {
  orders: Order[];
  onReorder: (order: Order) => void;
}

const PastOrders: React.FC<PastOrdersProps> = ({ orders, onReorder }) => {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16">
      <div className="flex flex-col items-center mb-12">
        <h2 className="text-5xl font-display font-bold text-slate-900 mb-2">Order History</h2>
        <div className="h-1.5 w-24 bg-red-600 rounded-full"></div>
        <p className="mt-4 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
          Swipe right to go back
        </p>
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-[3rem] shadow-sm border border-orange-100">
          <div className="text-6xl mb-6">📜</div>
          <p className="text-xl font-display font-bold text-slate-400">No past orders yet. Let's start cooking!</p>
        </div>
      ) : (
        <div className="space-y-8">
          {orders.map((order) => (
            <div key={order.id} className="bg-white rounded-[2.5rem] p-8 md:p-10 shadow-sm border border-orange-50 hover:shadow-xl transition-all duration-500">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 pb-6 border-b border-slate-50">
                <div>
                  <div className="flex items-center flex-wrap gap-3 mb-1">
                    <span className="text-xs font-black uppercase tracking-widest text-red-600">Order ID:</span>
                    <span className="font-mono text-slate-900 font-bold">{getDisplayOrderId(order.id)}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                      order.status === 'cancelled' 
                        ? 'bg-slate-100 text-slate-500 border-slate-200' 
                        : order.status === 'done' 
                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200' 
                        : 'bg-amber-100 text-amber-700 border-amber-200'
                    }`}>
                      {(order.status ?? 'new').replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-slate-400 text-sm font-medium">
                    📅 {new Date(order.receivedAt ?? order.date).toLocaleDateString()} {new Date(order.receivedAt ?? order.date).toLocaleTimeString()}
                  </p>
                  {order.distanceKm && (
                    <p className="text-slate-400 text-sm font-medium">📍 {order.distanceKm.toFixed(1)} km away</p>
                  )}
                  {order.outletName && (
                    <p className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                      Routed to {order.outletName}
                    </p>
                  )}
                </div>
                <div className="mt-4 md:mt-0 px-4 py-2 bg-orange-50 rounded-xl">
                  <span className="text-xs font-black uppercase tracking-widest text-orange-600">{order.orderType}</span>
                </div>
              </div>

              <div className="space-y-4 mb-8">
                {order.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center">
                    <div className="flex items-center space-x-4">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div>
                      <span className="text-slate-600 font-medium">
                        <span className="font-bold text-slate-900">{item.quantity}x</span> {item.name}
                      </span>
                    </div>
                    <span className="text-slate-400 text-sm">₹{item.totalPrice}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col md:flex-row justify-between items-center pt-8 border-t border-slate-50">
                <div className="mb-6 md:mb-0">
                  <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 block mb-1">Total Amount</span>
                  <span className="text-3xl font-display font-bold text-slate-900">₹{order.total.toFixed(2)}</span>
                </div>
                <button 
                  onClick={() => onReorder(order)}
                  className="w-full md:w-auto px-10 py-4 bg-slate-900 text-white rounded-2xl font-bold uppercase tracking-widest text-xs hover:bg-red-600 transition-all transform hover:scale-105 active:scale-95 shadow-xl shadow-slate-200 flex items-center justify-center space-x-3"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Re-order Items</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PastOrders;
