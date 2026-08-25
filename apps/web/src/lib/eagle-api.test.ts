import { afterEach, describe, expect, it, vi } from 'vitest';
import { listEagleAssetUpdates, uploadEagleAsset } from './eagle-api';

describe('listEagleAssetUpdates', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it('uploads object parts through the current LAN gateway without browser credentials', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://192.168.1.10:8180' } });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ id: 'session-1', partSize: 10 }, { status: 201 }))
      .mockResolvedValueOnce(
        Response.json(
          {
            uploadUrl:
              'http://localhost:8180/sekereagle-assets/users/user-1/file.png?X-Amz-Signature=signed',
          },
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: 'part-etag' } }))
      .mockResolvedValueOnce(Response.json({ message: 'stop after upload' }, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      uploadEagleAsset('', new File(['image'], 'image.png', { type: 'image/png' }), vi.fn()),
    ).rejects.toThrow('stop after upload');

    expect(fetchMock.mock.calls[2]).toEqual([
      'http://192.168.1.10:8180/sekereagle-assets/users/user-1/file.png?X-Amz-Signature=signed',
      expect.objectContaining({ method: 'PUT', credentials: 'omit' }),
    ]);
  });
});
