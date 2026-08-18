import { Throttle } from '@nestjs/throttler';

const EAGLE_MEDIA_READ_THROTTLE = {
  short: { ttl: 1_000, limit: 120 },
  default: { ttl: 60_000, limit: 3_600 },
} as const;

/**
 * Media responses are cheap, authenticated reads that browsers request in bursts.
 * Keep them bounded without sharing the generic JSON API's 10 requests/second ceiling.
 */
export function EagleMediaReadThrottle() {
  return Throttle(EAGLE_MEDIA_READ_THROTTLE);
}
