import { expect, it, vi } from 'vitest';
import { getPhotoPeopleReview } from './photo-management-api';
const request = vi.hoisted(() => vi.fn());
vi.mock('./api-client', () => ({ request }));
it('uses one cursor for the entire review traversal', async () => {
  request.mockResolvedValueOnce({ items: [], nextCursor: 'cursor' });
  const first = await getPhotoPeopleReview();
  expect(request.mock.calls[0]?.[0]).toBe('/api/photos/photography/people/review');
  request.mockResolvedValueOnce({ items: [], nextCursor: null });
  await getPhotoPeopleReview(first.nextCursor!);
  expect(request.mock.calls[1]?.[0]).toBe('/api/photos/photography/people/review?after=cursor');
});
