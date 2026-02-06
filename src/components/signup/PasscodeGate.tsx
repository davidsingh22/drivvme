import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, ShieldCheck } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface PasscodeGateProps {
  onUnlock: () => void;
}

const PASSCODE = '007';

const PasscodeGate = ({ onUnlock }: PasscodeGateProps) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code === PASSCODE) {
      onUnlock();
    } else {
      setError(true);
      setTimeout(() => setError(false), 1500);
      setCode('');
    }
  };

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-card rounded-2xl p-8 shadow-card border border-border w-full max-w-sm text-center"
      >
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <ShieldCheck className="h-8 w-8 text-primary" />
        </div>
        
        <h1 className="font-display text-2xl font-bold mb-2">Access Required</h1>
        <p className="text-muted-foreground mb-6">Enter the passcode to continue</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="password"
              placeholder="Enter passcode"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`pl-10 text-center text-lg tracking-widest ${error ? 'border-destructive animate-shake' : ''}`}
              autoFocus
            />
          </div>
          
          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-destructive text-sm"
            >
              Incorrect passcode
            </motion.p>
          )}

          <Button type="submit" className="w-full">
            Unlock
          </Button>
        </form>
      </motion.div>
    </div>
  );
};

export default PasscodeGate;
