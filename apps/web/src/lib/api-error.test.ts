import { describe, expect, it } from 'vitest';
import { ApiError, errorFromResponse } from './api-error';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('localized API errors', () => {
  it('preserves detailed server messages for the Chinese client', async () => {
    const error = await errorFromResponse(
      jsonResponse({ message: ['素材不存在。', '请刷新。'] }, 404),
      '请求失败（{{value1}}）',
      'zh-CN',
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('素材不存在。；请刷新。');
    expect(error.status).toBe(404);
  });

  it('does not leak an unstructured Chinese server message into the English client', async () => {
    const error = await errorFromResponse(
      jsonResponse({ message: '素材不存在。' }, 404),
      '请求失败（{{value1}}）',
      'en-US',
    );
    expect(error.message).toBe('Request failed (404)');
    expect(error.code).toBeNull();
  });

  it('translates a stable server error code while retaining it for callers', async () => {
    const error = await errorFromResponse(
      jsonResponse({ code: 'ORIGIN_REJECTED', message: '请求来源不受信任。' }, 403),
      '请求失败（{{value1}}）',
      'en-US',
    );
    expect(error.message).toBe('This request origin is not trusted.');
    expect(error.code).toBe('ORIGIN_REJECTED');
  });
});
