import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const withTimeout = async <T,>(promise: Promise<T>, ms = 12000): Promise<T> => {
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error('Request timeout')), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};

type UserRole = 'rider' | 'driver' | 'admin';

interface Profile {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  phone_number: string | null;
  email: string | null;
  language: 'en' | 'fr';
  avatar_url: string | null;
}

interface DriverProfile {
  id: string;
  user_id: string;
  license_number: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  license_plate: string | null;
  is_online: boolean;
  is_verified: boolean;
  current_lat: number | null;
  current_lng: number | null;
  average_rating: number;
  total_rides: number;
  total_earnings: number;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  driverProfile: DriverProfile | null;
  roles: UserRole[];
  isLoading: boolean;
  isRider: boolean;
  isDriver: boolean;
  isAdmin: boolean;
  signUp: (
    email: string,
    password: string,
    role: UserRole,
    firstName?: string,
    lastName?: string,
    phone?: string,
    vehicleInfo?: {
      vehicleMake: string;
      vehicleModel: string;
      vehicleColor: string;
      licensePlate: string;
    }
  ) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshDriverProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type CachedAuthUserData = {
  profile: Profile | null;
  roles: UserRole[];
  driverProfile: DriverProfile | null;
  cachedAt: number;
};

const getAuthCacheKey = (userId: string) => `auth-cache:${userId}`;

const readAuthCache = (userId: string): CachedAuthUserData | null => {
  try {
    const raw = localStorage.getItem(getAuthCacheKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as CachedAuthUserData;
  } catch {
    return null;
  }
};

const writeAuthCache = (userId: string, value: CachedAuthUserData) => {
  try {
    localStorage.setItem(getAuthCacheKey(userId), JSON.stringify(value));
  } catch {
    // ignore (Safari private mode / storage full)
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Track if we've done the initial load to avoid resetting during background refreshes
  const [hasInitialized, setHasInitialized] = useState(false);
  const { toast } = useToast();
  const resumeCheckInFlight = useRef<Promise<void> | null>(null);
  const userRef = useRef<User | null>(null);
  const rolesRef = useRef<UserRole[]>([]);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    rolesRef.current = roles;
  }, [roles]);

  useEffect(() => {
    hasInitializedRef.current = hasInitialized;
  }, [hasInitialized]);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle();

    // If there's no profile yet, return null (app can still proceed)
    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching profile:', error);
      throw error;
    }
    return data;
  };

  const fetchDriverProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('driver_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching driver profile:', error);
      throw error;
    }
    return data;
  };

  const fetchRoles = async (userId: string): Promise<UserRole[]> => {
    // Primary path: read roles table
    const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId);

    if (!error) {
      return data?.map((r) => r.role as UserRole) || [];
    }

    // Fallback path: use SECURITY DEFINER functions (avoids RLS recursion / missing policies)
    console.warn('Direct roles query failed, falling back to role RPC checks:', error);
    const [isAdminRes, isDriverRes, isRiderRes] = await Promise.all([
      supabase.rpc('is_admin', { _user_id: userId }),
      supabase.rpc('is_driver', { _user_id: userId }),
      supabase.rpc('is_rider', { _user_id: userId }),
    ]);

    const resolved: UserRole[] = [];
    if (isAdminRes.data) resolved.push('admin');
    if (isDriverRes.data) resolved.push('driver');
    if (isRiderRes.data) resolved.push('rider');

    // If RPC also errors, surface the original error
    if (resolved.length === 0 && (isAdminRes.error || isDriverRes.error || isRiderRes.error)) {
      throw (isAdminRes.error || isDriverRes.error || isRiderRes.error) as any;
    }

    return resolved;
  };

  const hydrateFromCache = (userId: string) => {
    const cached = readAuthCache(userId);
    if (!cached) return false;

    // If we have something recent-ish, use it to avoid spinners on return visits.
    // (Even if it's a bit stale, we'll refresh immediately after.)
    setProfile(cached.profile);
    setRoles(cached.roles);
    setDriverProfile(cached.driverProfile);
    return true;
  };

  const loadUserData = async (userId: string) => {
    let lastError: any = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const [profileData, rolesData] = await Promise.all([
          withTimeout(fetchProfile(userId), 12000),
          withTimeout(fetchRoles(userId), 12000),
        ]);

        let driverData: DriverProfile | null = null;
        if (rolesData.includes('driver')) {
          driverData = (await withTimeout(fetchDriverProfile(userId), 12000)) ?? null;
        }

        setProfile(profileData ?? null);
        setRoles(rolesData);
        setDriverProfile(driverData);

        writeAuthCache(userId, {
          profile: (profileData ?? null) as any,
          roles: rolesData,
          driverProfile: driverData,
          cachedAt: Date.now(),
        });

        return;
      } catch (e) {
        lastError = e;
        // brief backoff, helps with transient network errors
        await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    }

    console.error('Failed to load user data after retries:', lastError);

    // IMPORTANT: don't "wipe" the app state on transient mobile/Safari network issues.
    // If we already had roles/profile, keep them and just warn.
    if (hasInitialized && user?.id === userId && roles.length > 0) {
      toast({
        title: 'Connection issue',
        description: 'We had trouble refreshing your account data. Retrying in the background…',
      });
      return;
    }

    setProfile(null);
    setDriverProfile(null);
    setRoles([]);
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      // Only show loading on initial load or actual sign-in/sign-out
      // Skip loading for background token refreshes when we already have user data
      const isBackgroundRefresh = event === 'TOKEN_REFRESHED' && hasInitialized;

      if (!isBackgroundRefresh) {
        setIsLoading(true);
      }

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      try {
        if (nextSession?.user) {
          // If we have cached data, apply it immediately to avoid "reset" feel.
          hydrateFromCache(nextSession.user.id);
          // Small delay helps avoid rare timing issues right after auth events
          await new Promise((r) => setTimeout(r, 100));
          await loadUserData(nextSession.user.id);
        } else {
          setProfile(null);
          setDriverProfile(null);
          setRoles([]);
        }
      } finally {
        setIsLoading(false);
        setHasInitialized(true);
      }
    });

    // THEN check for existing session
    (async () => {
      setIsLoading(true);
      const {
        data: { session: existingSession },
      } = await supabase.auth.getSession();
      setSession(existingSession);
      setUser(existingSession?.user ?? null);

      try {
        if (existingSession?.user) {
          // Hydrate from cache immediately so Safari doesn't look like it "reset".
          const hydrated = hydrateFromCache(existingSession.user.id);
          // If we hydrated, don't block the UI while we refresh.
          if (hydrated) setIsLoading(false);
          await loadUserData(existingSession.user.id);
        } else {
          setProfile(null);
          setDriverProfile(null);
          setRoles([]);
        }
      } finally {
        setIsLoading(false);
        setHasInitialized(true);
      }
    })();

    // When the app returns from background (lock screen, app switcher),
    // mobile browsers can briefly report a null session while storage/network wakes up.
    // This avoids forcing a re-login by re-checking and refreshing in the background.
    const resumeCheck = () => {
      if (resumeCheckInFlight.current) return;

      resumeCheckInFlight.current = (async () => {
        try {
          const { data } = await supabase.auth.getSession();

          // On mobile lock/unlock, browsers can briefly fail to read storage/network.
          // Do NOT force a sign-out here; only the auth system should emit SIGNED_OUT.
          if (!data.session) return;

          // Session exists: ensure state is hydrated and refresh tokens silently.
          if (!userRef.current || userRef.current.id !== data.session.user.id) {
            setSession(data.session);
            setUser(data.session.user);
            hydrateFromCache(data.session.user.id);
          }

          // Refresh tokens in the background (best-effort)
          await withTimeout(supabase.auth.refreshSession(), 8000).catch(() => undefined);

          // If we were missing roles/profile (e.g., first wake), reload without blocking UI
          if (data.session?.user && rolesRef.current.length === 0) {
            await loadUserData(data.session.user.id);
          }
        } finally {
          resumeCheckInFlight.current = null;
        }
      })();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') resumeCheck();
    };

    window.addEventListener('focus', resumeCheck);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('focus', resumeCheck);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const signUp = async (
    email: string,
    password: string,
    role: UserRole,
    firstName?: string,
    lastName?: string,
    phone?: string,
    vehicleInfo?: { vehicleMake: string; vehicleModel: string; vehicleColor: string; licensePlate: string }
  ) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) throw error;

      if (data.user) {
        // Update profile with additional info
        if (firstName || lastName || phone) {
          await supabase
            .from('profiles')
            .update({
              first_name: firstName,
              last_name: lastName,
              phone_number: phone,
            })
            .eq('user_id', data.user.id);
        }

        // Add user role
        await supabase
          .from('user_roles')
          .insert({ user_id: data.user.id, role });

        // If driver, create driver profile with vehicle info
        if (role === 'driver') {
          await supabase
            .from('driver_profiles')
            .insert({ 
              user_id: data.user.id,
              vehicle_make: vehicleInfo?.vehicleMake || null,
              vehicle_model: vehicleInfo?.vehicleModel || null,
              vehicle_color: vehicleInfo?.vehicleColor || null,
              license_plate: vehicleInfo?.licensePlate || null,
            });
        }

        toast({
          title: 'Account created!',
          description: 'Welcome to Drivveme!',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Sign up failed',
        description: error.message,
        variant: 'destructive',
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    // Don't set isLoading here - onAuthStateChange handles it
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast({
        title: 'Sign in failed',
        description: error.message,
        variant: 'destructive',
      });
      throw error;
    }

    toast({
      title: 'Welcome back!',
      description: 'Successfully signed in.',
    });
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      toast({
        title: 'Signed out',
        description: 'See you next time!',
      });
    } catch (error: any) {
      toast({
        title: 'Error signing out',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const refreshProfile = async () => {
    if (user) {
      const data = await fetchProfile(user.id);
      setProfile(data);
    }
  };

  const refreshDriverProfile = async () => {
    if (user && roles.includes('driver')) {
      const data = await fetchDriverProfile(user.id);
      setDriverProfile(data);
    }
  };

  const isRider = roles.includes('rider');
  const isDriver = roles.includes('driver');
  const isAdmin = roles.includes('admin');

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        driverProfile,
        roles,
        isLoading,
        isRider,
        isDriver,
        isAdmin,
        signUp,
        signIn,
        signOut,
        refreshProfile,
        refreshDriverProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};