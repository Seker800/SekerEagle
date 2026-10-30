import { expect, it, vi } from 'vitest';
import { getPhotoPeopleReview } from './photo-management-api';
const request = vi.hoisted(() => vi.fn());
vi.mock('./api-client', () => ({ request }));
it('starts with priority candidates and then resumes the full scoped cursor protocol', async () => {
  request.mockResolvedValueOnce({
    pairs: [
      { first: { id: 'b', photoCount: 9 }, second: { id: 'a', photoCount: 4 }, similarity: 0.7 },
    ],
  });
  const first = await getPhotoPeopleReview();
  expect(first.items[0]?.key).toBe('a:b');
  expect(request.mock.calls[0]?.[0]).toBe('/api/photos/photography/people/review-priority');
  request.mockResolvedValueOnce({ items: [], nextCursor: 'cursor' });
  await getPhotoPeopleReview(first.nextCursor!);
  expect(request.mock.calls[1]?.[0]).toBe('/api/photos/photography/people/review');
  request.mockResolvedValueOnce({ items: [], nextCursor: null });
  await getPhotoPeopleReview('cursor');
  expect(request.mock.calls[2]?.[0]).toBe('/api/photos/photography/people/review?after=cursor');
});
