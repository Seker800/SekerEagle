import { afterEach, describe, expect, it, vi } from 'vitest';
import { listEagleAssetUpdates } from './eagle-api';

describe('listEagleAssetUpdates', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends asset ids in a bounded POST body instead of an expanding URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const assetId = '11111111-1111-4111-8111-111111111111';

    await listEagleAssetUpdates('token', [assetId]);

    const [requestUrl, request] = fetchMock.mock.calls[0] ?? [];
    expect(requestUrl).toBe('/api/eagle/asset-updates');
    expect(request).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ assetIds: [assetId] }),
    });
  });
});
