import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEagleApi, listEagleAssetUpdates, uploadEagleAsset } from './eagle-api';

describe('listEagleAssetUpdates', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('creates edited-photo copies without sending owner or replacement fields', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ message: 'stop at initiation' }, { status: 400 }));
    await expect(
      uploadEagleAsset('', new File(['png'], 'photo-edited.png', { type: 'image/png' }), vi.fn(), {
        duplicatePolicy: 'CREATE_COPY',
      }),
    ).rejects.toThrow('stop at initiation');
    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/eagle/uploads',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          originalName: 'photo-edited.png',
          mimeType: 'image/png',
          size: 3,
          duplicatePolicy: 'CREATE_COPY',
        }),
      }),
    ]);
    expect(fetchMock.mock.calls).toHaveLength(1);
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

  it('retries an edited copy detail read without uploading or creating another copy', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:8180' } });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ id: 'edit-session', partSize: 10 }))
      .mockResolvedValueOnce(
        Response.json({
          uploadUrl: 'http://localhost:8180/sekereagle-assets/edit-part?X-Amz-Signature=test',
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: 'etag' } }))
      .mockResolvedValueOnce(Response.json({ assetId: 'copy', duplicate: false }))
      .mockResolvedValueOnce(
        Response.json({ message: 'temporary detail failure' }, { status: 503 }),
      )
      .mockImplementation(async () => Response.json({ id: 'copy', isPrivate: true }));
    const file = new File(['png'], 'edited.png', { type: 'image/png' });
    const options = { duplicatePolicy: 'CREATE_COPY' as const, retry: true };
    await expect(uploadEagleAsset('', file, vi.fn(), options)).rejects.toThrow(
      'temporary detail failure',
    );
    const result = await uploadEagleAsset('', file, vi.fn(), options);
    expect(result.asset.id).toBe('copy');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/eagle/uploads',
      '/api/eagle/uploads/edit-session/parts/1',
      'http://localhost:8180/sekereagle-assets/edit-part?X-Amz-Signature=test',
      '/api/eagle/uploads/edit-session/complete',
      '/api/eagle/assets/copy',
      '/api/eagle/assets/copy',
    ]);
  });

  it('waits for the durable upload finalization job before reading the new asset', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:8180' } });
    const progress = vi.fn();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ id: 'session-1', partSize: 10 }))
      .mockResolvedValueOnce(
        Response.json({
          uploadUrl: 'http://localhost:8180/sekereagle-assets/part?X-Amz-Signature=test',
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: 'etag' } }))
      .mockResolvedValueOnce(
        Response.json({ uploadSessionId: 'session-1', status: 'ASSEMBLED' }, { status: 202 }),
      )
      .mockResolvedValueOnce(Response.json({ status: 'FINALIZING' }))
      .mockResolvedValueOnce(
        Response.json({
          status: 'COMPLETED',
          eagleAssetId: 'asset-1',
          objectCleanupPending: false,
          lastError: null,
        }),
      )
      .mockImplementation(async () => Response.json({ id: 'asset-1' }));

    const result = await uploadEagleAsset(
      '',
      new File(['image'], 'image.png', { type: 'image/png' }),
      progress,
    );

    expect(result.asset.id).toBe('asset-1');
    expect(progress).toHaveBeenCalledWith({ percent: 100, phase: 'validating' });
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

it('session revocation cancels an object PUT and prevents completion or cleanup under a new login', async () => {
  const { fetchWithBrowserSession } = await import('./api-client');
  let putSignal!: AbortSignal;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === '/api/auth/logout' || url === '/api/auth/login')
      return new Response(null, { status: 204 });
    if (url === '/api/eagle/uploads') return Response.json({ id: 'session', partSize: 10 });
    if (url.endsWith('/parts/1'))
      return Response.json({
        uploadUrl: `${window.location.origin}/sekereagle-assets/part?X-Amz-Signature=test`,
      });
    if (init?.method === 'PUT') {
      putSignal = init.signal!;
      started();
      return new Promise<Response>((_resolve, reject) =>
        putSignal.addEventListener(
          'abort',
          () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true },
        ),
      );
    }
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    const upload = uploadEagleAsset(
      '',
      new File(['image'], 'test.png', { type: 'image/png' }),
      vi.fn(),
    );
    const rejected = expect(upload).rejects.toMatchObject({ name: 'AbortError' });
    await ready;
    await fetchWithBrowserSession('/api/auth/logout');
    await fetchWithBrowserSession('/api/auth/login');
    await rejected;
    expect(putSignal.aborted).toBe(true);
    expect(
      mock.mock.calls.some(
        ([url, init]) =>
          (typeof url === 'string' && url.includes('/complete')) || init?.method === 'DELETE',
      ),
    ).toBe(false);
  } finally {
    mock.mockRestore();
  }
});

