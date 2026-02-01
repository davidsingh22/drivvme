// Drivveme Pricing Engine
// Always 7.5% cheaper than Uber (before taxes), with tiered platform fees
// Quebec taxes (GST 5% + QST 9.975%) applied on top

import { calculatePlatformFee } from './platformFees';

// Uber Quebec base rates (UberX) - calibrated from actual Uber app
const UBER_BASE_FARE = 2.50;
const UBER_PER_KM_RATE = 0.715;
const UBER_PER_MINUTE_RATE = 0.185;
const UBER_BOOKING_FEE = 2.50;
const UBER_MINIMUM_FARE = 6.00;

// Calibration factor to match real Uber totals
const UBER_CALIBRATION_MULTIPLIER = 1.195;

// Drivveme promotional discount: 7.5% off Uber equivalent
const PROMO_DISCOUNT_PERCENT = 0.075;
const DISCOUNT_FACTOR = 1 - PROMO_DISCOUNT_PERCENT; // 0.925

// Quebec taxes
const GST_RATE = 0.05; // 5% Federal GST
const QST_RATE = 0.09975; // 9.975% Quebec QST
const TOTAL_TAX_RATE = GST_RATE + QST_RATE; // 14.975%

// Minimum fare after promo discount (before taxes)
const MINIMUM_FARE_BEFORE_TAX = 5.10;

// NO surge pricing for Drivveme
const getSurgeMultiplier = (_hour: number): number => 1.0;

export interface FareEstimate {
  // Uber comparison
  uberEquivalent: number;
  uberBaseFare: number;
  uberBookingFee: number;
  uberDistanceFare: number;
  uberTimeFare: number;
  
  // Base fare components (before discount)
  baseFare: number;
  bookingFee: number;
  distanceFare: number;
  timeFare: number;
  surgeMultiplier: number;
  
  // Promotional discount
  promoDiscount: number;
  promoPercent: number;
  
  // Subtotal after discount (before taxes) - used for platform fee
  subtotalBeforeTax: number;
  
  // Quebec taxes
  gstAmount: number;
  qstAmount: number;
  totalTax: number;
  
  // Final total (what rider pays)
  total: number;
  
  // Platform fee and driver earnings (based on subtotal before tax)
  platformFee: number;
  driverEarnings: number;
  
  // Savings vs Uber
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

  // Step 1: Calculate Uber-equivalent fare
  const uberBaseFare = UBER_BASE_FARE * UBER_CALIBRATION_MULTIPLIER;
  const uberBookingFee = UBER_BOOKING_FEE * UBER_CALIBRATION_MULTIPLIER;
  const uberDistanceFare = distanceKm * UBER_PER_KM_RATE * UBER_CALIBRATION_MULTIPLIER;
  const uberTimeFare = durationMinutes * UBER_PER_MINUTE_RATE * UBER_CALIBRATION_MULTIPLIER;

  let uberSubtotal = (uberBaseFare + uberBookingFee + uberDistanceFare + uberTimeFare) * surgeMultiplier;
  if (uberSubtotal < UBER_MINIMUM_FARE) {
    uberSubtotal = UBER_MINIMUM_FARE;
  }
  const uberEquivalent = round(uberSubtotal);

  // Step 2: Calculate base fare (same as Uber calculation, before discount)
  const baseFare = round(uberBaseFare);
  const bookingFee = round(uberBookingFee);
  const distanceFare = round(uberDistanceFare);
  const timeFare = round(uberTimeFare);
  const baseTotal = round((baseFare + bookingFee + distanceFare + timeFare) * surgeMultiplier);

  // Step 3: Apply 7.5% promotional discount
  const promoDiscount = round(baseTotal * PROMO_DISCOUNT_PERCENT);
  let subtotalBeforeTax = round(baseTotal - promoDiscount);
  
  // Enforce minimum fare
  if (subtotalBeforeTax < MINIMUM_FARE_BEFORE_TAX) {
    subtotalBeforeTax = MINIMUM_FARE_BEFORE_TAX;
  }

  // Step 4: Calculate platform fee based on subtotal (BEFORE taxes)
  const platformFee = calculatePlatformFee(subtotalBeforeTax);
  const driverEarnings = round(Math.max(0, subtotalBeforeTax - platformFee));

  // Step 5: Add Quebec taxes
  const gstAmount = round(subtotalBeforeTax * GST_RATE);
  const qstAmount = round(subtotalBeforeTax * QST_RATE);
  const totalTax = round(gstAmount + qstAmount);

  // Step 6: Calculate final total (what rider pays)
  const total = round(subtotalBeforeTax + totalTax);

  // Step 7: Calculate savings vs Uber (Uber prices typically include tax)
  const uberWithTax = round(uberEquivalent * (1 + TOTAL_TAX_RATE));
  const savings = round(uberWithTax - total);
  const savingsPercent = Math.round((savings / uberWithTax) * 100);

  return {
    // Uber comparison
    uberEquivalent,
    uberBaseFare: round(uberBaseFare),
    uberBookingFee: round(uberBookingFee),
    uberDistanceFare: round(uberDistanceFare),
    uberTimeFare: round(uberTimeFare),
    
    // Base components
    baseFare,
    bookingFee,
    distanceFare,
    timeFare,
    surgeMultiplier,
    
    // Promo
    promoDiscount,
    promoPercent: PROMO_DISCOUNT_PERCENT * 100,
    
    // Subtotal
    subtotalBeforeTax,
    
    // Taxes
    gstAmount,
    qstAmount,
    totalTax,
    
    // Final
    total,
    platformFee,
    driverEarnings,
    
    // Savings
    savings,
    savingsPercent,
  };
};

// Helper to round to 2 decimal places
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

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
