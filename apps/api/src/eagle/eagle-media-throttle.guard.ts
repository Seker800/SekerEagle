import { createHash } from 'node:crypto';
import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectThrottlerStorage, ThrottlerException } from '@nestjs/throttler';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthPrincipal } from '../auth/auth.types';

interface MediaThrottleBucket {
  scope: string;
  tracker: string;
  limit: number;
  ttl: number;
}

interface MediaThrottleRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

@Injectable()
export class EagleMediaThrottleGuard {
  constructor(
    private readonly config: ConfigService,
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
  ) {}

  async canActivate(context: ExecutionContext): Promise<true> {
    const http = context.switchToHttp();
    const request = http.getRequest<{ ip?: string; user?: AuthPrincipal }>();
    const response = http.getResponse<Response>();
    const ownerId = request.user?.sub;
    if (!ownerId) throw new UnauthorizedException('媒体请求缺少认证主体。');

    const ip = request.ip?.trim() || 'unknown';
    const buckets = this.createBuckets(ownerId, ip);
    let primaryRecord: MediaThrottleRecord | null = null;
    for (const bucket of buckets) {
      const record = await this.storage.increment(
        hashTracker(bucket.scope, bucket.tracker),
        bucket.ttl,
        bucket.limit,
        bucket.ttl,
        bucket.scope,
      );
      primaryRecord ??= record;
      if (record.isBlocked) {
        setRateLimitHeaders(response, bucket, record, true);
        throw new ThrottlerException('媒体请求过于频繁，请按 Retry-After 稍后重试。');
      }
    }

    setRateLimitHeaders(response, buckets[0], primaryRecord!, false);
    return true;
  }

  private createBuckets(
    ownerId: string,
    ip: string,
  ): [MediaThrottleBucket, ...MediaThrottleBucket[]] {
    if (!this.config.getOrThrow<boolean>('EAGLE_MEDIA_THROTTLE_V2_ENABLED')) {
      return [
        { scope: 'media-legacy-second', tracker: ip, limit: 120, ttl: 1_000 },
        { scope: 'media-legacy-minute', tracker: ip, limit: 3_600, ttl: 60_000 },
      ];
    }
    return [
      {
        scope: 'owner-second',
        tracker: ownerId,
        limit: this.config.getOrThrow<number>('EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_SECOND'),
        ttl: 1_000,
      },
      {
        scope: 'owner-minute',
        tracker: ownerId,
        limit: this.config.getOrThrow<number>('EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_MINUTE'),
        ttl: 60_000,
      },
      {
        scope: 'ip-second',
        tracker: ip,
        limit: this.config.getOrThrow<number>('EAGLE_MEDIA_IP_RATE_LIMIT_PER_SECOND'),
        ttl: 1_000,
      },
      {
        scope: 'ip-minute',
        tracker: ip,
        limit: this.config.getOrThrow<number>('EAGLE_MEDIA_IP_RATE_LIMIT_PER_MINUTE'),
        ttl: 60_000,
      },
    ];
  }
}

function hashTracker(scope: string, tracker: string): string {
  return createHash('sha256').update(`${scope}\u0000${tracker}`).digest('hex');
}

function setRateLimitHeaders(
  response: Response,
  bucket: MediaThrottleBucket,
  record: MediaThrottleRecord,
  blocked: boolean,
): void {
  response.header('X-RateLimit-Limit', String(bucket.limit));
  response.header('X-RateLimit-Remaining', String(Math.max(0, bucket.limit - record.totalHits)));
  response.header('X-RateLimit-Reset', String(record.timeToExpire));
  response.header('RateLimit-Policy', `${bucket.scope};w=${bucket.ttl / 1_000}`);
  if (blocked) response.header('Retry-After', String(Math.max(1, record.timeToBlockExpire)));
}
