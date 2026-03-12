import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import OneSignal from 'react-onesignal';
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
  /** Best-effort re-check of the current session (used for iOS resume). */
  refreshSession: (options?: { silent?: boolean }) => Promise<void>;
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
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
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
    console.log('[AuthContext] Fetching driver profile for:', userId);
    const { data, error } = await supabase
      .from('driver_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('[AuthContext] Error fetching driver profile:', error);
      throw error;
    }
    console.log('[AuthContext] Driver profile fetched:', data ? 'found' : 'not found');
    return data;
  };

  const fetchRoles = async (userId: string): Promise<UserRole[]> => {
    // Primary path: read roles table
    const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId);

    if (!error) {
      const roles = data?.map((r) => r.role as UserRole) || [];

      // Resilience: if roles table is empty/missing for a driver account, infer from driver profile.
      // This prevents drivers from being stuck on the dashboard loading screen.
      if (roles.length === 0) {
        const { data: dp } = await supabase
          .from('driver_profiles')
          .select('id')
          .eq('user_id', userId)
          .maybeSingle();
        if (dp?.id) return ['driver'];
      }

      return roles;
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

    try {
      // FAST PATH: Fetch profile and roles in parallel with short timeout
      // Use 5s timeout for initial load - if it fails, we still have cached data
      const fastTimeout = 5000;
      
      const [profileResult, rolesResult] = await Promise.allSettled([
        withTimeout(fetchProfile(userId), fastTimeout),
        withTimeout(fetchRoles(userId), fastTimeout),
      ]);

      const profileData = profileResult.status === 'fulfilled' ? profileResult.value : null;
      const rolesData = rolesResult.status === 'fulfilled' ? rolesResult.value : [];

      // Set profile and roles immediately - don't wait for driver profile
      setProfile(profileData ?? null);
      // Keep existing roles if fetch failed but we had cached ones
      // IMPORTANT: use functional update to avoid stale-closure race (this fn
      // can be captured by the onAuthStateChange callback which has [] deps).
      let finalRoles = rolesData;
      setRoles(prev => {
        finalRoles = rolesData.length > 0 ? rolesData : prev;
        return finalRoles;
      });

      // Fetch driver profile for ALL users who have the driver role
      // Do this in the foreground (not background) to ensure it's available for the dashboard
      if (finalRoles.includes('driver')) {
        try {
          const driverData = await withTimeout(fetchDriverProfile(userId), fastTimeout);
          setDriverProfile(driverData ?? null);
          
          // Update cache with driver profile
          writeAuthCache(userId, {
            profile: (profileData ?? null) as any,
            roles: finalRoles,
            driverProfile: driverData ?? null,
            cachedAt: Date.now(),
          });
        } catch (e) {
          console.warn('Driver profile fetch failed, will retry on next load:', e);
          // Still cache what we have
          writeAuthCache(userId, {
            profile: (profileData ?? null) as any,
            roles: finalRoles,
            driverProfile: null,
            cachedAt: Date.now(),
          });
        }
      } else {
        // Cache what we have for non-drivers
        writeAuthCache(userId, {
          profile: (profileData ?? null) as any,
          roles: finalRoles,
          driverProfile: null,
          cachedAt: Date.now(),
        });
      }

    } catch (e) {
      console.error('Error in loadUserData:', e);
      // On error, keep existing state - don't wipe anything
    } finally {
      // CRITICAL: always clear profileLoading
      setProfileLoading(false);
    }
  };

  const refreshSession = async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) setAuthLoading(true);

    try {
      const {
        data: { session: next },
      } = await withTimeout(supabase.auth.getSession(), 12000);

      // If we have a session, set it immediately (do not wait for profile fetch).
      if (next?.user) {
        setSession(next);
        setUser(next.user);
        hydrateFromCache(next.user.id);

        // If we don't have roles yet, attempt to (re)load user data in the background.
        if (rolesRef.current.length === 0) {
          await loadUserData(next.user.id);
        }
        return;
      }

      // No session: do NOT aggressively clear state during iOS resume.
      const recentlyResumed = Date.now() - lastResumeAttemptAtRef.current < 7000;
      if (!recentlyResumed) {
        setSession(null);
        setUser(null);
        setProfile(null);
        setDriverProfile(null);
        setRoles([]);
      }
    } catch (e) {
      // Keep existing state on transient errors/timeouts.
      console.warn('[Auth] refreshSession failed (keeping existing state):', e);
    } finally {
      if (!silent) setAuthLoading(false);
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
          const hydrated = hydrateFromCache(nextSession.user.id);
          // If we hydrated successfully, immediately clear authLoading for instant UI
          if (hydrated && !isBackgroundRefresh) {
            setAuthLoading(false);
          }
          // Load fresh data (will be quick with new fast path)
          await loadUserData(nextSession.user.id);

          // OneSignal: fire-and-forget so it never blocks auth/navigation
          // Use window.OneSignal for native Median/iOS compatibility
          const osUserId = nextSession.user.id;
          setTimeout(() => {
            (async () => {
              try {
                const os = (window as any).OneSignalDeferred || (window as any).OneSignal;
                if (!os) {
                  // Fallback to react-onesignal SDK
                  await OneSignal.login(osUserId);
                  await OneSignal.User.PushSubscription.optIn();
                  console.log("✅ OneSignal linked (SDK) for:", osUserId);
                  return;
                }

                // Native OneSignal (Median / web SDK v16+)
                if (typeof os.push === 'function' || Array.isArray(os)) {
                  // OneSignalDeferred queue pattern
                  os.push(async function(onesignal: any) {
                    await onesignal.login(osUserId);
                    console.log("✅ OneSignal login (deferred) for:", osUserId);
                  });
                } else if (typeof os.login === 'function') {
                  await os.login(osUserId);
                  console.log("✅ OneSignal login (direct) for:", osUserId);
                } else {
                  // react-onesignal fallback
                  await OneSignal.login(osUserId);
                  console.log("✅ OneSignal login (react-sdk) for:", osUserId);
                }

                // Also try react-onesignal for role tagging & player ID
                try {
                  await OneSignal.User.PushSubscription.optIn();
                  const currentRoles = rolesRef.current;
                  if (currentRoles.includes('driver')) {
                    await OneSignal.User.addTag("role", "driver");
                    console.log("🏷️ OneSignal tagged as driver");
                  } else if (currentRoles.includes('rider')) {
                    await OneSignal.User.addTag("role", "rider");
                    console.log("🏷️ OneSignal tagged as rider");
                  }

                  const playerId = OneSignal.User.PushSubscription.id;
                  if (playerId) {
                    await supabase
                      .from('profiles')
                      .update({ onesignal_player_id: playerId } as any)
                      .eq('user_id', osUserId);
                    console.log("✅ OneSignal player ID saved:", playerId);
                  }
                } catch (tagErr) {
                  console.log("⚠️ OneSignal tagging skipped (non-blocking):", tagErr);
                }
              } catch (e) {
                console.log("❌ OneSignal init error (non-blocking):", e);
              }
            })();
          }, 0);
        } else {
          setProfile(null);
          setDriverProfile(null);
          setRoles([]);

          // OneSignal: disassociate device from any user (try native first)
          try {
            const os = (window as any).OneSignalDeferred || (window as any).OneSignal;
            if (os && typeof os.push === 'function') {
              os.push(async function(onesignal: any) { await onesignal.logout(); });
            } else if (os && typeof os.logout === 'function') {
              await os.logout();
            } else {
              OneSignal.logout();
            }
            console.log("✅ OneSignal logout");
          } catch {}
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
      
      // "Remember me" logic:
      // - If user checked "Remember me", localStorage has 'drivvme_remember_me' = 'true' -> keep session forever
      // - If user unchecked "Remember me", we clear the localStorage flag during login
      //   We use sessionStorage 'drivvme_session_active' to track active browser sessions
      //   When browser closes, sessionStorage clears. On next open:
      //     - If rememberMe is true -> keep session (user explicitly wanted to stay logged in)
      //     - If rememberMe is false AND no active session marker -> sign out
      const rememberMe = localStorage.getItem('drivvme_remember_me') === 'true';
      const isActiveSession = sessionStorage.getItem('drivvme_session_active') === 'true';
      
      // CRITICAL: If "Remember me" was checked, ALWAYS keep the session - do NOT sign out
      if (existingSession && rememberMe) {
        // User explicitly asked to be remembered - keep them signed in
        sessionStorage.setItem('drivvme_session_active', 'true');
        console.log('[Auth] Remember me is enabled - keeping session');
      } else if (existingSession && !rememberMe && !isActiveSession) {
        // User had logged in without "Remember me" and this is a new browser session
        // Sign them out
        console.log('[Auth] Remember me disabled and new browser session - signing out');
        localStorage.removeItem('drivvme_remember_me');
        await supabase.auth.signOut();
        setAuthLoading(false);
        setHasInitialized(true);
        return;
      } else if (existingSession) {
        // Mark this browser session as active (for non-remember-me users in current session)
        sessionStorage.setItem('drivvme_session_active', 'true');
      }
      
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

          // Best-effort, silent session re-check.
          await refreshSession({ silent: true });
        } finally {
          resumeCheckInFlight.current = null;
        }
      })();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') resumeCheck();
    };

    // iOS Safari often restores pages from bfcache; pageshow is a reliable resume signal.
    const onPageShow = () => resumeCheck();

    window.addEventListener('focus', resumeCheck);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('focus', resumeCheck);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
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

  const signIn = async (email: string, password: string, rememberMe: boolean = true) => {
    // Don't set isLoading here - onAuthStateChange handles it
    
    // Store remember me preference
    try {
      if (rememberMe) {
        // Remember me checked: persist session across browser restarts
        localStorage.setItem('drivvme_remember_me', 'true');
      } else {
        // Remember me unchecked: session ends when browser closes
        localStorage.removeItem('drivvme_remember_me');
      }
      // Mark current browser session as active
      sessionStorage.setItem('drivvme_session_active', 'true');
    } catch {}
    
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
    // Mark rider offline in rider_locations BEFORE clearing state
    const currentUserId = userRef.current?.id;
    if (currentUserId) {
      void (async () => {
        try {
          await supabase
            .from("rider_locations")
            .update({ is_online: false, last_seen_at: new Date().toISOString() })
            .eq("user_id", currentUserId);
          console.log("[Auth] rider_locations marked offline");
        } catch {}
      })();
    }

    // Clear local state IMMEDIATELY for instant UI feedback
    setUser(null);
    setSession(null);
    setProfile(null);
    setDriverProfile(null);
    setRoles([]);
    
    // OneSignal: disassociate device from user
    try { OneSignal.logout(); } catch {}

    // Clear cached auth data and remember me preferences
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('auth-cache:'));
      keys.forEach(k => localStorage.removeItem(k));
      localStorage.removeItem('last_route');
      localStorage.removeItem('drivvme_remember_me');
      sessionStorage.removeItem('drivvme_session_active');
    } catch {}

    // Fire-and-forget the actual signOut call to Supabase
    supabase.auth.signOut().catch((error: any) => {
      console.error('Error signing out:', error);
    });

    toast({
      title: 'Signed out',
      description: 'See you next time!',
    });
  };

  const refreshProfile = async () => {
    if (user) {
      const data = await fetchProfile(user.id);
      setProfile(data);
    }
  };

  const refreshDriverProfile = async () => {
    if (!user) return;
    try {
      const data = await fetchDriverProfile(user.id);
      setDriverProfile(data);
    } catch {
      // keep existing driverProfile on transient failures
    }
  };

  const isRider = roles.includes('rider');
  const isDriver = roles.includes('driver');
  const isAdmin = roles.includes('admin') || user?.email === 'alsenesa@hotmail.com';

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
        refreshSession,
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