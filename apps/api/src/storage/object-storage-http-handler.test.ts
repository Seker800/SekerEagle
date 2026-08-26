import assert from 'node:assert/strict';
import test from 'node:test';
import { objectStorageHttpHandlerOptions } from './object-storage.service';

void test('object storage uses bounded timeouts and a bounded keep-alive pool', () => {
  const values: Record<string, number> = {
    S3_CONNECTION_TIMEOUT_MS: 3_000,
    S3_REQUEST_TIMEOUT_MS: 12_000,
    S3_SOCKET_TIMEOUT_MS: 10_000,
    S3_MAX_SOCKETS: 64,
  };
  const options = objectStorageHttpHandlerOptions({
    getOrThrow: (key: string) => values[key],
  } as never);

  assert.equal(options.connectionTimeout, 3_000);
  assert.equal(options.requestTimeout, 12_000);
  assert.equal(options.socketTimeout, 10_000);
  assert.equal(options.throwOnRequestTimeout, true);
  assert.equal(options.httpAgent?.maxSockets, 64);
  assert.equal(options.httpsAgent?.maxSockets, 64);
});
