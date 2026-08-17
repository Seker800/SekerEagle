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
    parseCliOptions([
      'run',
      '/snapshot',
      '--server',
      'http://127.0.0.1:8180',
      '--concurrency',
      '12',
    ]).concurrency,
    12,
  );
  assert.throws(
    () => parseCliOptions(['run', '/snapshot', '--pat', 'se_pat_secret']),
    /environment/i,
  );
  assert.throws(
    () => parseCliOptions(['run', '/snapshot', '--concurrency', '100']),
    /between 1 and 16/i,
  );
});

test('rejects malformed and credential-bearing command options', () => {
  assert.throws(() => parseCliOptions([]), /用法/);
  assert.throws(() => parseCliOptions(['unknown', '/snapshot']), /用法/);
  assert.throws(() => parseCliOptions(['run', '/snapshot', '--state']), /缺少值/);
  assert.throws(() => parseCliOptions(['run', '/snapshot', '--unknown', 'value']), /未知参数/);
  assert.throws(
    () => parseCliOptions(['run', '/snapshot', '--server', 'file:///tmp/server']),
    /HTTP\(S\)/,
  );
  assert.throws(
    () => parseCliOptions(['run', '/snapshot', '--server', 'http://user:pass@localhost']),
    /凭据/,
  );
  assert.throws(
    () => parseCliOptions(['run', '/snapshot', '--server', 'http://example.com']),
    /必须使用 HTTPS/,
  );
  assert.equal(
    parseCliOptions(['doctor', '/snapshot', '--server', 'http://[::1]:8180']).serverUrl,
    'http://[::1]:8180',
  );
  assert.equal(
    parseCliOptions(['doctor', '/snapshot', '--server', 'https://example.com']).serverUrl,
    'https://example.com',
  );
  assert.throws(
    () => parseCliOptions(['run', '/snapshot', '--concurrency', '1.5']),
    /between 1 and 16/,
  );
  assert.equal(
    parseCliOptions(['status', '/snapshot', '--state', '/tmp/state']).stateDirectory,
    '/tmp/state',
  );
});
