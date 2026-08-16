import assert from 'node:assert/strict';
import test from 'node:test';
import { listEagleProcessingJobs } from './lib/eagle-processing-admin-api.ts';

void test('处理任务列表只发送后端支持的筛选参数', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ items: [], nextCursor: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await listEagleProcessingJobs('', { status: 'PENDING', lane: 'BACKGROUND' });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    requestedUrl,
    '/api/admin/eagle-processing/jobs?status=PENDING&lane=BACKGROUND',
  );
});
