import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Logo from '@/components/Logo';
import riderHomeBg from '@/assets/rider-home-bg.png';

const RiderHome = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const firstName = profile?.first_name || 'there';

  return (
    <div className="min-h-screen w-full relative overflow-hidden flex flex-col">
      {/* Full-screen background */}
      <div className="absolute inset-0 z-0">
        <img
          src={riderHomeBg}
          alt="DrivveMe"
          className="w-full h-full object-cover object-center"
        />
        {/* Gradient overlay — darker at top and bottom for readability */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, rgba(5,0,15,0.72) 0%, rgba(5,0,15,0.3) 35%, rgba(5,0,15,0.55) 70%, rgba(5,0,15,0.85) 100%)',
          }}
        />
      </div>

      {/* ── TOP: Logo ── */}
      <div className="relative z-10 flex justify-center pt-14 pb-4">
        <Logo size="lg" />
      </div>

      {/* ── MIDDLE: Greeting ── */}
      <motion.div
        className="relative z-10 flex flex-col items-center px-6 mt-6"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: 'easeOut', delay: 0.15 }}
      >
        <h1
          className="font-display text-3xl md:text-4xl font-bold text-white text-center leading-snug"
          style={{ textShadow: '0 2px 16px rgba(0,0,0,0.7)' }}
        >
          Hello {firstName},
        </h1>
        <p
          className="text-white/80 text-lg md:text-xl text-center mt-1"
          style={{ textShadow: '0 1px 8px rgba(0,0,0,0.6)' }}
        >
          where are we headed today?
        </p>
      </motion.div>

      {/* ── WHERE TO button ── */}
      <motion.div
        className="relative z-10 flex flex-col items-center px-6 mt-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: 'easeOut', delay: 0.3 }}
      >
        <motion.button
          onClick={() => navigate('/where-to')}
          className="w-full max-w-sm flex items-center gap-3 px-5 py-4 rounded-full text-left font-semibold text-base"
          style={{
            background: 'rgba(255,255,255,0.97)',
            color: '#1a0a2e',
            boxShadow:
              '0 0 24px hsl(270 80% 60% / 0.85), 0 0 50px hsl(270 70% 55% / 0.65), 0 0 90px hsl(270 60% 50% / 0.45)',
          }}
          animate={{
            boxShadow: [
              '0 0 20px hsl(270 80% 60% / 0.7), 0 0 45px hsl(270 70% 55% / 0.5), 0 0 80px hsl(270 60% 50% / 0.35)',
              '0 0 40px hsl(270 80% 70% / 1), 0 0 80px hsl(270 70% 65% / 0.85), 0 0 130px hsl(270 60% 60% / 0.65)',
              '0 0 20px hsl(270 80% 60% / 0.7), 0 0 45px hsl(270 70% 55% / 0.5), 0 0 80px hsl(270 60% 50% / 0.35)',
            ],
          }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          whileTap={{ scale: 0.97 }}
        >
          <Search className="h-5 w-5 flex-shrink-0" style={{ color: '#7c3aed' }} />
          <span style={{ color: '#6b7280' }}>Where to?</span>
        </motion.button>
      </motion.div>

      {/* ── BOTTOM: nav links ── */}
      <div className="relative z-10 flex justify-center gap-8 text-white/55 text-sm mt-auto mb-10">
        <button
          onClick={() => navigate('/history')}
          className="hover:text-white/90 transition-colors"
        >
          Past Rides
        </button>
        <span className="text-white/20">|</span>
        <button
          onClick={() => navigate('/login')}
          className="hover:text-white/90 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
};

export default RiderHome;
