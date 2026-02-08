import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import drivvemeCarIcon from '@/assets/drivveme-car-icon.png';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import LanguageToggle from '@/components/LanguageToggle';
import loginBg from '@/assets/drivveme-welcome-bg.png';
const Login = () => {
  const {
    t
  } = useLanguage();
  const {
    signIn,
    isLoading,
    roles,
    isRider,
    isDriver,
    isAdmin,
    user
  } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // If auth completes (even before routing), stop the button spinner
  useEffect(() => {
    if (!isSubmitting) return;
    // IMPORTANT: don't block UI on global auth data loading (roles/profile can be slow on mobile).
    // As soon as we have a user session, stop the local submit spinner.
    if (user) setIsSubmitting(false);
  }, [isSubmitting, user]);

  // After auth completes, route user based on roles
  useEffect(() => {
    if (!user) return;

    // If roles are already loaded, route immediately
    if (roles.length > 0) {
      if (isAdmin) navigate('/admin', {
        replace: true
      });else if (isDriver) navigate('/driver', {
        replace: true
      });else if (isRider) navigate('/ride', {
        replace: true
      });else navigate('/ride', {
        replace: true
      }); // Default for new users
      return;
    }

    // Give roles more time to load (especially on slow mobile connections)
    // After 5s, check one more time then route
    const timeout = setTimeout(() => {
      // Final check - if still no roles, route based on what we have
      if (isAdmin) navigate('/admin', {
        replace: true
      });else if (isDriver) navigate('/driver', {
        replace: true
      });else navigate('/ride', {
        replace: true
      });
    }, 5000);
    return () => clearTimeout(timeout);
  }, [user, roles.length, isAdmin, isDriver, isRider, navigate]);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await signIn(email, password, rememberMe);
      // Navigation is handled by the effect above once roles are loaded
    } catch (err: any) {
      setError(err.message);
      setIsSubmitting(false);
    }
  };
  return <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Purple gradient background */}
      <div className="absolute inset-0 z-0" style={{
      background: 'radial-gradient(ellipse at center, hsl(270 60% 25%) 0%, hsl(270 50% 10%) 60%, hsl(270 40% 5%) 100%)'
    }} />

      {/* Language toggle top-right */}
      <div className="absolute top-4 right-4 z-20">
        <LanguageToggle />
      </div>

      {/* Centered content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-start pt-12 pb-8 px-4">
        {/* Logo icon with glow */}
        <motion.div initial={{
        opacity: 0,
        scale: 0.8
      }} animate={{
        opacity: 1,
        scale: 1
      }} transition={{
        duration: 0.5
      }} className="mb-3">
          <div className="h-20 w-20 rounded-full flex items-center justify-center logo-icon-pulse" style={{
          background: 'radial-gradient(circle, hsl(var(--primary)) 0%, hsl(270 60% 20%) 100%)',
          boxShadow: '0 0 40px hsl(var(--primary) / 0.5), 0 0 80px hsl(var(--primary) / 0.3)'
        }}>
            <img src={drivvemeCarIcon} alt="Drivveme" className="h-[4.5rem] w-[4.5rem] object-contain" />
          </div>
        </motion.div>

        {/* Brand name */}
        <motion.h1 initial={{
        opacity: 0,
        y: 10
      }} animate={{
        opacity: 1,
        y: 0
      }} transition={{
        delay: 0.2
      }} className="font-display text-4xl font-bold mb-8 logo-flash">
          Drivve<span className="text-accent">Me</span>
        </motion.h1>

        {/* Login card */}
        <motion.div initial={{
        opacity: 0,
        y: 20
      }} animate={{
        opacity: 1,
        y: 0
      }} transition={{
        delay: 0.3
      }} className="w-full max-w-md">
          <div className="rounded-2xl p-8 border border-white/10" style={{
          background: 'rgba(20, 10, 35, 0.75)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4)'
        }}>
            <h2 className="font-display text-2xl font-bold text-center mb-1 text-foreground">
              {t('auth.loginTitle')}
            </h2>
            <p className="text-muted-foreground text-center text-sm mb-6">
              Connectez-vous pour continuer
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required className="bg-background/50 border-white/10" placeholder="you@example.com" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t('auth.password')}</Label>
                <div className="relative">
                  <Input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required className="bg-background/50 border-white/10 pr-10" placeholder="••••••••" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox id="rememberMe" checked={rememberMe} onCheckedChange={checked => setRememberMe(checked === true)} />
                <Label htmlFor="rememberMe" className="text-sm font-normal text-muted-foreground cursor-pointer">
                  Se souvenir de moi
                </Label>
              </div>

              {error && <p className="text-destructive text-sm text-center">{error}</p>}

              <Button type="submit" className="w-full gradient-primary shadow-button py-6" disabled={isSubmitting}>
                {isSubmitting ? t('common.loading') : t('auth.loginBtn')}
              </Button>
            </form>

            <p className="mt-6 text-center text-muted-foreground text-sm">
              {t('auth.noAccount')}{' '}
              <Link to="/signup" className="text-primary hover:underline">
                {t('nav.signup')}
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>;
};
export default Login;