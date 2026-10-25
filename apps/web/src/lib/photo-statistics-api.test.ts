import { expect, it, vi } from 'vitest';
import { getPhotoStatistics } from './photo-statistics-api';
import { request } from './api-client';
vi.mock('./api-client', () => ({ request: vi.fn(async () => ({})) }));

it('sends typed device identities separately from legacy exact lens names', async () => {
  const identity = JSON.stringify(['camera', "Phone A' OR true --"]);
  await getPhotoStatistics({
    grain: 'month',
    groupBy: 'lens',
    cameras: ['Phone A'],
    lenses: [identity, 'Legacy Lens', ''],
  });
  const path = vi.mocked(request).mock.calls.at(-1)![0];
  const query = new URL(path, 'http://localhost').searchParams;
  expect(query.getAll('lensKeys')).toEqual([identity]);
  expect(query.getAll('lenses')).toEqual(['Legacy Lens', '']);
  expect(query.getAll('cameras')).toEqual(['Phone A']);
});
