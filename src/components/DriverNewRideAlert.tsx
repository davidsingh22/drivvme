import { AnimatePresence, motion } from "framer-motion";
import { MapPin, Navigation, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type RideSummary = {
  id: string;
  pickup_address: string;
  dropoff_address: string;
};

export function DriverNewRideAlert(props: {
  open: boolean;
  ride: RideSummary | null;
  onDismiss: () => void;
  onView: () => void;
}) {
  const { open, ride, onDismiss, onView } = props;

  return (
    <AnimatePresence>
      {open && ride ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-20"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onDismiss} />

          <motion.div
            initial={{ y: -18, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -12, scale: 0.98, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            className="relative w-full max-w-lg"
          >
            <Card className="p-5 border-primary/30 shadow-card">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full bg-primary/10 p-2">
                  <Volume2 className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="font-display text-lg font-bold">New ride request nearby</div>
                  <div className="mt-2 space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 text-primary" />
                      <span className="line-clamp-2">{ride.pickup_address}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Navigation className="mt-0.5 h-4 w-4 text-accent" />
                      <span className="line-clamp-2">{ride.dropoff_address}</span>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <Button variant="outline" onClick={onDismiss}>
                      Dismiss
                    </Button>
                    <Button className="gradient-primary" onClick={onView}>
                      View rides
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
