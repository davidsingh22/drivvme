import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Search, History, Car } from 'lucide-react';
import riderHomeBg from '@/assets/rider-home-bg.png';
import Logo from '@/components/Logo';
import { useAuth } from '@/contexts/AuthContext';

const RiderHome = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const firstName = profile?.first_name;

  return (
    <div className="min-h-screen w-full relative overflow-hidden flex flex-col">
      {/* Full-screen background */}
      <div className="absolute inset-0 z-0">
        <img
          src={riderHomeBg}
          alt="DrivveMe"
          className="w-full h-full object-cover object-center"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, rgba(10,5,20,0.55) 0%, rgba(10,5,20,0.10) 35%, rgba(10,5,20,0.70) 100%)',
          }}
        />
      </div>

      {/* Top: Logo + greeting */}
      <div className="relative z-10 flex flex-col items-start px-6 pt-12 pb-4">
        <Logo size="md" />
        <motion.p
          className="mt-4 text-white/80 text-base font-medium"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          {firstName
            ? `Good to see you, ${firstName} 👋`
            : 'Good to see you 👋'}
        </motion.p>
      </div>

      {/* Spacer to push content down */}
      <div className="flex-1" />

      {/* Bottom content */}
      <motion.div
        className="relative z-10 px-5 pb-10 space-y-4"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut', delay: 0.1 }}
      >
        {/* "Where to?" tappable search bar */}
        <motion.button
          onClick={() => navigate('/where-to')}
          className="w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-left"
          style={{
            background: 'rgba(255,255,255,0.97)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
          }}
          whileTap={{ scale: 0.98 }}
        >
          <Search className="h-5 w-5 text-foreground/50 flex-shrink-0" />
          <span className="text-foreground/50 font-medium text-base">
            Where to?
          </span>
        </motion.button>

        {/* Glowing Book a Ride button */}
        <motion.button
          onClick={() => navigate('/where-to')}
          className="relative w-full flex items-center justify-center gap-3 px-6 py-5 rounded-2xl font-display font-bold text-xl text-white overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, hsl(270 80% 45%), hsl(280 90% 35%))',
          }}
          animate={{
            boxShadow: [
              '0 0 20px hsl(270 80% 55% / 0.7), 0 0 40px hsl(270 70% 50% / 0.4)',
              '0 0 40px hsl(270 80% 65% / 1), 0 0 80px hsl(270 70% 60% / 0.7)',
              '0 0 20px hsl(270 80% 55% / 0.7), 0 0 40px hsl(270 70% 50% / 0.4)',
            ],
          }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          whileTap={{ scale: 0.97 }}
        >
          <Car className="h-6 w-6" />
          <span>Book a Ride</span>
        </motion.button>

        {/* Sub-links */}
        <div className="flex items-center justify-center gap-6 pt-1">
          <button
            onClick={() => navigate('/history')}
            className="flex items-center gap-1.5 text-white/60 text-sm hover:text-white transition-colors"
          >
            <History className="h-4 w-4" />
            <span>Past Rides</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default RiderHome;

