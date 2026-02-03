import { motion } from 'framer-motion';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GPSPosition } from '@/hooks/useDriverGPSStreaming';

interface DriverGPSStatusIndicatorProps {
  isStreaming: boolean;
  isConnected: boolean;
  position: GPSPosition | null;
  secondsSinceLastUpdate: number;
  secondsSinceDbSync: number | null;
  secondsSinceLastGpsFix: number | null;
  retryCount: number;
  onRetry: () => void;
  onForceSend: () => void;
  rideId: string | null;
  // DB write status props
  lastDbWriteError: string | null;
  dbWriteRetryCount: number;
  isDbSyncing: boolean;
  authStatus: 'ok' | 'signed_out';
  historyWriteCount?: number;
}

export function DriverGPSStatusIndicator({
  position,
  onForceSend,
  isDbSyncing,
}: DriverGPSStatusIndicatorProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mb-3"
    >
      <Button
        onClick={onForceSend}
        disabled={isDbSyncing || !position}
        className="w-full bg-primary hover:bg-primary/90 shadow-lg"
        size="lg"
      >
        {isDbSyncing ? (
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        ) : (
          <Send className="w-5 h-5 mr-2" />
        )}
        SEND LOCATION NOW
      </Button>
    </motion.div>
  );
}
