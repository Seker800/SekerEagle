import { describe, expect, it } from 'vitest';
import { MediaRequestLimiter } from '../src/main/media-request-limiter';

describe('MediaRequestLimiter', () => {
  it('holds a permit until the response body is consumed and bounds its queue', async () => {
    const limiter = new MediaRequestLimiter(2, 1);
    const first = await limiter.fetch(async () => new Response('first'));
    const second = await limiter.fetch(async () => new Response('second'));
    const third = limiter.fetch(async () => new Response('third'));

    expect(limiter.stats()).toEqual({ active: 2, queued: 1 });
    await expect(limiter.fetch(async () => new Response('overflow'))).rejects.toThrow(/队列/);
    expect(await first.text()).toBe('first');
    expect(await (await third).text()).toBe('third');
    await second.body?.cancel();
    expect(limiter.stats()).toEqual({ active: 0, queued: 0 });
  });

  it('releases a permit when fetch fails or has no response body', async () => {
    const limiter = new MediaRequestLimiter(1, 0);
    await expect(
      limiter.fetch(async () => {
        throw new Error('network');
      }),
    ).rejects.toThrow('network');
    await limiter.fetch(async () => new Response(null, { status: 304 }));
    expect(limiter.stats()).toEqual({ active: 0, queued: 0 });
  });
});
