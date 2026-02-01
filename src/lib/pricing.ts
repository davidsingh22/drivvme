// Drivveme Pricing Engine
// Always 7.5% cheaper than Uber, with tiered platform fees and Quebec taxes
// Calibrated against real Uber Quebec rates (Jan 2026)

import { calculatePlatformFee } from './platformFees';

// Uber Quebec base rates (UberX) - calibrated from actual Uber app
const UBER_BASE_FARE = 2.50;
const UBER_PER_KM_RATE = 0.715;
const UBER_PER_MINUTE_RATE = 0.185;
const UBER_BOOKING_FEE = 2.50;
const UBER_MINIMUM_FARE = 6.00;

// Calibration multiplier to match real Uber totals
const UBER_CALIBRATION_MULTIPLIER = 1.195;

// Drivveme discount: 7.5% cheaper than Uber (before taxes)
const PROMO_DISCOUNT = 0.075; // 7.5% promo discount
const DISCOUNT_FACTOR = 1 - PROMO_DISCOUNT; // 0.925

// Quebec taxes (GST 5% + QST 9.975% = 14.975%)
const QUEBEC_TAX_RATE = 0.14975;

const MINIMUM_FARE = UBER_MINIMUM_FARE * DISCOUNT_FACTOR;

// NO surge pricing for Drivveme
const getSurgeMultiplier = (_hour: number): number => 1.0;

export interface FareEstimate {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  bookingFee: number;
  surgeMultiplier: number;
  subtotal: number; // Before promo/taxes
  promoDiscount: number; // 7.5% discount amount
  afterPromo: number; // Subtotal - promo
  taxes: number; // Quebec taxes (14.975%)
  total: number; // Final amount rider pays
  platformFee: number; // Tiered fee based on afterPromo
  driverEarnings: number;
  uberEquivalent: number;
  uberBaseFare: number;
  uberBookingFee: number;
  uberDistanceFare: number;
  uberTimeFare: number;
  savings: number; // Dollar amount saved vs Uber
  savingsPercent: number;
}

export const calculateFare = (
  distanceKm: number,
  durationMinutes: number,
  applySurge: boolean = true
): FareEstimate => {
  const hour = new Date().getHours();
  const surgeMultiplier = applySurge ? getSurgeMultiplier(hour) : 1.0;

  // Calculate Uber-equivalent estimate
  const uberBaseFare = UBER_BASE_FARE * UBER_CALIBRATION_MULTIPLIER;
  const uberBookingFee = UBER_BOOKING_FEE * UBER_CALIBRATION_MULTIPLIER;
  const uberDistanceFare = distanceKm * UBER_PER_KM_RATE * UBER_CALIBRATION_MULTIPLIER;
  const uberTimeFare = durationMinutes * UBER_PER_MINUTE_RATE * UBER_CALIBRATION_MULTIPLIER;

  let uberSubtotal = (uberBaseFare + uberBookingFee + uberDistanceFare + uberTimeFare) * surgeMultiplier;
  if (uberSubtotal < UBER_MINIMUM_FARE) {
    uberSubtotal = UBER_MINIMUM_FARE;
  }
  const uberEquivalent = Math.round(uberSubtotal * 100) / 100;

  // Drivveme subtotal (before promo)
  const baseFare = uberBaseFare;
  const bookingFee = uberBookingFee;
  const distanceFare = uberDistanceFare;
  const timeFare = uberTimeFare;

  let subtotal = (baseFare + bookingFee + distanceFare + timeFare) * surgeMultiplier;
  if (subtotal < MINIMUM_FARE / DISCOUNT_FACTOR) {
    subtotal = MINIMUM_FARE / DISCOUNT_FACTOR;
  }

  // Apply 7.5% promo discount BEFORE taxes
  const promoDiscount = subtotal * PROMO_DISCOUNT;
  let afterPromo = subtotal - promoDiscount;
  
  // Ensure minimum fare after promo
  if (afterPromo < MINIMUM_FARE) {
    afterPromo = MINIMUM_FARE;
  }

  // Add Quebec taxes (14.975%) AFTER promo
  const taxes = afterPromo * QUEBEC_TAX_RATE;
  const total = Math.round((afterPromo + taxes) * 100) / 100;

  // Platform fee is based on the post-promo fare (before taxes)
  const platformFee = calculatePlatformFee(afterPromo);
  
  // Driver earnings = post-promo fare - platform fee (no taxes to driver)
  const driverEarnings = Math.max(0, afterPromo - platformFee);

  // Savings compared to Uber (total amount saved)
  const savings = Math.round((uberEquivalent - total) * 100) / 100;
  const savingsPercent = uberEquivalent > 0 ? Math.round((savings / uberEquivalent) * 100) : 0;

  return {
    baseFare: Math.round(baseFare * 100) / 100,
    bookingFee: Math.round(bookingFee * 100) / 100,
    distanceFare: Math.round(distanceFare * 100) / 100,
    timeFare: Math.round(timeFare * 100) / 100,
    surgeMultiplier,
    subtotal: Math.round(subtotal * 100) / 100,
    promoDiscount: Math.round(promoDiscount * 100) / 100,
    afterPromo: Math.round(afterPromo * 100) / 100,
    taxes: Math.round(taxes * 100) / 100,
    total,
    platformFee,
    driverEarnings: Math.round(driverEarnings * 100) / 100,
    uberEquivalent,
    uberBaseFare: Math.round(uberBaseFare * 100) / 100,
    uberBookingFee: Math.round(uberBookingFee * 100) / 100,
    uberDistanceFare: Math.round(uberDistanceFare * 100) / 100,
    uberTimeFare: Math.round(uberTimeFare * 100) / 100,
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
