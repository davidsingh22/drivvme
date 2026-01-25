import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import RideBooking from "./pages/RideBooking";
import DriverDashboard from "./pages/DriverDashboard";
import RideHistory from "./pages/RideHistory";
import Earnings from "./pages/Earnings";
import AdminDashboard from "./pages/AdminDashboard";
import AdminRefunds from "./pages/AdminRefunds";
import AdminRideLocations from "./pages/AdminRideLocations";
import LiveDriversMap from "@/pages/admin/LiveDriversMap";
import DriverLive from "./pages/DriverLive";
import NotFound from "./pages/NotFound";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

const queryClient = new QueryClient();

// /ride is a rider screen. Drivers should always be redirected to /driver.
const RideRoute = () => {
  const { session, authLoading, isDriver } = useAuth();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!session?.user?.id) return;

    let cancelled = false;
    (async () => {
      try {
        // Fast path: context already knows.
        if (isDriver) {
          if (!cancelled) navigate('/driver', { replace: true });
          return;
        }

        // Hard guarantee: backend role check (works even if roles table read is blocked).
        const { data } = await supabase.rpc('is_driver', { _user_id: session.user.id });
        if (cancelled) return;
        if (data) {
          navigate('/driver', { replace: true });
          return;
        }
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user?.id, isDriver, navigate]);

  // While checking, avoid flashing the rider booking UI.
  if (authLoading || (session?.user?.id && !checked)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return <RideBooking />;
};

// Wrapped inside BrowserRouter AND AuthProvider to ensure context is available.
const AppRoutes = () => {
  return (
    <>
      <RouteRestorer />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/ride" element={<RideRoute />} />
        <Route
          path="/driver"
          element={
            <RouteErrorBoundary title="Driver dashboard error">
              <DriverDashboard />
            </RouteErrorBoundary>
          }
        />
        <Route path="/history" element={<RideHistory />} />
        <Route path="/earnings" element={<Earnings />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/refunds" element={<AdminRefunds />} />
        <Route path="/admin/ride-locations" element={<AdminRideLocations />} />
        <Route path="/admin/drivers-live" element={<LiveDriversMap />} />
        <Route path="/driver-live" element={<DriverLive />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const RouteRestorer = () => {
  const { session, roles, authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // If a driver session exists, restore them to /driver on cold start or iOS reload.
  useEffect(() => {
    if (authLoading) return;
    if (!session) return;
    if (location.pathname !== '/') return;

    const last = (() => {
      try {
        return localStorage.getItem('last_route');
      } catch {
        return null;
      }
    })();

    if (last === '/driver') {
      // If the driver last used /driver, restore them there immediately on iOS reload.
      if (roles.length === 0 || roles.includes('driver')) {
        navigate('/driver', { replace: true });
      }
    }
  }, [authLoading, session, roles, location.pathname, navigate]);

  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;