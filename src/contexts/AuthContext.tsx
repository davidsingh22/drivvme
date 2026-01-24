import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const isLikelyStandaloneIOS = () => {
  try {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const standaloneFlag = (navigator as any).standalone === true;
    const standaloneMedia = window.matchMedia?.('(display-mode: standalone)')?.matches;
    return isIOS && (standaloneFlag || standaloneMedia);
  } catch {
    return false;
  }
};

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
  /** True while we are determining whether a session exists (auth state). */
  authLoading: boolean;
  /** True while we are fetching profiles/roles (can be slow on mobile). */
  profileLoading: boolean;
  /** Back-compat aggregate loading flag. */
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
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  // Track if we've done the initial load to avoid resetting during background refreshes
  const [hasInitialized, setHasInitialized] = useState(false);
  const { toast } = useToast();
  const resumeCheckInFlight = useRef<Promise<void> | null>(null);
  const lastResumeAttemptAtRef = useRef<number>(0);
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
    setProfileLoading(true);
    let lastError: any = null;

    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          // Mobile networks + iOS resume often need more time.
          const baseTimeout = isLikelyStandaloneIOS() ? 30000 : 25000;

          const [profileData, rolesData] = await Promise.all([
            withTimeout(fetchProfile(userId), baseTimeout),
            withTimeout(fetchRoles(userId), baseTimeout),
          ]);

          let driverData: DriverProfile | null = null;
          if (rolesData.includes('driver')) {
            // Driver profile can be the slowest fetch; retry it with backoff but keep session.
            for (let dpAttempt = 1; dpAttempt <= 4; dpAttempt++) {
              try {
                driverData = (await withTimeout(fetchDriverProfile(userId), baseTimeout)) ?? null;
                break;
              } catch (dpErr) {
                driverData = null;
                lastError = dpErr;
                await new Promise((r) => setTimeout(r, 400 * dpAttempt));
              }
            }
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

          return; // success – exit the retry loop
        } catch (e) {
          lastError = e;
          // brief backoff, helps with transient network errors
          await new Promise((r) => setTimeout(r, 250 * attempt));
        }
      }

      console.error('Failed to load user data after retries:', lastError);

      // IMPORTANT: don't "wipe" auth/session on transient mobile/Safari network issues.
      // If we already had roles/profile, keep them and just warn.
      if (hasInitializedRef.current && userRef.current?.id === userId && rolesRef.current.length > 0) {
        toast({
          title: 'Connection issue',
          description: 'We had trouble refreshing your account data. Retrying in the background…',
        });
        return;
      }
      // Keep whatever we may have in cache/in-memory; the driver dashboard will show a loading
      // state instead of redirecting while we recover.
      if (!profile && !driverProfile && roles.length === 0) {
        toast({
          title: 'Loading is taking longer than usual',
          description: 'Keeping you signed in while we reconnect…',
        });
      }
    } finally {
      // CRITICAL: always clear profileLoading so DriverDashboard doesn't stay on loading screen
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      // iOS Safari can transiently drop session storage on lock/unlock and emit SIGNED_OUT
      // even though a refresh can still recover. Add a short grace window on resume.
      const recentlyResumed = Date.now() - lastResumeAttemptAtRef.current < 7000;

      if (event === 'SIGNED_OUT' && userRef.current) {
        // iOS “Add to Home Screen” (standalone mode) can intermittently lose auth storage
        // and emit SIGNED_OUT even though a refresh can still recover.
        const shouldAttemptRecovery =
          recentlyResumed || document.visibilityState === 'hidden' || isLikelyStandaloneIOS();

        if (shouldAttemptRecovery) {
          // Keep current in-memory state to avoid redirect-to-login flicker.
          setAuthLoading(true);
          try {
            // Best-effort: attempt token refresh, then re-check session.
            await withTimeout(supabase.auth.refreshSession(), 12000).catch(() => undefined);
            const {
              data: { session: recovered },
            } = await withTimeout(supabase.auth.getSession(), 12000);

            if (recovered?.user) {
              setSession(recovered);
              setUser(recovered.user);
              hydrateFromCache(recovered.user.id);
              await loadUserData(recovered.user.id);
              return;
            }
            // If we truly can't recover a session, fall through to normal SIGNED_OUT handling.
          } finally {
            setAuthLoading(false);
            setHasInitialized(true);
          }
        }
      }

      // Only show loading on initial load or actual sign-in/sign-out
      // Skip loading for background token refreshes when we already have user data
      // IMPORTANT: this effect has an empty dep array, so we must use refs here.
      // Otherwise `hasInitialized` is always the initial value (false) and drivers/riders
      // can get stuck on a loading screen during periodic TOKEN_REFRESHED events.
      const isBackgroundRefresh = event === 'TOKEN_REFRESHED' && hasInitializedRef.current;

      if (!isBackgroundRefresh) {
        setAuthLoading(true);
      }

      // Always set session/user immediately (even if profile fetch is slow/timeouts).
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
        setAuthLoading(false);
        setHasInitialized(true);
      }
    });

    // THEN check for existing session
    (async () => {
      setAuthLoading(true);
      const {
        data: { session: existingSession },
      } = await supabase.auth.getSession();
      // Set session/user immediately so routes don't redirect while profile is still loading.
      setSession(existingSession);
      setUser(existingSession?.user ?? null);

      try {
        if (existingSession?.user) {
          // Hydrate from cache immediately so Safari doesn't look like it "reset".
          const hydrated = hydrateFromCache(existingSession.user.id);
          // If we hydrated, don't block the UI while we refresh.
          if (hydrated) setAuthLoading(false);
          await loadUserData(existingSession.user.id);
        } else {
          setProfile(null);
          setDriverProfile(null);
          setRoles([]);
        }
      } finally {
        setAuthLoading(false);
        setHasInitialized(true);
      }
    })();

    // When the app returns from background (lock screen, app switcher),
    // mobile browsers (especially iOS Safari) can briefly report a null session 
    // while storage/network wakes up. This avoids forcing a re-login.
    const resumeCheck = () => {
      if (resumeCheckInFlight.current) return;

      lastResumeAttemptAtRef.current = Date.now();

      resumeCheckInFlight.current = (async () => {
        try {
          // iOS Safari aggressively clears IndexedDB/localStorage on background.
          // Give storage a moment to wake up before checking session.
          await new Promise((r) => setTimeout(r, 150));

          const { data } = await supabase.auth.getSession();

          // On mobile lock/unlock, browsers can briefly fail to read storage/network.
          // Do NOT force a sign-out here; only the auth system should emit SIGNED_OUT.
          // If we already have a user in state, trust it and just try to refresh.
          if (!data.session) {
            // If we have a cached user, try to refresh session instead of giving up
            if (userRef.current) {
              console.log('[Auth] No session found on resume, but user exists in state. Attempting refresh...');
              try {
                const refreshResult = await withTimeout(supabase.auth.refreshSession(), 10000);
                if (refreshResult.data.session) {
                  setSession(refreshResult.data.session);
                  setUser(refreshResult.data.session.user);
                  console.log('[Auth] Session refreshed successfully on resume');
                }
              } catch (refreshError) {
                console.warn('[Auth] Session refresh failed on resume, keeping existing state:', refreshError);
                // Don't sign out - keep existing state, it might recover
              }
            }
            return;
          }

          // Session exists: ensure state is hydrated and refresh tokens silently.
          if (!userRef.current || userRef.current.id !== data.session.user.id) {
            setSession(data.session);
            setUser(data.session.user);
            hydrateFromCache(data.session.user.id);
          }

          // Refresh tokens in the background (best-effort) with longer timeout for iOS
          await withTimeout(supabase.auth.refreshSession(), 12000).catch(() => undefined);

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
    setAuthLoading(true);
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
      setAuthLoading(false);
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

  const isLoading = authLoading || profileLoading;

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        driverProfile,
        roles,
        authLoading,
        profileLoading,
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