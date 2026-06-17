import React, { useEffect, useRef, useState } from 'react';
import { NotificationService } from '../services/notification';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { getNotificationPermission } from '../services/browserSupport';

interface HeaderProps {
  cartCount: number;
  onCartClick: () => void;
  onViewOrders: () => void;
  onViewMenu: () => void;
  activeView: 'menu' | 'orders';
  onShare: () => void;
  onNotificationsEnabled: () => void;
  onAdminTrigger?: () => void;
  customerProfile?: any;
  onWalletClick?: () => void;
}

const Header: React.FC<HeaderProps> = ({
  cartCount,
  onCartClick,
  onViewOrders,
  onViewMenu,
  activeView,
  onShare,
  onNotificationsEnabled,
  onAdminTrigger,
  customerProfile,
  onWalletClick,
}) => {
  const [scrolled, setScrolled] = useState(false);
  const [notifStatus, setNotifStatus] = useState<NotificationPermission>('default');
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [isHoldingLogo, setIsHoldingLogo] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStartedAt = useRef(0);
  const logoUrl = '/icon-192.png';
  const { canPromptInstall, needsIosInstructions, isInstalled, promptInstall } = useInstallPrompt();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);

    const permission = getNotificationPermission();
    if (permission !== 'unsupported') {
      setNotifStatus(permission);
    }

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleRequestNotifs = async () => {
    const granted = await NotificationService.requestPermission();
    setNotifStatus(granted ? 'granted' : 'denied');

    if (granted) {
      NotificationService.show('Alerts Enabled', 'You will now receive order updates and special offers.');
      onNotificationsEnabled();
    }
  };

  const handleInstall = async () => {
    if (canPromptInstall) {
      const outcome = await promptInstall();
      if (outcome === 'accepted') {
        setShowInstallHelp(false);
      }
      return;
    }

    if (needsIosInstructions) {
      setShowInstallHelp((current) => !current);
    }
  };

  const isScrolledOrLight = scrolled || activeView === 'orders';

  const cancelLogoHold = (treatQuickTapAsMenu: boolean) => {
    const elapsed = Date.now() - holdStartedAt.current;
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setIsHoldingLogo(false);
    if (treatQuickTapAsMenu && elapsed < 300) {
      onViewMenu();
    }
  };

  const startLogoHold = () => {
    holdStartedAt.current = Date.now();
    setIsHoldingLogo(true);
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
    }
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      setIsHoldingLogo(false);
      navigator.vibrate?.(200);
      onAdminTrigger?.();
    }, 7000);
  };

  return (
    <nav
      className={`fixed top-0 w-full z-[100] transition-all duration-500 ${
        isScrolledOrLight ? 'bg-white shadow-xl py-2' : 'bg-transparent py-8'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center">
          <button
            onPointerDown={startLogoHold}
            onPointerUp={() => cancelLogoHold(true)}
            onPointerCancel={() => cancelLogoHold(false)}
            onPointerLeave={() => cancelLogoHold(false)}
            onContextMenu={(event) => {
              event.preventDefault();
            }}
            className="flex items-center space-x-3 cursor-pointer group select-none"
            title="Hold for admin"
            style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
          >
            <div
              className={`transition-all duration-500 rounded-2xl flex items-center justify-center overflow-hidden shadow-xl ring-4 ring-white/10 ${
                isScrolledOrLight ? 'w-10 h-10' : 'w-14 h-14'
              } relative`}
            >
              <span
                className="absolute inset-0 rounded-2xl border-2 border-red-500"
                style={{
                  animation: isHoldingLogo ? 'harinosHoldRing 7s linear forwards' : 'none',
                  opacity: isHoldingLogo ? 1 : 0,
                }}
              />
              <img
                src={logoUrl}
                alt="Harino's"
                className="w-full h-full object-cover group-hover:scale-110 transition-transform"
              />
            </div>
            <style>{`
              @keyframes harinosHoldRing {
                from { transform: scale(0.8); opacity: 0.2; box-shadow: 0 0 0 0 rgba(220,38,38,0.7); }
                to { transform: scale(1.25); opacity: 1; box-shadow: 0 0 0 12px rgba(220,38,38,0); }
              }
            `}</style>
            <div className="text-left">
              <span
                className={`block transition-all duration-500 font-display font-bold tracking-tight leading-none ${
                  isScrolledOrLight ? 'text-slate-900 text-xl' : 'text-white text-2xl'
                }`}
              >
                Harino&apos;s
              </span>
              <span
                className={`transition-all duration-500 text-[8px] md:text-[9px] uppercase tracking-[0.25em] font-bold ${
                  isScrolledOrLight ? 'text-red-600' : 'text-red-400'
                }`}
              >
                Because Hari Knows
              </span>
            </div>
          </button>

          <div className="flex items-center space-x-3">
            {customerProfile && onWalletClick && (
              <button
                onClick={onWalletClick}
                className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-bold border transition-premium btn-hover-scale mr-1 ${
                  isScrolledOrLight
                    ? 'bg-slate-50 border-slate-200 text-slate-800 shadow-sm'
                    : 'bg-white/10 border-white/10 text-white backdrop-blur-md'
                }`}
                title="View Profile"
              >
                {customerProfile.avatar ? (
                  <img src={customerProfile.avatar} className="w-5 h-5 rounded-full object-cover" alt="Profile" />
                ) : (
                  <span>👤</span>
                )}
                <span className="font-black">{customerProfile.name.split(' ')[0]}</span>
                {customerProfile.verified && (
                  <span className="inline-flex items-center justify-center bg-blue-500 text-white rounded-full w-3.5 h-3.5 text-[8px] font-black" title="Verified Customer">✓</span>
                )}
              </button>
            )}

            <div className="relative flex items-center space-x-2">
              <button
                onClick={onCartClick}
                className={`relative p-3 md:p-4 rounded-2xl transition-all duration-300 active:scale-90 ${
                  isScrolledOrLight ? 'bg-red-600 text-white shadow-lg shadow-red-500/20' : 'bg-white/10 text-white backdrop-blur-md'
                }`}
                aria-label="View Cart"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
                {cartCount > 0 && (
                  <span
                    className={`absolute -top-1 -right-1 text-[10px] font-black px-2 py-0.5 rounded-full ring-2 transition-all ${
                      isScrolledOrLight ? 'bg-white text-red-600 ring-red-600' : 'bg-red-600 text-white ring-white'
                    }`}
                  >
                    {cartCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Header;
