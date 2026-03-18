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
import { useDriverPresenceTracking } from "@/hooks/useDriverPresenceTracking";
import { useRiderPresenceTracking } from "@/hooks/useRiderPresenceTracking";
import { useOneSignalSync } from "@/hooks/useOneSignalSync";
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

/**
 * Instant rider presence — mirrors the driver pattern exactly.
 * Fires a minimal upsert into `presence` the INSTANT user.id is known.
 * No firedRef guard, no GPS, no profile wait.
 */
async function fireInstantRiderPresence(userId: string, email?: string) {
  const now = new Date().toISOString();
  console.log("RIDER PRESENCE FIRED", userId, now);
  const { error } = await supabase.from('presence').upsert(
    {
      user_id: userId,
      role: 'RIDER',
      display_name: email || userId.slice(0, 8),
      source: 'home',
      last_seen_at: now,
      updated_at: now,
    },
    { onConflict: 'user_id' }
  );
  if (error) console.warn('[RiderPresence] instant fire error:', error.message);
}

const InstantRiderPresence = () => {
  const { user, roles, profile } = useAuth();
  const isDriver = roles.includes('driver');

  // Resolve display name: profile name > email > uid
  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || user?.id || '';

  // ── INSTANT FIRE: runs the moment user.id is available ──
  useEffect(() => {
    if (!user?.id || isDriver) return;
    void fireInstantRiderPresence(user.id, displayName);
  }, [user?.id, isDriver, displayName]);

  // ── VISIBILITY / FOCUS / PAGESHOW: re-fire on every resume ──
  useEffect(() => {
    if (!user?.id || isDriver) return;

    const onResume = () => {
      if (document.visibilityState === 'visible') {
        void fireInstantRiderPresence(user.id, displayName);
      }
    };
    const onFocus = () => void fireInstantRiderPresence(user.id, displayName);

    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onFocus);
    };
  }, [user?.id, isDriver, displayName]);

  // ── AUTH STATE: fire on SIGNED_IN / TOKEN_REFRESHED ──
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user?.id) {
        // Quick role check: don't fire for drivers
        supabase.rpc('is_driver', { _user_id: session.user.id }).then(({ data }) => {
          if (!data) {
            void fireInstantRiderPresence(session.user.id, session.user.email || '');
          }
        });
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  return null;
};

// Global presence heartbeat for all authenticated users
const PresenceTracker = () => {
  usePresenceHeartbeat();
  useDriverPresenceTracking();
  return null;
};

// /driver is a driver screen. Riders should always be redirected to /ride.
const DriverRoute = () => {
  const { session, authLoading, isDriver } = useAuth();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // Safety timeout: never show Loading for more than 3s — render dashboard anyway
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!session?.user?.id) {
      navigate('/login', { replace: true });
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(() => {
      // If RPC hangs, stop blocking after 4s
      if (!cancelled) setChecked(true);
    }, 4000);

    (async () => {
      try {
        // Fast path: context already knows
        if (isDriver) {
          if (!cancelled) setChecked(true);
          return;
        }

        // Also check last_route as a hint (iOS cold start)
        const lastRoute = (() => { try { return localStorage.getItem('last_route'); } catch { return null; } })();
        if (lastRoute === '/driver') {
          // Trust localStorage hint — render immediately, verify in background
          if (!cancelled) setChecked(true);
        }

        // Hard guarantee: backend role check
        const { data } = await supabase.rpc('is_driver', { _user_id: session.user.id });
        if (cancelled) return;
        if (!data && lastRoute !== '/driver') {
          navigate('/ride', { replace: true });
          return;
        }
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setChecked(true);
      }
    })();

    return () => { cancelled = true; clearTimeout(timeout); };
  }, [authLoading, session?.user?.id, isDriver, navigate]);

  // Show loading ONLY briefly — timedOut forces render after 3s no matter what
  if (!timedOut && (authLoading || (session?.user?.id && !checked))) {
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
      <InstantRiderPresence />
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
