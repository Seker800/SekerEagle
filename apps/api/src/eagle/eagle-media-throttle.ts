import { applyDecorators, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { EagleMediaThrottleGuard } from './eagle-media-throttle.guard';

/**
 * Derived images and tiles are authenticated, immutable reads requested in browser bursts.
 * Original downloads keep the stricter generic API limit because they can be much larger.
 */
export function EagleDerivedMediaReadThrottle() {
  return applyDecorators(
    SkipThrottle({ short: true, default: true }),
    UseGuards(EagleMediaThrottleGuard),
  );
}
