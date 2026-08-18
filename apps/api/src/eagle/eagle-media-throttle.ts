import { Throttle } from '@nestjs/throttler';

const EAGLE_DERIVED_MEDIA_READ_THROTTLE = {
  short: { ttl: 1_000, limit: 120 },
  default: { ttl: 60_000, limit: 3_600 },
} as const;

/**
 * Derived images and tiles are authenticated, immutable reads requested in browser bursts.
 * Original downloads keep the stricter generic API limit because they can be much larger.
 */
export function EagleDerivedMediaReadThrottle() {
  return Throttle(EAGLE_DERIVED_MEDIA_READ_THROTTLE);
}
