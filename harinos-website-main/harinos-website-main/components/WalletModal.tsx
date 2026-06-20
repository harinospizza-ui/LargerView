import React, { useState } from 'react';
import { CustomerProfile, WalletTransaction } from '../types';
import { StorageService } from '../services/storage';
import { getServerCustomers, verifyServerCustomer, saveWalletTransactionToServer, saveCustomerToServer } from '../services/orderApi';
import { copyTextToClipboard } from '../services/browserSupport';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerProfile: CustomerProfile;
  onProfileChange: (profile: CustomerProfile) => void;
  showNotification: (msg: string | { title: string; message: string; type?: 'success' | 'info' | 'warning' | 'error' }) => void;
  onProceedToPayment: (amount: number) => void;
  instagramUrl?: string;
}

export const WalletModal: React.FC<WalletModalProps> = ({
  isOpen,
  onClose,
  customerProfile,
  onProfileChange,
  showNotification,
  onProceedToPayment,
  instagramUrl = '',
}) => {
  const [inputOtp, setInputOtp] = useState('');
  const [inputReferralCode, setInputReferralCode] = useState('');
  const [topUpAmount, setTopUpAmount] = useState('');

  if (!isOpen) return null;

  const handleShare = async () => {
    const isVerified = customerProfile.verified === true || String(customerProfile.verified) === 'true';
    const shareText = isVerified && customerProfile.referralCode
      ? `Hey! Order from Harino's Pizza and use my referral code ${customerProfile.referralCode} to get reward points: https://harinos.store`
      : `Check out Harino's Pizza at https://harinos.store`;

    const shareData = {
      title: "Harino's Pizza",
      text: shareText,
      url: 'https://harinos.store',
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (error) {
        console.log('Error sharing:', error);
      }
      return;
    }

    try {
      const didCopy = await copyTextToClipboard(shareText);
      if (didCopy) {
        showNotification({ title: 'Link Copied', message: 'Referral message copied to clipboard.', type: 'success' });
        return;
      }
      alert('Visit us at harinos.store.');
    } catch {
      alert('Visit us at harinos.store.');
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center p-0 sm:items-center sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-xl" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-t-[2.5rem] bg-white p-6 text-slate-900 shadow-2xl sm:rounded-[3rem] animate-slide-up max-h-[90vh] overflow-y-auto hide-scrollbar">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200 sm:hidden" />

        <div className="flex justify-between items-center mb-6">
          <div>
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Harino's Customer Profile</span>
            <h3 className="text-2xl font-display font-bold text-slate-900">Profile & Wallet</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-550 font-bold hover:text-red-500"
          >
            &times;
          </button>
        </div>

        {/* Profile Picture Upload Section */}
        <div className="flex flex-col items-center mb-6">
          <div className="relative group">
            <div className="w-24 h-24 rounded-full border-4 border-slate-100 shadow-xl overflow-hidden bg-slate-50 flex items-center justify-center">
              {customerProfile.avatar ? (
                <img src={customerProfile.avatar} className="w-full h-full object-cover" alt="Profile" />
              ) : (
                <span className="text-4xl">👤</span>
              )}
            </div>
            <label className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center cursor-pointer shadow-lg hover:bg-red-655 transition-colors">
              <span className="text-xs">📷</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (uploadEvent) => {
                      const base64 = uploadEvent.target?.result as string;
                      const updated = { ...customerProfile, avatar: base64 };
                      StorageService.saveCustomerProfile(updated);
                      onProfileChange(updated);
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              />
            </label>
          </div>

          {/* Referral Code */}
          {(customerProfile.verified === true || String(customerProfile.verified) === 'true') && customerProfile.referralCode && (
            <div className="mt-3 text-xs font-black uppercase tracking-widest bg-red-100 text-red-700 px-3 py-1 rounded-full border border-red-200/50">
              Referral Code: {customerProfile.referralCode}
            </div>
          )}

          <div className="mt-3 flex items-center gap-1.5">
            <span className="font-display font-black text-xl text-slate-900">{customerProfile.name}</span>
            {(customerProfile.verified === true || String(customerProfile.verified) === 'true') && (
              <span className="inline-flex items-center justify-center bg-blue-500 text-white rounded-full w-4.5 h-4.5 text-[9px] font-black">✓</span>
            )}
          </div>
          <span className="text-xs text-slate-500 font-bold">📞 {customerProfile.phone}</span>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-100 rounded-3xl p-5 mb-4 text-center shadow-inner">
          <div className="text-[10px] font-black uppercase tracking-widest text-orange-800 mb-1">Wallet Balance</div>
          <span className="text-3xl font-display font-black text-orange-950">Rs {(customerProfile.walletBalance ?? 0).toFixed(2)}</span>
          <div className="mt-2 text-[9px] font-black uppercase tracking-[0.2em] text-orange-850">
            Reward Points: {customerProfile.rewardPoints ?? 0} pts (Rs {((customerProfile.rewardPoints ?? 0) * 0.1).toFixed(2)})
          </div>
        </div>

        {/* OTP Verification Section */}
        {!(customerProfile.verified === true || String(customerProfile.verified) === 'true') && (
          <div className="mb-6 p-4 border border-orange-100 bg-orange-50/30 rounded-2xl">
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-550 mb-2">
              Verify Your Account
            </label>
            <p className="text-[11px] text-slate-600 mb-3 font-medium">
              Enter the 6-digit OTP shared by the Admin/Manager (via WhatsApp or SMS) to verify your profile.
            </p>
            <div className="relative flex items-center border border-slate-200 rounded-xl focus-within:border-red-500 bg-white p-1">
              <input
                type="text"
                placeholder="Enter 6-digit OTP"
                value={inputOtp}
                onChange={(e) => setInputOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full pl-3 pr-24 py-2 text-sm font-bold tracking-widest outline-none bg-transparent"
              />
              <button
                type="button"
                onClick={async () => {
                  const otpVal = inputOtp.trim();
                  if (otpVal.length !== 6) {
                    showNotification({
                      title: 'Invalid OTP',
                      message: 'Please enter a 6-digit number.',
                      type: 'warning'
                    });
                    return;
                  }

                  try {
                    const result = await verifyServerCustomer(customerProfile.id, otpVal);
                    if (result) {
                      StorageService.markCustomerVerified(customerProfile.id);
                      const updated = {
                        ...customerProfile,
                        verified: true,
                        referralCode: result.referralCode,
                        otp: undefined
                      };
                      StorageService.saveCustomerProfile(updated);
                      onProfileChange(updated);

                      showNotification({
                        title: 'Account Verified!',
                        message: `Your profile is verified. Code: ${result.referralCode ?? ''}`,
                        type: 'success'
                      });
                      setInputOtp('');
                    } else {
                      showNotification({
                        title: 'Verification Failed',
                        message: 'Could not verify customer profile.',
                        type: 'error'
                      });
                    }
                  } catch (err: any) {
                    showNotification({
                      title: 'Verification Failed',
                      message: err.message || 'OTP validation failed.',
                      type: 'error'
                    });
                  }
                }}
                className="absolute right-1 top-1 bottom-1 px-4 bg-red-600 hover:bg-red-500 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 shadow-md"
              >
                Verify
              </button>
            </div>
          </div>
        )}

        {/* Referral Code Entry */}
        {(customerProfile.verified === true || String(customerProfile.verified) === 'true') && (
          <div className="mb-6 p-4 border border-slate-100 bg-slate-50/50 rounded-2xl">
            {(() => {
              const attemptsRemaining = customerProfile.referralAttemptsRemaining !== undefined 
                ? customerProfile.referralAttemptsRemaining 
                : (3 - (customerProfile.referralAttempts ?? 0));
              const isUsed = !!(customerProfile.referralCodeUsed || customerProfile.referralApplied);
              const isLocked = !!(customerProfile.referralLocked || attemptsRemaining <= 0 || isUsed);

              if (isUsed) {
                return (
                  <div className="text-xs font-bold text-green-650 text-green-600 text-center py-2">
                    ✓ Referral code applied successfully.
                  </div>
                );
              }

              if (isLocked || attemptsRemaining <= 0) {
                return (
                  <div className="text-xs font-bold text-red-500 text-center py-2">
                    ✗ Referral code entry is permanently locked.
                  </div>
                );
              }

              return (
                <>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                    Have a Referral Code? (Attempts remaining: {attemptsRemaining})
                  </label>
                  <div className="relative flex items-center border border-slate-200 rounded-xl focus-within:border-red-500 bg-white p-1">
                    <input
                      type="text"
                      placeholder="Enter 5-digit code"
                      value={inputReferralCode}
                      onChange={(e) => setInputReferralCode(e.target.value.toUpperCase().slice(0, 5))}
                      className="w-full pl-3 pr-20 py-2 text-sm font-bold uppercase tracking-wider outline-none bg-transparent text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const code = inputReferralCode.trim().toUpperCase();
                        if (!code) return;
                        if (code === customerProfile.referralCode) {
                          alert('You cannot use your own referral code.');
                          return;
                        }

                        try {
                          const allCustomers = await getServerCustomers();
                          const referrer = allCustomers.find((c) => c.referralCode === code && c.verified);

                          if (referrer) {
                            const updatedReferrer = { ...referrer, rewardPoints: (referrer.rewardPoints ?? 0) + 100 };
                            const tx: WalletTransaction = {
                              id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                              customerId: referrer.id,
                              customerName: referrer.name,
                              customerPhone: referrer.phone,
                              amount: 10,
                              type: 'reward',
                              status: 'completed',
                              createdAt: new Date().toISOString()
                            };
                            await saveWalletTransactionToServer(tx);
                            await saveCustomerToServer(updatedReferrer);

                            const updatedSelf: CustomerProfile = {
                              ...customerProfile,
                              referralApplied: true,
                              referralCodeUsed: true,
                              referralLocked: true,
                              referredBy: code,
                              referralAppliedAt: new Date().toISOString()
                            };
                            await saveCustomerToServer(updatedSelf);
                            StorageService.saveCustomerProfile(updatedSelf);
                            onProfileChange(updatedSelf);
                            setInputReferralCode('');
                            showNotification({
                              title: 'Referral Applied',
                              message: 'Referral code applied! Reward sent to referrer.',
                              type: 'success'
                            });
                          } else {
                            const nextAttemptsRemaining = attemptsRemaining - 1;
                            const updatedSelf: CustomerProfile = {
                              ...customerProfile,
                              referralAttempts: (customerProfile.referralAttempts ?? 0) + 1,
                              referralAttemptsRemaining: nextAttemptsRemaining,
                              referralLocked: nextAttemptsRemaining <= 0,
                              referralApplied: nextAttemptsRemaining <= 0 ? true : undefined
                            };
                            await saveCustomerToServer(updatedSelf);
                            StorageService.saveCustomerProfile(updatedSelf);
                            onProfileChange(updatedSelf);
                            showNotification({
                              title: 'Invalid Code',
                              message: `Invalid referral code. Remaining attempts: ${nextAttemptsRemaining}`,
                              type: 'warning'
                            });
                          }
                        } catch (err: any) {
                          showNotification({ title: 'Error', message: err.message || 'Failed to apply referral.', type: 'error' });
                        }
                      }}
                      className="absolute right-1 top-1 bottom-1 px-4 bg-red-600 hover:bg-red-500 text-white rounded-lg text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 shadow-md"
                    >
                      Apply
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Top-up Form */}
        <div className="space-y-4">
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Top-up Wallet</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-400">Rs</span>
            <input
              type="number"
              placeholder="Enter amount"
              value={topUpAmount}
              onChange={(e) => setTopUpAmount(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-2xl font-bold text-slate-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/20"
            />
          </div>

          <div className="grid grid-cols-4 gap-2">
            {['100', '200', '500', '1000'].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setTopUpAmount(amt)}
                className="py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-700 hover:border-red-500 hover:bg-red-50 active:scale-95 transition-premium"
              >
                +Rs {amt}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              const amount = parseFloat(topUpAmount);
              if (isNaN(amount) || amount <= 0) {
                alert('Please enter a valid amount.');
                return;
              }
              onProceedToPayment(amount);
            }}
            className="w-full bg-red-600 hover:bg-red-500 text-white py-3.5 rounded-2xl text-[10px] font-bold uppercase tracking-[0.2em] shadow-lg transition-premium active:scale-95 text-center font-black mt-2"
          >
            Proceed to Payment
          </button>
        </div>

        <div className="mt-6 pt-5 border-t border-slate-100">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3 text-center">Share & Earn 100 Pts</div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <button
              type="button"
              onClick={handleShare}
              className="flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 px-4 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-700 transition-all active:scale-95"
            >
              Share App
            </button>
            <a
              href="https://wa.me/917818958571?text=Hello%20Harinos%20Support"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 border border-slate-200 hover:bg-slate-50 px-4 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest text-slate-700 transition-all active:scale-95 text-center"
            >
              💬 Need Help
            </a>
          </div>

          <div className={`grid gap-3 ${instagramUrl ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <button
              type="button"
              onClick={() => {
                const shareText = `Order from Harino's Pizza: https://harinos.store`;
                window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`, '_blank');
              }}
              className="flex flex-col items-center p-3 rounded-2xl bg-white border border-slate-150 hover:bg-red-50/20 active:scale-95 transition-premium shadow-sm text-center"
            >
              <span className="text-xs text-[#25D366] font-bold">WhatsApp</span>
            </button>
            <button
              type="button"
              onClick={() => {
                window.open(`https://t.me/share/url?url=https://harinos.store`, '_blank');
              }}
              className="flex flex-col items-center p-3 rounded-2xl bg-white border border-slate-150 hover:bg-red-50/20 active:scale-95 transition-premium shadow-sm text-center"
            >
              <span className="text-xs text-[#0088cc] font-bold">Telegram</span>
            </button>
            {instagramUrl && (
              <button
                type="button"
                onClick={() => {
                  window.open(instagramUrl, '_blank');
                }}
                className="flex flex-col items-center p-3 rounded-2xl bg-white border border-slate-150 hover:bg-red-50/20 active:scale-95 transition-premium shadow-sm text-center"
              >
                <span className="text-xs text-[#E1306C] font-bold">Instagram</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
