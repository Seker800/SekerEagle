import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedOwner } from '../src/main/authenticated-owner';

describe('AuthenticatedOwner', () => {
  it('single-flights identity checks and leases the authenticated owner briefly', async () => {
    let now = 1_000;
    const fetchMe = vi.fn(async () => Response.json({ user: { id: 'owner-a' } }));
    const owner = new AuthenticatedOwner(fetchMe, () => now);

    expect(await Promise.all([owner.get(), owner.get()])).toEqual(['owner-a', 'owner-a']);
    expect(await owner.get()).toBe('owner-a');
    expect(fetchMe).toHaveBeenCalledTimes(1);

    now += 60_001;
    expect(await owner.get()).toBe('owner-a');
    expect(fetchMe).toHaveBeenCalledTimes(2);
  });

  it('fails closed on malformed, unauthorized, or unavailable identity responses', async () => {
    const responses = [
      async () => new Response(null, { status: 401 }),
      async () => Response.json({ user: {} }),
      async () => Promise.reject(new Error('offline')),
    ];
    for (const fetchMe of responses) {
      const owner = new AuthenticatedOwner(fetchMe);
      await expect(owner.get()).resolves.toBeNull();
    }
  });

  it('drops its lease immediately when session cookies change or the app resumes', async () => {
    const fetchMe = vi.fn(async () => Response.json({ user: { id: 'owner-a' } }));
    const owner = new AuthenticatedOwner(fetchMe);

    await owner.get();
    owner.invalidate();
    await owner.get();

    expect(fetchMe).toHaveBeenCalledTimes(2);
  });
});
