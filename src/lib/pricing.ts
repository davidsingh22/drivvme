// Drivveme Pricing Engine
// Final price is ALWAYS 7.5% cheaper than Uber (after taxes)
// Formula: Calculate Uber price with taxes → be 7.5% cheaper

import { calculatePlatformFee } from './platformFees';

// Uber Quebec base rates (UberX) - calibrated from actual Uber app
const UBER_BASE_FARE = 2.50;
const UBER_PER_KM_RATE = 0.715;
const UBER_PER_MINUTE_RATE = 0.185;
const UBER_BOOKING_FEE = 2.50;
const UBER_MINIMUM_FARE = 6.00;

// Calibration multiplier to match real Uber totals
const UBER_CALIBRATION_MULTIPLIER = 1.195;

// Quebec taxes (GST 5% + QST 9.975% = 14.975%)
const QUEBEC_TAX_RATE = 0.14975;

// Drivveme is 7.5% cheaper than Uber AFTER taxes
const DISCOUNT_VS_UBER = 0.075; // 7.5% cheaper

// NO surge pricing for Drivveme
const getSurgeMultiplier = (_hour: number): number => 1.0;

export interface FareEstimate {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  bookingFee: number;
  surgeMultiplier: number;
  subtotal: number; // Our pre-tax fare
  promoDiscount: number; // 7.5% discount amount shown to user
  afterPromo: number; // Subtotal after promo (what gets taxed)
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

  // Step 1: Calculate Uber's fare (pre-tax)
  const uberBaseFare = UBER_BASE_FARE * UBER_CALIBRATION_MULTIPLIER;
  const uberBookingFee = UBER_BOOKING_FEE * UBER_CALIBRATION_MULTIPLIER;
  const uberDistanceFare = distanceKm * UBER_PER_KM_RATE * UBER_CALIBRATION_MULTIPLIER;
  const uberTimeFare = durationMinutes * UBER_PER_MINUTE_RATE * UBER_CALIBRATION_MULTIPLIER;

  let uberPreTax = (uberBaseFare + uberBookingFee + uberDistanceFare + uberTimeFare) * surgeMultiplier;
  if (uberPreTax < UBER_MINIMUM_FARE) {
    uberPreTax = UBER_MINIMUM_FARE;
  }

  // Step 2: Uber's final price WITH taxes
  const uberWithTaxes = uberPreTax * (1 + QUEBEC_TAX_RATE);
  const uberEquivalent = Math.round(uberWithTaxes * 100) / 100;

  // Step 3: Our final price must be 7.5% cheaper than Uber's final price
  const ourTargetTotal = uberWithTaxes * (1 - DISCOUNT_VS_UBER);

  // Step 4: Work backwards to find our pre-tax fare
  // ourTargetTotal = ourPreTax * (1 + taxRate)
  // So: ourPreTax = ourTargetTotal / (1 + taxRate)
  const ourPreTax = ourTargetTotal / (1 + QUEBEC_TAX_RATE);

  // Step 5: Calculate display values
  // Show Uber's pre-tax fare as our "subtotal" and 7.5% of that as the "promo"
  const subtotal = uberPreTax; // What we would charge without promo
  const promoDiscount = subtotal * DISCOUNT_VS_UBER; // 7.5% promo shown
  const afterPromo = subtotal - promoDiscount; // After promo = ourPreTax

  // Step 6: Add taxes to get final price
  const taxes = afterPromo * QUEBEC_TAX_RATE;
  const total = Math.round((afterPromo + taxes) * 100) / 100;

  // Step 7: Platform fee based on pre-tax fare (after promo)
  const platformFee = calculatePlatformFee(afterPromo);
  
  // Driver earnings = post-promo fare - platform fee (no taxes to driver)
  const driverEarnings = Math.max(0, afterPromo - platformFee);

  // Savings = Uber's total - our total
  const savings = Math.round((uberEquivalent - total) * 100) / 100;
  const savingsPercent = uberEquivalent > 0 ? Math.round((savings / uberEquivalent) * 100) : 0;

  // Breakdown for display (proportional to actual fare structure)
  const ratio = afterPromo / uberPreTax; // 0.925
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
