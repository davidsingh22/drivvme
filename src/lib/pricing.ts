// Drivveme Pricing Engine
// Always 15% cheaper than Uber, with a flat $5 platform fee per ride
// Calibrated against real Uber Quebec rates (Jan 2026)

// Uber Quebec base rates (UberX) - calibrated from actual Uber app
// NOTE: We price off distance+time; keep these tuned so our totals stay
// consistently below Uber for common Montreal routes.
const UBER_BASE_FARE = 2.50; // Uber base fare in CAD
// Calibrated so 11.6km / 23min = $17.55 Uber → $14.92 Drivveme (15% off)
const UBER_PER_KM_RATE = 0.715; // Uber per km rate in CAD
const UBER_PER_MINUTE_RATE = 0.185; // Uber per minute rate in CAD
const UBER_BOOKING_FEE = 2.50; // Uber booking fee in CAD
const UBER_MINIMUM_FARE = 6.00; // Uber minimum fare in CAD

// Drivveme rates: 15% cheaper than Uber (always)
const DISCOUNT_FACTOR = 0.85;
const BASE_FARE = UBER_BASE_FARE * DISCOUNT_FACTOR;
const PER_KM_RATE = UBER_PER_KM_RATE * DISCOUNT_FACTOR;
const PER_MINUTE_RATE = UBER_PER_MINUTE_RATE * DISCOUNT_FACTOR;
const BOOKING_FEE = UBER_BOOKING_FEE * DISCOUNT_FACTOR;
const MINIMUM_FARE = UBER_MINIMUM_FARE * DISCOUNT_FACTOR;
const PLATFORM_FEE = 5.00; // Fixed platform fee to driver in CAD

// NO surge pricing for Drivveme - we stay flat while Uber surges
const getSurgeMultiplier = (_hour: number): number => {
  // Drivveme doesn't apply surge - this is our competitive advantage
  return 1.0;
};

export interface FareEstimate {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  surgeMultiplier: number;
  subtotal: number;
  total: number;
  platformFee: number;
  driverEarnings: number;
  uberEquivalent: number;
  savings: number;
  savingsPercent: number;
}

export const calculateFare = (
  distanceKm: number,
  durationMinutes: number,
  applySurge: boolean = true
): FareEstimate => {
  const hour = new Date().getHours();
  const surgeMultiplier = applySurge ? getSurgeMultiplier(hour) : 1.0;

  const baseFare = BASE_FARE;
  const bookingFee = BOOKING_FEE;
  const distanceFare = distanceKm * PER_KM_RATE;
  const timeFare = durationMinutes * PER_MINUTE_RATE;
  
  let subtotal = (baseFare + bookingFee + distanceFare + timeFare) * surgeMultiplier;
  
  // Apply minimum fare
  if (subtotal < MINIMUM_FARE) {
    subtotal = MINIMUM_FARE;
  }

  const total = Math.round(subtotal * 100) / 100;
  
  // Calculate what Uber would charge (our price / 0.85 = Uber equivalent)
  const uberEquivalent = Math.round((total / DISCOUNT_FACTOR) * 100) / 100;
  const savings = Math.round((uberEquivalent - total) * 100) / 100;
  const savingsPercent = Math.round((1 - DISCOUNT_FACTOR) * 100);

  // Driver earnings = total fare - $5 platform fee
  const driverEarnings = Math.max(0, total - PLATFORM_FEE);

  return {
    baseFare: Math.round(baseFare * 100) / 100,
    distanceFare: Math.round(distanceFare * 100) / 100,
    timeFare: Math.round(timeFare * 100) / 100,
    surgeMultiplier,
    subtotal: Math.round(subtotal * 100) / 100,
    total,
    platformFee: PLATFORM_FEE,
    driverEarnings: Math.round(driverEarnings * 100) / 100,
    uberEquivalent,
    savings,
    savingsPercent,
  };
};

export const formatCurrency = (amount: number, language: 'en' | 'fr' = 'en'): string => {
  return new Intl.NumberFormat(language === 'fr' ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount);
};

export const formatDistance = (km: number, language: 'en' | 'fr' = 'en'): string => {
  return `${km.toFixed(1)} km`;
};

export const formatDuration = (minutes: number, language: 'en' | 'fr' = 'en'): string => {
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (language === 'fr') {
    return `${hours}h ${mins}min`;
  }
  return `${hours}h ${mins}m`;
};