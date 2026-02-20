import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Car } from 'lucide-react';
import { useEffect, useRef } from 'react';
import riderHomeBg from '@/assets/rider-home-bg.png';
import Logo from '@/components/Logo';

const RiderHome = () => {
  const navigate = useNavigate();
  const gpsStarted = useRef(false);

  // Phase 1: Background GPS warming — cache coords for instant pickup on /ride
  useEffect(() => {
    if (gpsStarted.current || !navigator.geolocation) return;
    gpsStarted.current = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const data = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          ts: Date.now(),
        };
        localStorage.setItem('drivveme_gps_warm', JSON.stringify(data));
      },
      () => { /* silent fail */ },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

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

        {/* Glowing Book a Ride button */}
        <motion.button
          onClick={() => navigate('/ride')}
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
      </motion.div>
    </div>
  );
};

export default RiderHome;
