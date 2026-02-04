import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Car, Clock, Shield, Headphones, TrendingDown, MapPin, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import Navbar from '@/components/Navbar';
import landingBg from '@/assets/landing-cityscape-bg.png';

const features = [
  {
    icon: TrendingDown,
    key: 'savings',
    color: 'text-accent',
    bgColor: 'bg-accent/10',
  },
  {
    icon: Clock,
    key: 'fast',
    color: 'text-primary',
    bgColor: 'bg-primary/10',
  },
  {
    icon: Shield,
    key: 'safe',
    color: 'text-success',
    bgColor: 'bg-success/10',
  },
  {
    icon: Headphones,
    key: 'support',
    color: 'text-warning',
    bgColor: 'bg-warning/10',
  },
];

const Landing = () => {
  const { t } = useLanguage();
  const { user, isRider, isDriver } = useAuth();

  return (
    <div className="min-h-screen bg-background relative">
      {/* Full-page background image */}
      <div 
        className="fixed inset-0 z-0"
        style={{
          backgroundImage: `url(${landingBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      >
      {/* No overlay - full brightness */}
      </div>
      <div className="relative z-10">
        <Navbar />

      {/* Hero Section */}
      <section className="relative z-10 pt-32 pb-20 overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute -top-1/2 -right-1/4 w-[800px] h-[800px] rounded-full bg-primary/5 blur-3xl"
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
          <motion.div
            className="absolute -bottom-1/2 -left-1/4 w-[600px] h-[600px] rounded-full bg-accent/5 blur-3xl"
            animate={{
              scale: [1.2, 1, 1.2],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        </div>

        <div className="container mx-auto px-4 relative">
          <div className="max-w-4xl mx-auto text-center">
            {/* Main headline - elegant subtle glow */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mb-6"
            >
              <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-bold mb-4">
                <span className="text-foreground">
                  Same Ride.
                </span>
                <br />
                <span className="text-gradient">
                  Less Money.
                </span>
              </h1>
            </motion.div>

            {/* Subheadline - clean white, no glow */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-xl md:text-2xl text-foreground mb-12 max-w-2xl mx-auto"
            >
              Cheaper than the competition. Same great rides.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="flex flex-col sm:flex-row gap-4 justify-center mb-16"
            >
              <Button
                asChild
                size="lg"
                className="gradient-primary shadow-button text-lg px-8 py-6 rounded-xl group"
              >
                <Link to={user ? "/ride" : "/login"}>
                  {t('hero.cta.rider')}
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="text-lg px-8 py-6 rounded-xl border-2 hover:bg-primary/10 hover:border-primary"
              >
                <Link to={user && isDriver ? "/driver" : "/login"}>
                  <Car className="mr-2 h-5 w-5" />
                  Driver Login
                </Link>
              </Button>
            </motion.div>

          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-card">
        <div className="container mx-auto px-4">
          {/* Canadian Badge */}
          <div className="flex items-center justify-center gap-3 mb-10 px-6 py-3 rounded-full canadian-badge-glow">
            <div className="h-7 w-7 rounded-lg gradient-primary flex items-center justify-center shadow-button">
              <Car className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-lg text-white font-bold canadian-pride tracking-wide">
              Drivveme is a Canadian-owned company.
            </span>
            <span className="text-2xl flag-wave">🇨🇦</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => (
              <motion.div
                key={feature.key}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="p-6 rounded-2xl bg-background border border-border hover:border-primary/50 transition-colors group"
              >
                <div className={`w-14 h-14 rounded-xl ${feature.bgColor} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  <feature.icon className={`w-7 h-7 ${feature.color}`} />
                </div>
                <h3 className="font-display text-xl font-semibold mb-2">
                  {t(`features.${feature.key}.title`)}
                </h3>
                <p className="text-muted-foreground">
                  {t(`features.${feature.key}.desc`)}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="font-display text-4xl md:text-5xl font-bold mb-4">
              How it <span className="text-gradient">works</span>
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              {
                step: '01',
                title: 'Enter destination',
                desc: 'Tell us where you want to go',
                icon: MapPin,
              },
              {
                step: '02',
                title: 'Get matched',
                desc: 'We find you the nearest driver',
                icon: Car,
              },
              {
                step: '03',
                title: 'Enjoy the ride',
                desc: 'Sit back and save money',
                icon: TrendingDown,
              },
            ].map((item, index) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.15 }}
                className="text-center"
              >
                <div className="relative inline-block mb-6">
                  <span className="font-display text-8xl font-bold text-primary/10">
                    {item.step}
                  </span>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full gradient-primary flex items-center justify-center shadow-button">
                      <item.icon className="w-8 h-8 text-primary-foreground" />
                    </div>
                  </div>
                </div>
                <h3 className="font-display text-xl font-semibold mb-2">
                  {item.title}
                </h3>
                <p className="text-muted-foreground">
                  {item.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 gradient-primary">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="text-center max-w-3xl mx-auto"
          >
            <h2 className="font-display text-4xl md:text-5xl font-bold text-primary-foreground mb-6">
              Ready to save on every ride?
            </h2>
            <p className="text-xl text-primary-foreground/80 mb-8">
              Join thousands of riders already saving money with Drivveme
            </p>
            <Button
              asChild
              size="lg"
              className="bg-background text-foreground hover:bg-background/90 text-lg px-8 py-6 rounded-xl"
            >
              <Link to="/signup">
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </motion.div>
        </div>
      </section>


      {/* Footer */}
      <footer className="py-12 bg-card border-t border-border">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Car className="h-6 w-6 text-primary" />
              <span className="font-display font-bold text-xl text-gradient">
                Drivveme
              </span>
            </div>
            <p className="text-muted-foreground text-sm">
              © {new Date().getFullYear()} Drivveme. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
      </div>
    </div>
  );
};

export default Landing;