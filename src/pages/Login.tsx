import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import Logo from '@/components/Logo';
import LanguageToggle from '@/components/LanguageToggle';

const Login = () => {
  const { t } = useLanguage();
  const { signIn, isLoading, isRider, isDriver, isAdmin, user } = useAuth();
  const navigate = useNavigate();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  // After auth state + roles load, route user to the right dashboard
  // (prevents "login then immediately back to login" race)
  useEffect(() => {
    if (isLoading) return;
    if (!user) return;

    if (isAdmin) navigate('/admin', { replace: true });
    else if (isDriver) navigate('/driver', { replace: true });
    else if (isRider) navigate('/ride', { replace: true });
    else navigate('/', { replace: true });
  }, [user, isLoading, isAdmin, isDriver, isRider, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      await signIn(email, password);
      // Navigation is handled by the effect above once roles are loaded
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen gradient-hero flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <Link to="/">
          <Logo />
        </Link>
        <LanguageToggle />
      </div>

      {/* Form */}
      <div className="flex-1 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <div className="bg-card rounded-2xl p-8 shadow-card border border-border">
            <h1 className="font-display text-3xl font-bold text-center mb-2">
              {t('auth.loginTitle')}
            </h1>
            <p className="text-muted-foreground text-center mb-8">
              Sign in to continue
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-background"
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t('auth.password')}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="bg-background pr-10"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-destructive text-sm text-center">{error}</p>
              )}

              <Button
                type="submit"
                className="w-full gradient-primary shadow-button py-6"
                disabled={isLoading}
              >
                {isLoading ? t('common.loading') : t('auth.loginBtn')}
              </Button>
            </form>

            <p className="mt-6 text-center text-muted-foreground">
              {t('auth.noAccount')}{' '}
              <Link to="/signup" className="text-primary hover:underline">
                {t('nav.signup')}
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Login;