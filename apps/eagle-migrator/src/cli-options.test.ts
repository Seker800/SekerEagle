import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCliOptions } from './cli-options';

test('parses bounded concurrency and never accepts a PAT on the command line', () => {
  assert.deepEqual(parseCliOptions(['doctor', '/snapshot']), {
    command: 'doctor',
    snapshotPath: '/snapshot',
    serverUrl: 'http://localhost:8180',
    concurrency: 4,
  });
  assert.equal(
    parseCliOptions(['run', '/snapshot', '--server', 'http://127.0.0.1:8180', '--concurrency', '12'])
      .concurrency,
    12,
  );
  assert.throws(() => parseCliOptions(['run', '/snapshot', '--pat', 'se_pat_secret']), /environment/i);
  assert.throws(() => parseCliOptions(['run', '/snapshot', '--concurrency', '100']), /between 1 and 16/i);
});