it.each(['MATERIAL', 'PHOTO'] as const)(
  'reads only missing preserved-filter identifiers through one mode-scoped batch request: %s',
  async (mode) => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ preservedFilterIds: ['lut:legacy'] }));
    try {
      const result = await createEagleApi(mode).getBatchEaglePhotoEditContext([
        'target-a',
        'target-b',
      ]);
      expect(result).toEqual({ preservedFilterIds: ['lut:legacy'] });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `/api/${mode === 'PHOTO' ? 'photos' : 'eagle'}/assets/batch/edit-render-context`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ assetIds: ['target-a', 'target-b'] }),
        }),
      );
    } finally {
      vi.restoreAllMocks();
    }
  },
);

describe('upload throughput', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uploads parts concurrently and completes them in part order', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:8180' } });
    let active = 0;
    let peak = 0;
    const completedParts: number[][] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/eagle/uploads') return Response.json({ id: 'session-multi', partSize: 5 });
      if (url.includes('/parts/')) {
        const partNumber = Number(url.slice(url.lastIndexOf('/') + 1));
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return Response.json({
          uploadUrl: `http://localhost:8180/sekereagle-assets/part-${partNumber}?X-Amz-Signature=test`,
        });
      }
      if (init?.method === 'PUT') {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        const partNumber = Number(/part-(\d+)/.exec(url)![1]);
        return new Response(null, { status: 200, headers: { etag: `etag-${partNumber}` } });
      }
      if (url.endsWith('/complete')) {
        const body = JSON.parse(init?.body as string) as {
          parts: Array<{ partNumber: number }>;
        };
        completedParts.push(body.parts.map((part) => part.partNumber));
        return Response.json(
          { uploadSessionId: 'session-multi', status: 'ASSEMBLED' },
          { status: 202 },
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const result = await uploadEagleAsset(
      '',
      new File([new Uint8Array(12)], 'multi.jpg', { type: 'image/jpeg' }),
      vi.fn(),
      { waitForFinalization: false },
    );

    expect(result).toEqual({ uploadSessionId: 'session-multi' });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
    expect(completedParts).toEqual([[1, 2, 3]]);
  });

  it('returns an already-published asset without polling finalization', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:8180' } });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/api/eagle/uploads') return Response.json({ id: 'session-fast', partSize: 10 });
      if (url.includes('/parts/'))
        return Response.json({
          uploadUrl: 'http://localhost:8180/sekereagle-assets/part?X-Amz-Signature=test',
        });
      if (init?.method === 'PUT')
        return new Response(null, { status: 200, headers: { etag: 'etag-1' } });
      if (url.endsWith('/complete'))
        return Response.json(
          { uploadSessionId: 'session-fast', assetId: 'asset-1', duplicate: false },
          { status: 202 },
        );
      throw new Error(`unexpected request: ${url}`);
    });

    const result = await uploadEagleAsset(
      '',
      new File(['image'], 'fast.jpg', { type: 'image/jpeg' }),
      vi.fn(),
      { waitForFinalization: false },
    );

    expect(result).toEqual({
      uploadSessionId: 'session-fast',
      assetId: 'asset-1',
      duplicate: false,
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(
      '/api/eagle/uploads/session-fast',
    );
  });

  it('reads many upload session statuses through one batch request', async () => {
    const items = [
      {
        id: 'session-a',
        status: 'COMPLETED',
        eagleAssetId: 'asset-a',
        objectCleanupPending: false,
        finalizationAttempts: 1,
        lastError: null,
      },
    ];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ items }));
    const result = await createEagleApi('PHOTO').getEagleUploadStatuses('', [
      'session-a',
      'session-b',
    ]);
    expect(result).toEqual(items);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/photos/uploads/status-batch',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ uploadSessionIds: ['session-a', 'session-b'] }),
      }),
    );
  });
});
