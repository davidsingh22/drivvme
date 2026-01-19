// Drivveme Pricing Engine
// 15% cheaper than Uber, with a flat $5 platform fee per ride

// Base rates (similar to Uber Quebec, but 15% cheaper)
const BASE_FARE = 2.50 * 0.85; // Base fare in CAD
const PER_KM_RATE = 1.25 * 0.85; // Per km rate in CAD
const PER_MINUTE_RATE = 0.30 * 0.85; // Per minute rate in CAD
const MINIMUM_FARE = 5.00 * 0.85; // Minimum fare in CAD
const PLATFORM_FEE = 5.00; // Fixed platform fee in CAD

// Time-based surge multipliers
const getSurgeMultiplier = (hour: number): number => {
  // Rush hours: 7-9 AM and 5-7 PM
  if ((hour >= 7 && hour < 9) || (hour >= 17 && hour < 19)) {
    return 1.25;
  }
  // Late night: 11 PM - 5 AM
  if (hour >= 23 || hour < 5) {
    return 1.5;
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
  const distanceFare = distanceKm * PER_KM_RATE;
  const timeFare = durationMinutes * PER_MINUTE_RATE;
  
  let subtotal = (baseFare + distanceFare + timeFare) * surgeMultiplier;
  
  // Apply minimum fare
  if (subtotal < MINIMUM_FARE) {
    subtotal = MINIMUM_FARE;
  }

  const total = Math.round(subtotal * 100) / 100;
  
  // Calculate what Uber would charge (15% more)
  const uberEquivalent = Math.round((total / 0.85) * 100) / 100;
  const savings = Math.round((uberEquivalent - total) * 100) / 100;
  const savingsPercent = 15;

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