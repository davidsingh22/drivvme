import { AnimatePresence, motion } from "framer-motion";
import { MapPin, Navigation, Clock, DollarSign, Zap, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/pricing";
import { useLanguage } from "@/contexts/LanguageContext";

type RideSummary = {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  estimated_fare?: number;
  pickup_eta_minutes?: number;
  is_priority?: boolean;
  minimum_earnings?: number;
};

export function DriverNewRideAlert(props: {
  open: boolean;
  ride: RideSummary | null;
  onDismiss: () => void;
  onView: () => void;
  showPriorityReward?: boolean;
}) {
  const { open, ride, onDismiss, onView, showPriorityReward = true } = props;
  const { language } = useLanguage();

  return (
    <AnimatePresence>
      {open && ride ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop - clicking it does NOT dismiss (force user to click button) */}
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />

          <motion.div
            initial={{ y: -24, scale: 0.95, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -16, scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 360, damping: 28 }}
            className="relative w-full max-w-lg"
          >
            {/* Pulsing border effect for urgency */}
            <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-primary via-accent to-primary animate-pulse opacity-50" />
            
            <Card className="relative m-0.5 p-5 border-primary/50 shadow-2xl bg-card">
              {/* Priority Badge */}
              {ride.is_priority && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-gradient-to-r from-accent to-primary text-accent-foreground font-bold px-4 py-1 shadow-lg">
                    <Zap className="h-3 w-3 mr-1" />
                    PRIORITY RIDE
                  </Badge>
                </div>
              )}

              <div className="flex flex-col gap-4 mt-2">
                {/* Header with earnings */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="rounded-full bg-primary/10 p-2 animate-pulse">
                      <DollarSign className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-primary">
                        {ride.minimum_earnings 
                          ? formatCurrency(ride.minimum_earnings, language)
                          : ride.estimated_fare 
                            ? formatCurrency(ride.estimated_fare - 5, language)
                            : "New Ride"}
                      </div>
                      <div className="text-xs text-muted-foreground">minimum earnings</div>
                    </div>
                  </div>
                  
                  {/* ETA Badge */}
                  {ride.pickup_eta_minutes !== undefined && (
                    <div className="flex items-center gap-1.5 bg-success/10 text-success px-3 py-1.5 rounded-full">
                      <Clock className="h-4 w-4" />
                      <span className="font-bold">{ride.pickup_eta_minutes} min</span>
                      <span className="text-xs">pickup</span>
                    </div>
                  )}
                </div>

                {/* Locations */}
                <div className="space-y-2 text-sm bg-muted/30 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 text-primary flex-shrink-0" />
                    <span className="line-clamp-1 font-medium">{ride.pickup_address}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Navigation className="mt-0.5 h-4 w-4 text-accent flex-shrink-0" />
                    <span className="line-clamp-1">{ride.dropoff_address}</span>
                  </div>
                </div>

                {/* Priority Driver Reward Banner */}
                {showPriorityReward && (
                  <div className="flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-lg p-2.5">
                    <Trophy className="h-5 w-5 text-accent" />
                    <div className="flex-1">
                      <div className="text-xs font-bold text-accent">Accept in 5 sec → Priority Driver!</div>
                      <div className="text-xs text-muted-foreground">Get priority for 30 min</div>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <Button 
                    variant="outline" 
                    onClick={onDismiss}
                    className="border-2"
                  >
                    Dismiss
                  </Button>
                  <Button 
                    className="gradient-primary font-bold shadow-lg" 
                    onClick={onView}
                  >
                    View & Accept
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
