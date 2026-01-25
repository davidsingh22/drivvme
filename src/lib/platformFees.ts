/**
 * Tiered platform fee structure for Drivveme
 * 
 * Fare tiers:
 * - < $15: $3.50 fee
 * - $15 - $24.99: $5.00 fee
 * - $25 - $49.99: $8.00 fee
 * - $50 - $99.99: $12.00 fee
 * - $100+: $15.00 fee
 */

export function calculatePlatformFee(fare: number): number {
  if (fare < 15) return 3.50;
  if (fare < 25) return 5.00;
  if (fare < 50) return 8.00;
  if (fare < 100) return 12.00;
  return 15.00;
}

export function calculateDriverEarnings(fare: number): number {
  return fare - calculatePlatformFee(fare);
}

export function getPlatformFeeTier(fare: number): string {
  if (fare < 15) return 'Under $15';
  if (fare < 25) return '$15-$25';
  if (fare < 50) return '$25-$50';
  if (fare < 100) return '$50-$100';
  return '$100+';
}
