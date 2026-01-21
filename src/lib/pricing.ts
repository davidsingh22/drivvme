// Drivveme Pricing Engine
// 15% cheaper than Uber, with a flat $5 platform fee per ride
// Calibrated against real Uber Quebec rates (Jan 2026)

// Uber Quebec base rates (UberX)
const UBER_BASE_FARE = 3.50; // Uber base fare in CAD
const UBER_PER_KM_RATE = 1.45; // Uber per km rate in CAD
const UBER_PER_MINUTE_RATE = 0.38; // Uber per minute rate in CAD
const UBER_BOOKING_FEE = 2.85; // Uber booking fee in CAD
const UBER_MINIMUM_FARE = 7.50; // Uber minimum fare in CAD

// Drivveme rates: 15% cheaper than Uber
const DISCOUNT_FACTOR = 0.85;
const BASE_FARE = UBER_BASE_FARE * DISCOUNT_FACTOR;
const PER_KM_RATE = UBER_PER_KM_RATE * DISCOUNT_FACTOR;
const PER_MINUTE_RATE = UBER_PER_MINUTE_RATE * DISCOUNT_FACTOR;
const BOOKING_FEE = UBER_BOOKING_FEE * DISCOUNT_FACTOR;
const MINIMUM_FARE = UBER_MINIMUM_FARE * DISCOUNT_FACTOR;
const PLATFORM_FEE = 5.00; // Fixed platform fee to driver in CAD

// Time-based surge multipliers (matching Uber surge patterns)
const getSurgeMultiplier = (hour: number): number => {
  // Rush hours: 7-9 AM and 5-7 PM
  if ((hour >= 7 && hour < 9) || (hour >= 17 && hour < 19)) {
    return 1.20;
  }
  // Late night: 11 PM - 5 AM
  if (hour >= 23 || hour < 5) {
    return 1.35;
  }
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