import { motion } from 'framer-motion';
import { Car } from 'lucide-react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

const Logo = ({ size = 'md', showText = true }: LogoProps) => {
  const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  const textSizes = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-4xl',
  };

  return (
    <motion.div 
      className="flex items-center gap-2"
      whileHover={{ scale: 1.02 }}
    >
      <motion.div 
        className={`${sizeClasses[size]} rounded-lg gradient-primary flex items-center justify-center shadow-button`}
        whileHover={{ rotate: -5 }}
        transition={{ type: 'spring', stiffness: 300 }}
      >
        <Car className={`${size === 'sm' ? 'h-4 w-4' : size === 'md' ? 'h-5 w-5' : 'h-7 w-7'} text-primary-foreground`} />
      </motion.div>
      {showText && (
        <span className={`font-display font-bold ${textSizes[size]} text-gradient`}>
          Drivveme
        </span>
      )}
    </motion.div>
  );
};

export default Logo;