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

export function calculatePlatformFee(fare: number): number {
  if (fare < 15) return 3.50;
  if (fare <= 25) return 5.00;
  if (fare <= 40) return 8.00;
  if (fare <= 60) return 10.00;
  return 15.00;
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
