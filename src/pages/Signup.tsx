import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Car, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import Logo from '@/components/Logo';
import LanguageToggle from '@/components/LanguageToggle';

const Signup = () => {
  const { t } = useLanguage();
  const { signUp, isLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const [role, setRole] = useState<'rider' | 'driver'>(
    (searchParams.get('role') as 'rider' | 'driver') || 'rider'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const [signupComplete, setSignupComplete] = useState(false);
  const [targetRoute, setTargetRoute] = useState<string | null>(null);
  const { user, roles, isLoading: authLoading } = useAuth();

  // Wait for roles to load after signup before navigating
  useEffect(() => {
    if (signupComplete && user && !authLoading && roles.length > 0 && targetRoute) {
      navigate(targetRoute, { replace: true });
    }
  }, [signupComplete, user, authLoading, roles.length, targetRoute, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    try {
      await signUp(email, password, role, firstName, lastName, phone);
      // Set the target route and mark signup complete - navigation will happen via useEffect once roles load
      setTargetRoute(role === 'driver' ? '/driver' : '/ride');
      setSignupComplete(true);
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
              {t('auth.signupTitle')}
            </h1>
            <p className="text-muted-foreground text-center mb-8">
              {t('auth.signupAs')}
            </p>

            {/* Role Toggle */}
            <div className="flex gap-2 mb-8 p-1 bg-muted rounded-xl">
              <button
                type="button"
                onClick={() => setRole('rider')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg transition-all ${
                  role === 'rider'
                    ? 'bg-primary text-primary-foreground shadow-button'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <User className="h-5 w-5" />
                {t('auth.rider')}
              </button>
              <button
                type="button"
                onClick={() => setRole('driver')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg transition-all ${
                  role === 'driver'
                    ? 'bg-primary text-primary-foreground shadow-button'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Car className="h-5 w-5" />
                {t('auth.driver')}
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">{t('auth.firstName')}</Label>
                  <Input
                    id="firstName"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">{t('auth.lastName')}</Label>
                  <Input
                    id="lastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    className="bg-background"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-background"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">{t('auth.phone')}</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="bg-background"
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

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t('auth.confirmPassword')}</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="bg-background"
                />
              </div>

              {error && (
                <p className="text-destructive text-sm text-center">{error}</p>
              )}

              <Button
                type="submit"
                className="w-full gradient-primary shadow-button py-6"
                disabled={isLoading}
              >
                {isLoading ? t('common.loading') : t('auth.signupBtn')}
              </Button>
            </form>

            <p className="mt-6 text-center text-muted-foreground">
              {t('auth.hasAccount')}{' '}
              <Link to="/login" className="text-primary hover:underline">
                {t('nav.login')}
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Signup;