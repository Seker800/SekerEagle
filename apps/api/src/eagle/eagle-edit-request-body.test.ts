import assert from 'node:assert/strict';
import express from 'express';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { installEditRequestBodyParser } from './eagle-edit-request-body';

const LARGE_BODY = JSON.stringify({ lut: 'x'.repeat(6 * 1024 * 1024) });

async function withApp(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  installEditRequestBodyParser(app as never);
  app.use((request, response) => {
    response.json({ ok: true, hasBody: Boolean(request.body) });
  });
  app.use(
    (
      error: { status?: number },
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      response.status(error.status ?? 500).json({ ok: false });
    },
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('batch edit renders accepts bodies above the single-edit limit', async () => {
  await withApp(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/eagle/assets/batch/edit-renders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: LARGE_BODY,
    });
    assert.equal(response.status, 200);
  });
});

test('single edit renders keeps the 5 MiB limit', async () => {
  await withApp(async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/eagle/assets/00000000-0000-4000-8000-000000000000/edit-renders`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: LARGE_BODY,
      },
    );
    assert.equal(response.status, 413);
  });
});
