import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ThrottlerStorageService } from '@nestjs/throttler/dist/throttler.service';
import { EagleMediaThrottleGuard } from './eagle-media-throttle.guard';

function config(values: Record<string, number | boolean>) {
  return { getOrThrow: (key: string) => values[key] };
}

function contextFor(ownerId: string, ip: string) {
  const headers = new Map<string, string>();
  const request = { ip, user: { sub: ownerId } };
  const response = { header: (name: string, value: unknown) => headers.set(name, String(value)) };
  return {
    context: {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ExecutionContext,
    headers,
  };
}

const limits = {
  EAGLE_MEDIA_THROTTLE_V2_ENABLED: true,
  EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_SECOND: 2,
  EAGLE_MEDIA_OWNER_RATE_LIMIT_PER_MINUTE: 20,
  EAGLE_MEDIA_IP_RATE_LIMIT_PER_SECOND: 10,
  EAGLE_MEDIA_IP_RATE_LIMIT_PER_MINUTE: 100,
};

void test('media throttle isolates normal capacity by authenticated owner', async () => {
  const guard = new EagleMediaThrottleGuard(config(limits) as never, new ThrottlerStorageService());
  const ownerA = contextFor('owner-a', '203.0.113.10');
  const ownerB = contextFor('owner-b', '203.0.113.10');

  await guard.canActivate(ownerA.context);
  await guard.canActivate(ownerA.context);
  await assert.rejects(() => guard.canActivate(ownerA.context), ThrottlerException);
  await guard.canActivate(ownerB.context);
});

void test('media throttle shares owner capacity across client IPs and returns recovery headers', async () => {
  const guard = new EagleMediaThrottleGuard(config(limits) as never, new ThrottlerStorageService());
  const firstClient = contextFor('owner-a', '203.0.113.10');
  const secondClient = contextFor('owner-a', '198.51.100.20');

  await guard.canActivate(firstClient.context);
  await guard.canActivate(secondClient.context);
  await assert.rejects(() => guard.canActivate(secondClient.context), ThrottlerException);

  assert.equal(secondClient.headers.get('X-RateLimit-Limit'), '2');
  assert.equal(secondClient.headers.get('X-RateLimit-Remaining'), '0');
  assert.equal(secondClient.headers.get('Retry-After'), '1');
  assert.equal(secondClient.headers.get('RateLimit-Policy'), 'owner-second;w=1');
});

void test('media throttle fails closed when authentication has not populated a principal', async () => {
  const guard = new EagleMediaThrottleGuard(config(limits) as never, new ThrottlerStorageService());
  const request = contextFor('', '203.0.113.10');
  (request.context.switchToHttp().getRequest() as { user?: unknown }).user = undefined;

  await assert.rejects(() => guard.canActivate(request.context), /认证主体/u);
});
