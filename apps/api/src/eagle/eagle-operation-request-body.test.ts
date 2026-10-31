import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { installOperationRequestBodyParser } from './eagle-operation-request-body';

test('large operation selection bodies work in both modes without widening ordinary JSON endpoints', async () => {
  const app = express();
  installOperationRequestBodyParser(app as never);
  app.use(express.json());
  app.post(
    [
      '/api/eagle/operations',
      '/api/photos/operations',
      '/api/eagle/assets/batch/send',
      '/api/photos/assets/batch/send',
      '/api/eagle/duplicates/cleanup',
      '/api/photos/duplicates/cleanup',
      '/ordinary',
    ],
    (req, res) => res.json({ count: req.body.assetIds.length }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert(address && typeof address !== 'string');
    const body = JSON.stringify({
      operationId: randomUUID(),
      kind: 'SEND',
      assetIds: Array.from({ length: 5001 }, () => randomUUID()),
    });
    for (const path of [
      '/api/eagle/operations',
      '/api/photos/operations',
      '/api/eagle/assets/batch/send',
      '/api/photos/assets/batch/send',
      '/api/eagle/duplicates/cleanup',
      '/api/photos/duplicates/cleanup',
    ]) {
      const result = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      assert.equal(result.status, 200);
      assert.equal(((await result.json()) as { count: number }).count, 5001);
    }
    const ordinary = await fetch(`http://127.0.0.1:${address.port}/ordinary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(ordinary.status, 413);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
