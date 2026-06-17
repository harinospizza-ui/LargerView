import React, { useRef, useState } from 'react';
import { CustomerProfile } from '../types';

interface CustomerLoginModalProps {
  onSave: (profile: CustomerProfile) => void;
  onAdminTrigger?: () => void;
}

const CustomerLoginModal: React.FC<CustomerLoginModalProps> = ({ onSave, onAdminTrigger }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const logoHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const submit = () => {
    if (!name.trim() || !phone.trim()) {
      alert('Please enter your name and mobile number.');
      return;
    }

    onSave({
      id: `${phone.replace(/\D/g, '') || Date.now()}-${Date.now()}`,
      name: name.trim(),
      phone: phone.trim(),
      loginMethod: 'phone',
      verified: false,
      createdAt: new Date().toISOString(),
    });
  };

  const startAdminHold = () => {
    if (!onAdminTrigger) return;
    if (logoHoldTimer.current) clearTimeout(logoHoldTimer.current);
    logoHoldTimer.current = setTimeout(() => {
      navigator.vibrate?.(200);
      onAdminTrigger();
    }, 7000);
  };

  const cancelAdminHold = () => {
    if (!logoHoldTimer.current) return;
    clearTimeout(logoHoldTimer.current);
    logoHoldTimer.current = null;
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-md sm:items-center sm:p-4 animate-slide-up">
      <div className="w-full max-w-md rounded-t-[2rem] bg-white p-6 shadow-2xl sm:rounded-[2rem]">
        <button
          onPointerDown={startAdminHold}
          onPointerUp={cancelAdminHold}
          onPointerCancel={cancelAdminHold}
          onPointerLeave={cancelAdminHold}
          onContextMenu={(event) => event.preventDefault()}
          className="mx-auto block select-none rounded-2xl cursor-pointer"
          aria-label="Harino's"
          style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
        >
          <img src="/icon-192.png" alt="Harino's" className="h-16 w-16 rounded-2xl shadow-xl hover:scale-105 transition-transform" />
        </button>
        <h2 className="mt-4 text-center font-display text-3xl font-bold text-slate-900">Welcome to Harino&apos;s</h2>
        <p className="mt-2 text-center text-sm leading-6 text-slate-500">
          Sign in once. We save your details on this device for future orders.
        </p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Full Name</label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter your name"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 font-bold outline-none focus:border-red-500 focus:bg-white transition-all"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Mobile Number</label>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/[^\d+ ]/g, ''))}
              type="tel"
              inputMode="tel"
              placeholder="Enter 10-digit number"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 font-bold outline-none focus:border-red-500 focus:bg-white transition-all"
            />
          </div>
        </div>

        <button
          onClick={submit}
          className="mt-6 w-full rounded-2xl bg-red-650 bg-red-600 hover:bg-red-500 text-white py-4 text-[11px] font-black uppercase tracking-widest transition-premium active:scale-95 shadow-lg shadow-red-200"
        >
          Save & Continue
        </button>
      </div>
    </div>
  );
};

export default CustomerLoginModal;
