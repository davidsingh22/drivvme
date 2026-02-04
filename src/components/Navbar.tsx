import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Menu, X, User, LogOut, Shield, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import Logo from './Logo';
import LanguageToggle from './LanguageToggle';
import { PushNotificationToggle } from './PushNotificationToggle';
import NotificationsBell from './NotificationsBell';
import RiderProfileModal from './RiderProfileModal';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const {
    t,
    language
  } = useLanguage();
  const {
    user,
    profile,
    isRider,
    isDriver,
    isAdmin,
    signOut
  } = useAuth();
  const navigate = useNavigate();
  const [activeDriverRideId, setActiveDriverRideId] = useState<string | null>(null);

  // Best-effort active ride lookup for driver deep-linking (mobile menu).
  useEffect(() => {
    if (!user?.id || !isDriver) {
      setActiveDriverRideId(null);
      return;
    }
    let cancelled = false;
    const fetchActiveDriverRide = async () => {
      const {
        data,
        error
      } = await supabase.from('rides').select('id, status').eq('driver_id', user.id).in('status', ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress']).order('created_at', {
        ascending: false
      }).limit(1).maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setActiveDriverRideId(null);
        return;
      }
      setActiveDriverRideId(data.id);
    };
    fetchActiveDriverRide();
    const channel = supabase.channel(`navbar-driver-active-ride-${user.id}`).on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'rides',
      filter: `driver_id=eq.${user.id}`
    }, () => {
      fetchActiveDriverRide();
    }).subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id, isDriver]);
  const handleSignOut = () => {
    // Navigate immediately for instant feedback, signOut runs in background
    navigate('/');
    signOut();
  };
  const getInitials = () => {
    if (profile?.first_name && profile?.last_name) {
      return `${profile.first_name[0]}${profile.last_name[0]}`.toUpperCase();
    }
    return user?.email?.[0]?.toUpperCase() || 'U';
  };
  return <motion.nav initial={{
    y: -20,
    opacity: 0
  }} animate={{
    y: 0,
    opacity: 1
  }} className="fixed top-0 left-0 right-0 z-50 glass">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/">
            <Logo />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-6">
            {user ? <>
                {isRider && <Link to="/ride" className="text-muted-foreground hover:text-foreground transition-colors">
                    {t('nav.ride')}
                  </Link>}
                {isDriver && <>
                    <Link to="/driver" className="text-muted-foreground hover:text-foreground transition-colors">
                      {t('nav.availableRides')}
                    </Link>
                    <Link to="/earnings" className="text-muted-foreground hover:text-foreground transition-colors">
                      {t('nav.earnings')}
                    </Link>
                    <Link to="/history" className="text-muted-foreground hover:text-foreground transition-colors">
                      {t('nav.history')}
                    </Link>
                    <Link to={activeDriverRideId ? `/driver/messages?rideId=${activeDriverRideId}` : '/driver/messages'} className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                      <MessageSquare className="h-4 w-4" />
                      {language === 'fr' ? 'Messages' : 'Messages'}
                    </Link>
                  </>}
                {isRider && <Link to="/history" className="text-muted-foreground hover:text-foreground transition-colors">
                    {t('nav.history')}
                  </Link>}
                {isAdmin && <Link to="/admin" className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                    <Shield className="h-4 w-4" />
                    Admin
                  </Link>}
              </> : <>
                <Link to="/ride" className="text-muted-foreground hover:text-foreground transition-colors">
                  {t('nav.ride')}
                </Link>
                
              </>}
          </div>

          {/* Right side */}
          <div className="hidden md:flex items-center gap-4">
            {user && <NotificationsBell userId={user.id} />}
            <PushNotificationToggle />
            <LanguageToggle />
            
            {user ? <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={profile?.avatar_url || undefined} />
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {getInitials()}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="flex items-center justify-start gap-2 p-2">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium">
                        {profile?.first_name} {profile?.last_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {user.email}
                      </p>
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="cursor-pointer" onClick={() => setProfileModalOpen(true)}>
                    <User className="mr-2 h-4 w-4" />
                    {t('nav.profile')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    {t('nav.logout')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu> : <div className="flex items-center gap-2">
                <Button variant="ghost" asChild>
                  <Link to="/login">{t('nav.login')}</Link>
                </Button>
                <Button asChild className="gradient-primary shadow-button">
                  <Link to="/signup">{t('nav.signup')}</Link>
                </Button>
              </div>}
          </div>

          {/* Mobile menu button */}
          <button className="md:hidden p-2" onClick={() => setIsOpen(!isOpen)}>
            {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {/* Mobile Navigation */}
        {isOpen && <motion.div initial={{
        opacity: 0,
        height: 0
      }} animate={{
        opacity: 1,
        height: 'auto'
      }} exit={{
        opacity: 0,
        height: 0
      }} className="md:hidden py-4 border-t border-border">
            <div className="flex flex-col gap-4">
              {user ? <>
                  {isRider && <Link to="/ride" className="px-4 py-2 text-muted-foreground hover:text-foreground" onClick={() => setIsOpen(false)}>
                      {t('nav.ride')}
                    </Link>}
                  {isDriver && <>
                      <Link to="/driver" className="px-4 py-2 text-muted-foreground hover:text-foreground" onClick={() => setIsOpen(false)}>
                        {t('nav.availableRides')}
                      </Link>
                      <Link to="/earnings" className="px-4 py-2 text-muted-foreground hover:text-foreground" onClick={() => setIsOpen(false)}>
                        {t('nav.earnings')}
                      </Link>
                    </>}
                  <Link to="/history" className="px-4 py-2 text-muted-foreground hover:text-foreground" onClick={() => setIsOpen(false)}>
                    {t('nav.history')}
                  </Link>

                  {/* Driver Messages (required: directly under My Rides) */}
                  {isDriver && <Link to={activeDriverRideId ? `/driver/messages?rideId=${activeDriverRideId}` : '/driver/messages'} className="px-4 py-2 text-muted-foreground hover:text-foreground flex items-center gap-2" onClick={() => setIsOpen(false)}>
                      <MessageSquare className="h-4 w-4" />
                      {language === 'fr' ? 'Messages' : 'Messages'}
                    </Link>}
                  {isAdmin && <Link to="/admin" className="px-4 py-2 text-muted-foreground hover:text-foreground flex items-center gap-2" onClick={() => setIsOpen(false)}>
                      <Shield className="h-4 w-4" />
                      Admin Dashboard
                    </Link>}
                  <button onClick={() => {
              setProfileModalOpen(true);
              setIsOpen(false);
            }} className="px-4 py-2 text-left text-muted-foreground hover:text-foreground w-full">
                    {t('nav.profile')}
                  </button>
                  <button onClick={() => {
              handleSignOut();
              setIsOpen(false);
            }} className="px-4 py-2 text-left text-destructive">
                    {t('nav.logout')}
                  </button>
                </> : <>
                  <Link to="/ride" className="px-4 py-2 text-muted-foreground hover:text-foreground" onClick={() => setIsOpen(false)}>
                    {t('nav.ride')}
                  </Link>
                  <Link to="/drive" className="px-4 py-2 text-muted-foreground hover:text-foreground" onClick={() => setIsOpen(false)}>
                    {t('nav.drive')}
                  </Link>
                  <div className="px-4 flex gap-2">
                    <Button variant="ghost" asChild className="flex-1">
                      <Link to="/login" onClick={() => setIsOpen(false)}>
                        {t('nav.login')}
                      </Link>
                    </Button>
                    <Button asChild className="flex-1 gradient-primary">
                      <Link to="/signup" onClick={() => setIsOpen(false)}>
                        {t('nav.signup')}
                      </Link>
                    </Button>
                  </div>
                </>}
              <div className="px-4">
                <LanguageToggle />
              </div>
            </div>
          </motion.div>}
      </div>
      
      {/* Rider Profile Modal */}
      <RiderProfileModal open={profileModalOpen} onOpenChange={setProfileModalOpen} />
    </motion.nav>;
};
export default Navbar;