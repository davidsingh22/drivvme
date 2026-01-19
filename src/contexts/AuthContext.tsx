import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

type UserRole = 'rider' | 'driver';

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
  signUp: (email: string, password: string, role: UserRole, firstName?: string, lastName?: string, phone?: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshDriverProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching profile:', error);
    }
    return data;
  };

  const fetchDriverProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('driver_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching driver profile:', error);
    }
    return data;
  };

  const fetchRoles = async (userId: string): Promise<UserRole[]> => {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);

    if (error) {
      console.error('Error fetching roles:', error);
      return [];
    }
    return data?.map(r => r.role as UserRole) || [];
  };

  const loadUserData = async (userId: string) => {
    const [profileData, rolesData] = await Promise.all([
      fetchProfile(userId),
      fetchRoles(userId),
    ]);

    setProfile(profileData);
    setRoles(rolesData);

    if (rolesData.includes('driver')) {
      const driverData = await fetchDriverProfile(userId);
      setDriverProfile(driverData);
    }
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          // Use setTimeout to prevent race conditions with database triggers
          setTimeout(() => loadUserData(session.user.id), 100);
        } else {
          setProfile(null);
          setDriverProfile(null);
          setRoles([]);
        }
        setIsLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadUserData(session.user.id);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (
    email: string,
    password: string,
    role: UserRole,
    firstName?: string,
    lastName?: string,
    phone?: string
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

        // If driver, create driver profile
        if (role === 'driver') {
          await supabase
            .from('driver_profiles')
            .insert({ user_id: data.user.id });
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
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      toast({
        title: 'Welcome back!',
        description: 'Successfully signed in.',
      });
    } catch (error: any) {
      toast({
        title: 'Sign in failed',
        description: error.message,
        variant: 'destructive',
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
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