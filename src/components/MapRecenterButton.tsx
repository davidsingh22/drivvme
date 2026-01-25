import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { Crosshair } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';

interface MapRecenterButtonProps {
  onClick: () => void;
  isFollowing: boolean;
  onToggleFollow: (follow: boolean) => void;
}

export function MapRecenterButton({ onClick, isFollowing, onToggleFollow }: MapRecenterButtonProps) {
  const { t } = useLanguage();
  const [justClicked, setJustClicked] = useState(false);

  const handleClick = useCallback(() => {
    onClick();
    onToggleFollow(true);
    setJustClicked(true);
    setTimeout(() => setJustClicked(false), 500);
  }, [onClick, onToggleFollow]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="absolute bottom-28 right-4 z-10"
    >
      <Button
        size="icon"
        variant={isFollowing ? "default" : "secondary"}
        className={`h-12 w-12 rounded-full shadow-lg ${
          isFollowing 
            ? 'bg-primary hover:bg-primary/90' 
            : 'bg-card hover:bg-card/90'
        }`}
        onClick={handleClick}
      >
        <motion.div
          animate={justClicked ? { scale: [1, 1.2, 1] } : {}}
          transition={{ duration: 0.3 }}
        >
          <Crosshair 
            className={`h-5 w-5 ${isFollowing ? 'text-primary-foreground' : 'text-foreground'}`} 
          />
        </motion.div>
      </Button>
      
      {!isFollowing && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute -top-8 right-0 whitespace-nowrap"
        >
          <span className="text-xs bg-card/90 backdrop-blur px-2 py-1 rounded shadow text-muted-foreground">
            {t('tapToFollow') || 'Tap to follow'}
          </span>
        </motion.div>
      )}
    </motion.div>
  );
}
