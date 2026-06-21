import React, { useEffect, useRef, useState } from 'react';
import { CustomerProfile } from '../types';
import { initCustomerLogin, verifyCustomerLogin } from '../services/orderApi';

const checkBusinessHours = (): boolean => {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const ist = new Date(utc + (3600000 * 5.5)); // IST is UTC+5.5
  const hours = ist.getHours();
  return hours >= 11 && hours < 21;
};

interface CustomerLoginModalProps {
  onSave: (profile: CustomerProfile) => void;
  onAdminTrigger?: () => void;
}

type ModalMode = 'select' | 'register' | 'login' | 'otp';

const CustomerLoginModal: React.FC<CustomerLoginModalProps> = ({ onSave, onAdminTrigger }) => {
  const [mode, setMode] = useState<ModalMode>('select');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [requestId, setRequestId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!checkBusinessHours()) {
      setError("Harino's online ordering is available between 11:00 AM and 9:00 PM.");
    }
  }, []);
  
  const logoHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleSendOtp = async () => {
    setError('');
    
    if (!checkBusinessHours()) {
      setError("Harino's online ordering is available between 11:00 AM and 9:00 PM.");
      return;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    
    if (mode === 'register' && !name.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (cleanPhone.length !== 10) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }

    setLoading(true);
    try {
      const isRegister = mode === 'register';
      const result = await initCustomerLogin(phone, isRegister ? name.trim() : undefined, isRegister);
      
      if (result.success) {
        setMode('otp');
        if (result.requestId) {
          setRequestId(result.requestId);
        }
        alert(result.message || 'Verification request submitted. Please wait while we verify your number.');
      } else {
        setError(result.message || 'Failed to send OTP. Please try again.');
      }
    } catch (err: any) {
      setError(err.message || 'Network error initiating login.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setError('');

    if (!checkBusinessHours()) {
      setError("Harino's online ordering is available between 11:00 AM and 9:00 PM.");
      return;
    }

    if (otp.trim().length !== 6) {
      setError('Please enter the 6-digit OTP code.');
      return;
    }

    setLoading(true);
    try {
      const result = await verifyCustomerLogin(requestId, otp.trim());
      if (result.success && result.customer) {
        onSave(result.customer);
      } else {
        setError(result.message || 'Incorrect OTP. Please try again.');
      }
    } catch (err: any) {
      setError(err.message || 'OTP verification failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/80 p-0 backdrop-blur-md sm:items-center sm:p-4 animate-slide-up">
      <div className="w-full max-w-md rounded-t-[2.5rem] bg-white p-6 shadow-2xl sm:rounded-[2.5rem] transition-all relative overflow-hidden border border-slate-100">
        
        {/* Brand Logo Header */}
        <button
          onPointerDown={startAdminHold}
          onPointerUp={cancelAdminHold}
          onPointerCancel={cancelAdminHold}
          onPointerLeave={cancelAdminHold}
          onContextMenu={(event) => event.preventDefault()}
          className="mx-auto block select-none rounded-2xl cursor-pointer mt-2"
          aria-label="Harino's"
          style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
        >
          <img src="/icon-192.png" alt="Harino's" className="h-16 w-16 rounded-2xl shadow-xl hover:scale-105 transition-transform" />
        </button>

        <h2 className="mt-4 text-center font-display text-3xl font-black tracking-tight text-slate-900">
          {mode === 'select' && "Welcome to Harino's"}
          {mode === 'register' && "Create Account"}
          {mode === 'login' && "Welcome Back"}
          {mode === 'otp' && "Verify Mobile"}
        </h2>
        
        <p className="mt-2 text-center text-xs leading-5 text-slate-500 font-medium px-4">
          {mode === 'select' && "Enjoy fresh, hot, custom-made pizzas delivered right to your door. Choose an option to get started."}
          {mode === 'register' && "Enter your details to create an account and access your pizza wallet."}
          {mode === 'login' && "Enter your registered mobile number to log into your account."}
          {mode === 'otp' && "Verification request submitted. Please wait while we verify your number. Once you receive your OTP via WhatsApp, enter it below."}
        </p>

        {error && (
          <div className="mt-4 mx-2 p-3 bg-red-50 border border-red-150 rounded-2xl text-xs font-bold text-red-700 text-center animate-pulse">
            ⚠️ {error}
          </div>
        )}

        {/* 1. SELECTION MODE */}
        {mode === 'select' && (
          <div className="mt-6 space-y-3.5 px-2">
            <button
              onClick={() => setMode('register')}
              className="w-full rounded-2xl bg-red-650 bg-red-600 hover:bg-red-500 text-white py-4 text-[11px] font-black uppercase tracking-widest transition-premium active:scale-95 shadow-lg shadow-red-200"
            >
              🆕 Create Account
            </button>
            <button
              onClick={() => setMode('login')}
              className="w-full rounded-2xl bg-slate-900 hover:bg-slate-800 text-white py-4 text-[11px] font-black uppercase tracking-widest transition-premium active:scale-95 shadow-lg shadow-slate-900/10"
            >
              🔑 Login to Existing Account
            </button>
          </div>
        )}

        {/* 2. REGISTRATION MODE */}
        {mode === 'register' && (
          <div className="mt-6 space-y-4">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 ml-1">Full Name</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Enter your name"
                disabled={loading}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 font-bold text-slate-800 outline-none focus:border-red-500 focus:bg-white transition-all text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 ml-1">Mobile Number</label>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/[^\d+ ]/g, ''))}
                type="tel"
                inputMode="tel"
                placeholder="Enter 10-digit number"
                disabled={loading}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 font-bold text-slate-800 outline-none focus:border-red-500 focus:bg-white transition-all text-sm"
              />
            </div>
            
            <button
              onClick={handleSendOtp}
              disabled={loading || !checkBusinessHours()}
              className="w-full rounded-2xl bg-red-650 bg-red-600 hover:bg-red-500 text-white py-4 text-[11px] font-black uppercase tracking-widest transition-premium active:scale-95 shadow-lg shadow-red-200 disabled:opacity-50"
            >
              {loading ? "Submitting..." : "Request Verification"}
            </button>

            <div className="text-center mt-4">
              <button
                onClick={() => { setMode('login'); setError(''); }}
                className="text-[10px] font-black uppercase tracking-wider text-slate-450 hover:text-red-600 transition-colors"
              >
                Already Have An Account? Login
              </button>
            </div>
          </div>
        )}

        {/* 3. LOGIN MODE */}
        {mode === 'login' && (
          <div className="mt-6 space-y-4">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 ml-1">Mobile Number</label>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/[^\d+ ]/g, ''))}
                type="tel"
                inputMode="tel"
                placeholder="Enter 10-digit number"
                disabled={loading}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 font-bold text-slate-800 outline-none focus:border-red-500 focus:bg-white transition-all text-sm"
              />
            </div>
            
            <button
              onClick={handleSendOtp}
              disabled={loading || !checkBusinessHours()}
              className="w-full rounded-2xl bg-red-655 bg-red-600 hover:bg-red-500 text-white py-4 text-[11px] font-black uppercase tracking-widest transition-premium active:scale-95 shadow-lg shadow-red-200 disabled:opacity-50"
            >
              {loading ? "Submitting..." : "Request Verification"}
            </button>

            <div className="text-center mt-4">
              <button
                onClick={() => { setMode('register'); setError(''); }}
                className="text-[10px] font-black uppercase tracking-wider text-slate-455 hover:text-red-600 transition-colors"
              >
                New Customer? Create Account
              </button>
            </div>
          </div>
        )}

        {/* 4. OTP MODE */}
        {mode === 'otp' && (
          <div className="mt-6 space-y-4">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 ml-1 text-center">Enter 6-Digit OTP</label>
              <input
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="0 0 0 0 0 0"
                disabled={loading}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 font-black text-slate-900 outline-none focus:border-red-500 focus:bg-white transition-all text-center tracking-[0.6em] text-lg font-mono"
              />
            </div>
            
            <button
              onClick={handleVerifyOtp}
              disabled={loading || !checkBusinessHours()}
              className="w-full rounded-2xl bg-red-650 bg-red-600 hover:bg-red-500 text-white py-4 text-[11px] font-black uppercase tracking-widest transition-premium active:scale-95 shadow-lg shadow-red-200 disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Verify & Continue"}
            </button>

            <div className="text-center mt-4">
              <button
                onClick={() => { setMode(name ? 'register' : 'login'); setError(''); setOtp(''); }}
                className="text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-900 transition-colors"
              >
                ← Go Back
              </button>
            </div>
          </div>
        )}

        {/* Cancel / Go Back to Select Screen (Only visible if not in select screen) */}
        {mode !== 'select' && (
          <button
            onClick={() => { setMode('select'); setError(''); }}
            disabled={loading}
            className="absolute top-4 right-4 w-8 h-8 rounded-full border border-slate-100 bg-slate-50 flex items-center justify-center text-slate-450 font-bold hover:text-red-500 hover:bg-white transition-colors"
          >
            &times;
          </button>
        )}
      </div>
    </div>
  );
};

export default CustomerLoginModal;
