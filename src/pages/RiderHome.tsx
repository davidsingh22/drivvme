import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Car, Shield } from 'lucide-react';
import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { logActivity } from '@/lib/activityEvents';
import { getValidAccessToken } from '@/lib/sessionRecovery';
import riderHomeBg from '@/assets/rider-home-bg.png';
import Logo from '@/components/Logo';
import { clearMapboxTokenCache } from '@/hooks/useMapboxToken';

const RiderHome = () => {
  const navigate = useNavigate();
  const { isAdmin, user, profile } = useAuth();
  const gpsStarted = useRef(false);

  // Phase 1: Background GPS warming — 3-second strict timeout, never blocks UI
  useEffect(() => {
    if (gpsStarted.current || !navigator.geolocation) return;
    gpsStarted.current = true;

    try {
      const timeoutId = setTimeout(() => {
        // 3s hard cap — stop waiting, user can proceed regardless
        console.log('[RiderHome] GPS warm timed out after 3s');
      }, 3000);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timeoutId);
          const data = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            ts: Date.now(),
          };
          localStorage.setItem('drivveme_gps_warm', JSON.stringify(data));
        },
        () => {
          clearTimeout(timeoutId);
          /* silent fail — button still works */
        },
        { enableHighAccuracy: true, timeout: 3000, maximumAge: 60000 }
      );
    } catch {
      /* GPS completely unavailable — no-op */
    }
  }, []);

  // 'Slap-Awake' Refresh: re-warm GPS + reset Mapbox cache on every app resume
  const lastHidden = useRef(Date.now());

  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'hidden') {
      lastHidden.current = Date.now();
      return;
    }

    // App resumed — refresh engine
    const idleMs = Date.now() - lastHidden.current;
    console.log(`[RiderHome] App resumed after ${Math.round(idleMs / 1000)}s`);

    // Proactively refresh token if idle > 5 min (non-blocking, fire-and-forget)
    if (idleMs > 5 * 60 * 1000) {
      getValidAccessToken().catch(() => {});
    }

    // Always reset Mapbox search API cache so it's fresh
    clearMapboxTokenCache();

    // Re-warm GPS (3s timeout, non-blocking)
    if (navigator.geolocation) {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            localStorage.setItem('drivveme_gps_warm', JSON.stringify({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              ts: Date.now(),
            }));
          },
          () => {},
          { enableHighAccuracy: true, timeout: 3000, maximumAge: 0 }
        );
      } catch { /* no-op */ }
    }
  }, []);

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [handleVisibilityChange]);

  return (
    <div className="min-h-screen w-full relative overflow-hidden flex flex-col items-center justify-between">
      {/* Full-screen background */}
      <div className="absolute inset-0 z-0">
        <img
          src={riderHomeBg}
          alt="DrivveMe"
          className="w-full h-full object-cover object-center"
        />
        {/* Dark overlay so text is readable */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, rgba(15,5,30,0.45) 0%, rgba(15,5,30,0.15) 40%, rgba(15,5,30,0.65) 100%)',
          }}
        />
      </div>

      {/* Logo top */}
      <div className="relative z-10 pt-12">
        <Logo size="lg" />
      </div>

      {/* Center greeting */}
      <motion.div
        className="relative z-10 flex flex-col items-center gap-10 px-6 pb-24"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        <div className="text-center space-y-2">
          <h1
            className="font-display text-4xl font-bold text-white"
            style={{ textShadow: '0 0 30px rgba(147,51,234,0.8), 0 2px 8px rgba(0,0,0,0.8)' }}
          >
            Where to?
          </h1>
          <p className="text-white/70 text-base">Your ride is just one tap away</p>
        </div>

        {/* Glowing Book a Ride button — NEVER disabled, GPS is non-blocking */}
        <motion.button
          onClick={() => {
            if (user?.id) {
              const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user.email || user.id;
              const gpsWarm = (() => { try { return JSON.parse(localStorage.getItem('drivveme_gps_warm') || '{}'); } catch { return {}; } })();
              logActivity({
                userId: user.id,
                eventType: 'BOOK_RIDE_CLICKED',
                message: `${displayName} tapped Book a Ride`,
                meta: gpsWarm.lat ? { lat: gpsWarm.lat, lng: gpsWarm.lng } : undefined,
              });
            }
            navigate('/ride?new=1');
          }}
          className="relative group flex items-center gap-3 px-10 py-5 rounded-2xl font-display font-bold text-xl text-white overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, hsl(270 80% 45%), hsl(280 90% 35%))',
            boxShadow:
              '0 0 30px hsl(270 80% 55% / 0.9), 0 0 60px hsl(270 70% 50% / 0.6), 0 0 100px hsl(270 60% 45% / 0.4)',
          }}
          animate={{
            boxShadow: [
              '0 0 25px hsl(270 80% 55% / 0.8), 0 0 50px hsl(270 70% 50% / 0.5), 0 0 80px hsl(270 60% 45% / 0.3)',
              '0 0 45px hsl(270 80% 65% / 1), 0 0 90px hsl(270 70% 60% / 0.8), 0 0 140px hsl(270 60% 55% / 0.6)',
              '0 0 25px hsl(270 80% 55% / 0.8), 0 0 50px hsl(270 70% 50% / 0.5), 0 0 80px hsl(270 60% 45% / 0.3)',
            ],
          }}
          transition={{
            duration: 1.4,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          whileTap={{ scale: 0.96 }}
        >
          {/* Shimmer sweep */}
          <span
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            style={{
              background:
                'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.25) 50%, transparent 60%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.2s infinite',
            }}
          />
          <Car className="h-6 w-6 relative z-10" />
          <span className="relative z-10">Book a Ride</span>
        </motion.button>

        {/* Sub-links */}
        <div className="flex gap-6 text-white/60 text-sm">
          <button
            onClick={() => navigate('/history')}
            className="hover:text-white transition-colors"
          >
            Past Rides
          </button>
          <span className="text-white/20">|</span>
          <button
            onClick={() => navigate('/login')}
            className="hover:text-white transition-colors"
          >
            Sign Out
          </button>
        </div>

        {/* Admin shortcut — only visible to admin users */}
        {isAdmin && (
          <motion.button
            onClick={() => navigate('/admin')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white/90 hover:text-white transition-colors"
            style={{
              background: 'rgba(255,255,255,0.1)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
            whileTap={{ scale: 0.95 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            <Shield className="h-4 w-4" />
            Admin Dashboard
          </motion.button>
        )}
      </motion.div>
    </div>
  );
};

export default RiderHome;
