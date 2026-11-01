import { afterEach, expect, it, vi } from 'vitest';
import { createEagleVectorApi } from './eagle-vector-api';
afterEach(() => vi.restoreAllMocks());
it.each(['MATERIAL', 'PHOTO'] as const)(
  'review in %s uses persisted review counts and reports gateway failures without blaming the model',
  async (mode) => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ suggestions: { pending: 2, unclassified: 3 } }))
      .mockResolvedValue(new Response('<html>gateway timeout</html>', { status: 504 }));
    const api = createEagleVectorApi(mode);
    expect(await api.fetchEagleReviewSummary()).toEqual({
      suggestions: { pending: 2, unclassified: 3 },
    });
    expect(fetch.mock.calls[0][0]).toBe(
      `/api/${mode === 'PHOTO' ? 'photos' : 'eagle'}/vector/review-summary`,
    );
    await expect(api.listEagleVectorSuggestions()).rejects.toThrow('请求失败（504）');
    await expect(api.reviewEagleVectorSuggestions(['saved'], 'ACCEPT')).rejects.toThrow(
      '请求失败（504）',
    );
  },
);
