// Drivveme Pricing Engine
// GUARANTEED: Always exactly 7.5% cheaper than Uber (final price including taxes)
// Quebec taxes (GST 5% + QST 9.975%) applied on top
// Platform fee calculated from subtotal BEFORE taxes

import { calculatePlatformFee } from './platformFees';

// Uber Quebec rates - calibrated from actual Uber app screenshots
// From screenshot: Base Fare $3.17, Per Minute $0.30, Per Kilometer $0.70, 
// Booking Fee $1.30, Estimated Surcharges $0.90, Minimum Fare $7.00
const UBER_BASE_FARE = 3.17;
const UBER_PER_KM_RATE = 0.70;
const UBER_PER_MINUTE_RATE = 0.30;
const UBER_BOOKING_FEE = 1.30;
const UBER_SURCHARGE_RATE = 0.90; // Base surcharge
const UBER_MINIMUM_FARE = 7.00;

// Quebec taxes
const GST_RATE = 0.05; // 5% Federal GST
const QST_RATE = 0.09975; // 9.975% Quebec QST
const TOTAL_TAX_RATE = GST_RATE + QST_RATE; // 14.975%

// Drivveme is ALWAYS 7.5% cheaper than Uber's final price (including taxes)
const DISCOUNT_PERCENT = 0.075;
const DISCOUNT_FACTOR = 1 - DISCOUNT_PERCENT; // 0.925

// Minimum fare for Drivveme (before taxes)
const MINIMUM_FARE_BEFORE_TAX = 5.10;

export interface FareEstimate {
  // Uber comparison (what Uber would charge - includes taxes)
  uberTotal: number;
  uberSubtotalBeforeTax: number;
  uberBaseFare: number;
  uberBookingFee: number;
  uberDistanceFare: number;
  uberTimeFare: number;
  uberSurcharge: number;
  
  // Drivveme base fare components (for display)
  baseFare: number;
  bookingFee: number;
  distanceFare: number;
  timeFare: number;
  surgeMultiplier: number;
  
  // Promotional discount (7.5% off Uber equivalent)
  promoDiscount: number;
  promoPercent: number;
  
  // Subtotal after discount (before taxes) - used for platform fee
  subtotalBeforeTax: number;
  
  // Quebec taxes
  gstAmount: number;
  qstAmount: number;
  totalTax: number;
  
  // Final total (what rider pays) - GUARANTEED 7.5% less than Uber
  total: number;
  
  // Platform fee and driver earnings (based on subtotal before tax)
  platformFee: number;
  driverEarnings: number;
  
  // Savings vs Uber
  savings: number;
  savingsPercent: number;
  
  // Legacy fields for compatibility
  uberEquivalent: number;
}

export const calculateFare = (
  distanceKm: number,
  durationMinutes: number,
  applySurge: boolean = true
): FareEstimate => {
  // Step 1: Calculate what Uber would charge (before tax)
  const uberBaseFare = UBER_BASE_FARE;
  const uberBookingFee = UBER_BOOKING_FEE;
  const uberDistanceFare = round(distanceKm * UBER_PER_KM_RATE);
  const uberTimeFare = round(durationMinutes * UBER_PER_MINUTE_RATE);
  const uberSurcharge = UBER_SURCHARGE_RATE;
  
  let uberSubtotalBeforeTax = uberBaseFare + uberBookingFee + uberDistanceFare + uberTimeFare + uberSurcharge;
  
  // Apply Uber minimum fare
  if (uberSubtotalBeforeTax < UBER_MINIMUM_FARE) {
    uberSubtotalBeforeTax = UBER_MINIMUM_FARE;
  }
  uberSubtotalBeforeTax = round(uberSubtotalBeforeTax);
  
  // Step 2: Calculate Uber's final price (with taxes - this is what customers see)
  const uberTotal = round(uberSubtotalBeforeTax * (1 + TOTAL_TAX_RATE));
  
  // Step 3: Calculate Drivveme's final price - EXACTLY 7.5% less than Uber
  const drivvemeTotal = round(uberTotal * DISCOUNT_FACTOR);
  
  // Step 4: Work backwards to get subtotal before tax
  // total = subtotal * (1 + tax_rate)
  // subtotal = total / (1 + tax_rate)
  let subtotalBeforeTax = round(drivvemeTotal / (1 + TOTAL_TAX_RATE));
  
  // Enforce minimum fare
  if (subtotalBeforeTax < MINIMUM_FARE_BEFORE_TAX) {
    subtotalBeforeTax = MINIMUM_FARE_BEFORE_TAX;
  }
  
  // Step 5: Calculate taxes
  const gstAmount = round(subtotalBeforeTax * GST_RATE);
  const qstAmount = round(subtotalBeforeTax * QST_RATE);
  const totalTax = round(gstAmount + qstAmount);
  
  // Step 6: Calculate final total (recalculate to ensure consistency)
  const total = round(subtotalBeforeTax + totalTax);
  
  // Step 7: Calculate promo discount (difference from Uber subtotal)
  const promoDiscount = round(uberSubtotalBeforeTax - subtotalBeforeTax);
  
  // Step 8: Calculate platform fee based on subtotal (BEFORE taxes)
  const platformFee = calculatePlatformFee(subtotalBeforeTax);
  const driverEarnings = round(Math.max(0, subtotalBeforeTax - platformFee));
  
  // Step 9: Calculate savings
  const savings = round(uberTotal - total);
  // Ensure we're always showing at least 7% savings (accounting for rounding)
  const savingsPercent = Math.max(7, Math.round((savings / uberTotal) * 100));
  
  // Step 10: Calculate display components proportionally
  const proportionFactor = subtotalBeforeTax / uberSubtotalBeforeTax;
  const baseFare = round(uberBaseFare * proportionFactor);
  const bookingFee = round(uberBookingFee * proportionFactor);
  const distanceFare = round(uberDistanceFare * proportionFactor);
  const timeFare = round(uberTimeFare * proportionFactor);

  return {
    // Uber comparison
    uberTotal,
    uberSubtotalBeforeTax,
    uberBaseFare,
    uberBookingFee,
    uberDistanceFare,
    uberTimeFare,
    uberSurcharge,
    
    // Drivveme components (proportionally reduced)
    baseFare,
    bookingFee,
    distanceFare,
    timeFare,
    surgeMultiplier: 1.0, // No surge for Drivveme
    
    // Promo
    promoDiscount,
    promoPercent: DISCOUNT_PERCENT * 100,
    
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
    
    // Legacy compatibility
    uberEquivalent: uberSubtotalBeforeTax,
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
