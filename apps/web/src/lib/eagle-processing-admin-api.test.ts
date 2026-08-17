import { afterEach, describe, expect, it, vi } from 'vitest';
import { listEagleProcessingJobs } from './eagle-processing-admin-api';

describe('listEagleProcessingJobs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('only sends filters supported by the API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await listEagleProcessingJobs('', { status: 'PENDING', lane: 'BACKGROUND' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/admin/eagle-processing/jobs?status=PENDING&lane=BACKGROUND',
    );
  });
});
