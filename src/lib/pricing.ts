// Drivveme Pricing Engine
// 
// FORMULA FLOW (from Uber Quebec Rates):
// ========================================
// Uber Pre-Tax = (Base + Booking + Distance + Time) × 1.195
// Uber Final = Uber Pre-Tax × 1.14975 (Quebec taxes: GST 5% + QST 9.975%)
// Drivveme Final = Uber Final × 0.925 (7.5% cheaper)
//
// UBER QUEBEC RATES (UberX):
// - Base Fare: $2.50
// - Per KM: $0.715
// - Per Minute: $0.185
// - Booking Fee: $2.50
// - Minimum Fare: $6.00
// - Calibration Multiplier: 1.195×

import { calculatePlatformFee } from './platformFees';

// Uber Quebec base rates (UberX)
const UBER_BASE_FARE = 2.50;
const UBER_PER_KM_RATE = 0.715;
const UBER_PER_MINUTE_RATE = 0.185;
const UBER_BOOKING_FEE = 2.50;
const UBER_MINIMUM_FARE = 6.00;

// Calibration multiplier to match real Uber totals
const UBER_CALIBRATION_MULTIPLIER = 1.195;

// Quebec taxes (GST 5% + QST 9.975% = 14.975%)
// Uber Final = Uber Pre-Tax × 1.14975
const QUEBEC_TAX_MULTIPLIER = 1.14975;
const QUEBEC_TAX_RATE = 0.14975;

// Drivveme is 7.5% cheaper than Uber AFTER taxes
// Drivveme Final = Uber Final × 0.925
const DRIVVEME_DISCOUNT_MULTIPLIER = 0.925;

// The promo discount needed on pre-tax amount to achieve 7.5% off final
// Math: (subtotal - promo) × 1.14975 = subtotal × 1.14975 × 0.925
// Solving: promo = subtotal × (1 - 0.925) = subtotal × 0.075
const PROMO_DISCOUNT_RATE = 0.075; // 7.5%

// NO surge pricing for Drivveme
const getSurgeMultiplier = (_hour: number): number => 1.0;

export interface FareEstimate {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  bookingFee: number;
  surgeMultiplier: number;
  subtotal: number; // Pre-promo fare (matches Uber pre-tax)
  promoDiscount: number; // 7.5% discount amount
  afterPromo: number; // Subtotal after promo
  taxes: number; // Quebec taxes (14.975%)
  total: number; // Final amount rider pays
  platformFee: number; // Tiered fee based on afterPromo
  driverEarnings: number;
  uberEquivalent: number; // Uber's final price with taxes
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

  // ========================================
  // STEP 1: Calculate Uber Pre-Tax
  // Uber Pre-Tax = (Base + Booking + Distance + Time) × 1.195
  // ========================================
  const rawBase = UBER_BASE_FARE;
  const rawBooking = UBER_BOOKING_FEE;
  const rawDistance = distanceKm * UBER_PER_KM_RATE;
  const rawTime = durationMinutes * UBER_PER_MINUTE_RATE;
  
  let uberPreTax = (rawBase + rawBooking + rawDistance + rawTime) * UBER_CALIBRATION_MULTIPLIER * surgeMultiplier;
  
  if (uberPreTax < UBER_MINIMUM_FARE) {
    uberPreTax = UBER_MINIMUM_FARE;
  }

  // Individual Uber components (for display)
  const uberBaseFare = rawBase * UBER_CALIBRATION_MULTIPLIER;
  const uberBookingFee = rawBooking * UBER_CALIBRATION_MULTIPLIER;
  const uberDistanceFare = rawDistance * UBER_CALIBRATION_MULTIPLIER;
  const uberTimeFare = rawTime * UBER_CALIBRATION_MULTIPLIER;

  // ========================================
  // STEP 2: Calculate Uber Final (with taxes)
  // Uber Final = Uber Pre-Tax × 1.14975
  // ========================================
  const uberFinal = uberPreTax * QUEBEC_TAX_MULTIPLIER;
  const uberEquivalent = Math.round(uberFinal * 100) / 100;

  // ========================================
  // STEP 3: Calculate Drivveme Final
  // Drivveme Final = Uber Final × 0.925 (7.5% cheaper)
  // ========================================
  const drivvemeFinal = uberFinal * DRIVVEME_DISCOUNT_MULTIPLIER;
  const total = Math.round(drivvemeFinal * 100) / 100;

  // ========================================
  // STEP 4: Work backwards for receipt display
  // Subtotal = Uber Pre-Tax (what we would charge without promo)
  // Promo = Subtotal × 7.5%
  // After Promo = Subtotal - Promo
  // Taxes = After Promo × 14.975%
  // Total = After Promo + Taxes
  // ========================================
  const subtotal = uberPreTax;
  const promoDiscount = subtotal * PROMO_DISCOUNT_RATE;
  const afterPromo = subtotal - promoDiscount;
  const taxes = afterPromo * QUEBEC_TAX_RATE;

  // ========================================
  // STEP 5: Driver earnings
  // Platform fee based on pre-tax fare (after promo)
  // ========================================
  const platformFee = calculatePlatformFee(afterPromo);
  const driverEarnings = Math.max(0, afterPromo - platformFee);

  // Savings calculation
  const savings = Math.round((uberEquivalent - total) * 100) / 100;
  const savingsPercent = uberEquivalent > 0 ? Math.round((savings / uberEquivalent) * 100) : 0;

  // Drivveme breakdown for display (proportional reduction)
  const ratio = DRIVVEME_DISCOUNT_MULTIPLIER; // 0.925
  const baseFare = uberBaseFare * ratio;
  const bookingFee = uberBookingFee * ratio;
  const distanceFare = uberDistanceFare * ratio;
  const timeFare = uberTimeFare * ratio;

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
