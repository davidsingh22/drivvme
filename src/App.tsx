import { useEffect, useState, lazy, Suspense } from "react";
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
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { useRiderLocationTracking } from "@/hooks/useRiderLocationTracking";
import { GlobalRideOfferGuard } from "@/components/GlobalRideOfferGuard";
import { usePresenceHeartbeat } from "@/hooks/usePresenceHeartbeat";
import { useBackgroundSessionRefresh } from "@/hooks/useBackgroundSessionRefresh";
import { useOneSignalSync } from "@/hooks/useOneSignalSync";
import { useWatchdog } from "@/hooks/useWatchdog";
import { useOneSignalPlayerSync } from "@/hooks/useOneSignalPlayerSync";
import { initOneSignalAuthLink } from "@/lib/onesignalAuthLink";
import { initMedianOneSignalAuthLink } from "@/lib/medianOneSignalAuthLink";
import { initCaptureOneSignalId } from "@/lib/captureOneSignalId";

// Lazy-load all non-landing routes for faster initial page load
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const RideBooking = lazy(() => import("./pages/RideBooking"));
const DriverDashboard = lazy(() => import("./pages/DriverDashboard"));
const DriverMessages = lazy(() => import("./pages/DriverMessages"));
const RideHistory = lazy(() => import("./pages/RideHistory"));
const Earnings = lazy(() => import("./pages/Earnings"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminRefunds = lazy(() => import("./pages/AdminRefunds"));
const AdminRideLocations = lazy(() => import("./pages/AdminRideLocations"));
const AdminDriverDocuments = lazy(() => import("./pages/AdminDriverDocuments"));
const AdminDriverDocumentDetail = lazy(() => import("./pages/AdminDriverDocumentDetail"));
const LiveDriversMap = lazy(() => import("@/pages/admin/LiveDriversMap"));
const LiveRidersMap = lazy(() => import("@/pages/admin/LiveRidersMap"));
const LiveMonitor = lazy(() => import("@/pages/admin/LiveMonitor"));
const DriverLive = lazy(() => import("./pages/DriverLive"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Debug = lazy(() => import("./pages/Debug"));
const DriverFloatingGPSButton = lazy(() => import("@/components/DriverFloatingGPSButton"));
const RiderHome = lazy(() => import("./pages/RiderHome"));
const RideSearch = lazy(() => import("./pages/RideSearch"));

const queryClient = new QueryClient();

// /ride is a rider screen. Drivers should always be redirected to /driver.
const RideRoute = () => {
  const { session, authLoading, isDriver } = useAuth();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!session?.user?.id) {
      // No session — just show the page (it will redirect to login itself)
      setChecked(true);
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(() => {
      // Safety: if RPC hangs on slow mobile, stop blocking after 4s
      if (!cancelled) setChecked(true);
    }, 4000);

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
        clearTimeout(timeout);
        if (!cancelled) setChecked(true);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
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

// Global rider location tracker - runs for all authenticated non-driver users
const RiderLocationTracker = () => {
  useRiderLocationTracking(true);
  return null;
};

// Global presence heartbeat for all authenticated users
const PresenceTracker = () => {
  usePresenceHeartbeat();
  useBackgroundSessionRefresh();
  useWatchdog();
  return null;
};

// /driver is a driver screen. Riders should always be redirected to /ride.
const DriverRoute = () => {
  const { session, authLoading, isDriver } = useAuth();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(() => {
    // Fast-path: if localStorage says last route was /driver AND we still have a stored session, render immediately
    try {
      const hasLastRoute = localStorage.getItem('last_route') === '/driver';
      // Only fast-path if there's a stored Supabase session (token exists)
      const hasStoredSession = !!localStorage.getItem('sb-siadshsaiuecesydqzqo-auth-token');
      return hasLastRoute && hasStoredSession;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    // If auth finished loading and there's no session → redirect to login immediately
    if (!authLoading && !session?.user?.id) {
      try { localStorage.removeItem('last_route'); } catch {}
      navigate('/login', { replace: true });
      return;
    }

    if (checked && !authLoading) {
      // Already rendering — still verify role in background
      if (session?.user?.id && !isDriver) {
        (async () => {
          try {
            const { data } = await supabase.rpc('is_driver', { _user_id: session.user.id });
            if (!data) navigate('/ride', { replace: true });
          } catch {}
        })();
      }
      return;
    }

    // Safety timeout: never block longer than 3s
    const timeout = setTimeout(() => {
      setChecked(true);
    }, 3000);

    if (authLoading) return () => clearTimeout(timeout);

    if (!session?.user?.id) {
      clearTimeout(timeout);
      try { localStorage.removeItem('last_route'); } catch {}
      navigate('/login', { replace: true });
      return () => {};
    }

    let cancelled = false;
    (async () => {
      try {
        if (isDriver) {
          if (!cancelled) setChecked(true);
          return;
        }

        const raceResult = await Promise.race([
          supabase.rpc('is_driver', { _user_id: session.user.id }),
          new Promise<{ data: null }>((resolve) => setTimeout(() => resolve({ data: null }), 4000)),
        ]);
        if (cancelled) return;
        if (raceResult.data === false) {
          navigate('/ride', { replace: true });
          return;
        }
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setChecked(true);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [authLoading, session?.user?.id, isDriver, navigate, checked]);

  if (!checked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return <DriverDashboard />;
};

// Wrapped inside BrowserRouter AND AuthProvider so useAuth context is available.
const LazyFallback = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="animate-pulse text-muted-foreground">Loading…</div>
  </div>
);

// Runs once at app level to sync OneSignal identity + player ID
const OneSignalLinker = () => {
  useOneSignalSync();
  useOneSignalPlayerSync();
  return null;
};

const AppRoutes = () => {
  return (
    <>
      <OneSignalLinker />
      <RouteRestorer />
      <Suspense fallback={null}>
        <DriverFloatingGPSButton />
      </Suspense>
      <RiderLocationTracker />
      <PresenceTracker />
      <Suspense fallback={<LazyFallback />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
         <Route path="/rider-home" element={<RiderHome />} />
         <Route path="/search" element={<RideSearch />} />
         <Route path="/ride" element={<RideRoute />} />
        <Route
          path="/driver"
          element={
            <RouteErrorBoundary title="Driver dashboard error">
              <DriverRoute />
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/driver/messages"
          element={
            <RouteErrorBoundary title="Driver messages error">
              <DriverMessages />
            </RouteErrorBoundary>
          }
        />
        <Route path="/history" element={<RideHistory />} />
        <Route path="/earnings" element={<Earnings />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/refunds" element={<AdminRefunds />} />
        <Route path="/admin/ride-locations" element={<AdminRideLocations />} />
        <Route path="/admin/drivers-live" element={<LiveDriversMap />} />
        <Route path="/admin/riders-live" element={<LiveRidersMap />} />
        <Route path="/admin/live" element={<LiveMonitor />} />
        <Route path="/admin/driver-documents" element={<AdminDriverDocuments />} />
        <Route path="/admin/driver-documents/:driverId" element={<AdminDriverDocumentDetail />} />
        <Route path="/driver-live" element={<DriverLive />} />
        <Route path="/debug" element={<Debug />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
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
        return;
      }
    }

    // For riders, always go to rider-home on cold start / reopen
    if (roles.includes('rider') || (!roles.includes('driver') && !roles.includes('admin'))) {
      navigate('/rider-home', { replace: true });
    }
  }, [authLoading, session, roles, location.pathname, navigate]);

  return null;
};

const App = () => {
  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      console.error("Unhandled rejection:", event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", handleRejection);
    return () => window.removeEventListener("unhandledrejection", handleRejection);
  }, []);

  useEffect(() => {
    initOneSignalAuthLink();
    initMedianOneSignalAuthLink();
    initCaptureOneSignalId();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <AuthProvider>
          <TooltipProvider>
            <GlobalRideOfferGuard />
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
};

export default App;
