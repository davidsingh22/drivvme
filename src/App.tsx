import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { useAuth } from "@/contexts/AuthContext";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import RideBooking from "./pages/RideBooking";
import DriverDashboard from "./pages/DriverDashboard";
import RideHistory from "./pages/RideHistory";
import Earnings from "./pages/Earnings";
import AdminDashboard from "./pages/AdminDashboard";
import AdminRefunds from "./pages/AdminRefunds";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const RouteRestorer = () => {
  const { session, roles, authLoading, profileLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // If a driver session exists, restore them to /driver on cold start or iOS reload.
  useEffect(() => {
    if (authLoading) return;
    if (!session) return;
    if (profileLoading) return;
    if (roles.length === 0) return;
    if (!roles.includes('driver')) return;
    if (location.pathname !== '/') return;

    const last = (() => {
      try {
        return localStorage.getItem('last_route');
      } catch {
        return null;
      }
    })();

    if (last === '/driver') {
      navigate('/driver', { replace: true });
    }
  }, [authLoading, profileLoading, session, roles, location.pathname, navigate]);

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
            <RouteRestorer />
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/ride" element={<RideBooking />} />
              <Route path="/driver" element={<DriverDashboard />} />
              <Route path="/history" element={<RideHistory />} />
              <Route path="/earnings" element={<Earnings />} />
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/refunds" element={<AdminRefunds />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;