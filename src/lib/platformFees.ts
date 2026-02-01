/**
 * Tiered platform fee structure for Drivveme
 * 
 * Fare tiers:
 * - $0 - $14.99: $3.50 fee
 * - $15 - $25: $5.00 fee
 * - $25.01 - $40: $8.00 fee
 * - $41 - $60: $10.00 fee
 * - $61+: $15.00 fee
 */

export function calculatePlatformFee(subtotalBeforeTax: number): number {
  if (subtotalBeforeTax < 15) return 3.50;      // $0-$14.99
  if (subtotalBeforeTax <= 25) return 5.00;     // $15-$25
  if (subtotalBeforeTax < 41) return 8.00;      // $25.01-$40.99
  if (subtotalBeforeTax <= 60) return 10.00;    // $41-$60
  return 15.00;                                  // $61+
}

export function calculateDriverEarnings(fare: number): number {
  return fare - calculatePlatformFee(fare);
}

export function getPlatformFeeTier(fare: number): string {
  if (fare < 15) return 'Under $15';
  if (fare <= 25) return '$15-$25';
  if (fare <= 40) return '$25-$40';
  if (fare <= 60) return '$41-$60';
  return '$61+';
}
