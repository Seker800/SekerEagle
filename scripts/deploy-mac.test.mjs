import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertBuildSpace,
  assertGatewayBindings,
  composeArgs,
  expectedGatewayBindings,
  isPrivateIpv4,
  parseEnv,
  selectComposeFiles,
} from './deploy-mac.mjs';

test('deployment refuses to build when host disk headroom is insufficient', () => {
  for (const bytes of [0, 8 * 1024 ** 3, Number.NaN]) {
    assert.throws(() => assertBuildSpace(bytes), /free host disk space/);
  }
  assert.doesNotThrow(() => assertBuildSpace(24 * 1024 ** 3));
});

test('parses deployment values without printing the environment', () => {
  const env = parseEnv(`
# deployment settings
SEKEREAGLE_GATEWAY_LAN_ADDRESS="192.168.31.139"
JWT_ACCESS_SECRET=do-not-print
`);

  assert.equal(env.get('SEKEREAGLE_GATEWAY_LAN_ADDRESS'), '192.168.31.139');
  assert.equal(env.get('JWT_ACCESS_SECRET'), 'do-not-print');
});

test('automatically includes the LAN overlay when a LAN address is configured', () => {
  assert.deepEqual(selectComposeFiles('192.168.31.139'), [
    'deploy/mac/docker-compose.yml',
    'deploy/mac/docker-compose.lan.yml',
  ]);
  assert.deepEqual(selectComposeFiles(''), ['deploy/mac/docker-compose.yml']);
});

test('accepts only RFC1918 IPv4 addresses for LAN publishing', () => {
  for (const address of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.31.139']) {
    assert.equal(isPrivateIpv4(address), true, address);
  }
  for (const address of ['0.0.0.0', '127.0.0.1', '172.32.0.1', '8.8.8.8', '::1', 'localhost']) {
    assert.equal(isPrivateIpv4(address), false, address);
  }
});

test('builds one compose project command with every selected file', () => {
  assert.deepEqual(composeArgs(selectComposeFiles('192.168.31.139'), ['config', '--quiet']), [
    'compose',
    '--env-file',
    '.env',
    '-f',
    'deploy/mac/docker-compose.yml',
    '-f',
    'deploy/mac/docker-compose.lan.yml',
    'config',
    '--quiet',
  ]);
});

test('requires loopback and configured LAN gateway bindings', () => {
  assert.deepEqual(expectedGatewayBindings('192.168.31.139'), [
    { HostIp: '127.0.0.1', HostPort: '8180' },
    { HostIp: '192.168.31.139', HostPort: '8180' },
  ]);
  assert.deepEqual(expectedGatewayBindings(''), [{ HostIp: '127.0.0.1', HostPort: '8180' }]);

  const actual = {
    '8080/tcp': [
      { HostIp: '127.0.0.1', HostPort: '8180' },
      { HostIp: '192.168.31.139', HostPort: '8180' },
    ],
  };
  assert.doesNotThrow(() => assertGatewayBindings(actual, '192.168.31.139'));
  assert.throws(
    () => assertGatewayBindings({ '8080/tcp': actual['8080/tcp'].slice(0, 1) }, '192.168.31.139'),
    /expected 192\.168\.31\.139:8180/u,
  );
});

test('storage credentials are separated from root without rotating existing application secrets', async () => {
  const { withApplicationStorageCredentials } = await import('./ensure-local-storage-env.mjs');
  const old =
    'MINIO_ROOT_USER=root\nMINIO_ROOT_PASSWORD=root-password\nS3_ACCESS_KEY_ID=compose-only\nS3_SECRET_ACCESS_KEY=compose-only\n';
  const upgraded = withApplicationStorageCredentials(
    old,
    () => 'test-app-secret-with-more-than-32-characters',
  );
  assert.match(upgraded, /MINIO_ROOT_PASSWORD=root-password/u);
  assert.match(upgraded, /S3_ACCESS_KEY_ID=sekereagle-app-/u);
  assert.doesNotMatch(upgraded, /compose-only/u);
  assert.equal(
    withApplicationStorageCredentials(upgraded, () => {
      throw new Error('must reuse');
    }),
    upgraded,
  );
});

test('migration completion is verified before writers can restart', async () => {
  const { deployCompose } = await import('./deploy-mac.mjs');
  const files = selectComposeFiles('');
  const calls = [];
  deployCompose(files, (args) => {
    calls.push(args);
    if (args[0] === 'wait') return '0\n';
    if (args.includes('-q')) return 'migration-container\n';
    return '';
  });
  assert.ok(
    calls.findIndex((args) => args[0] === 'wait') <
      calls.findIndex((args) => args.includes('up') && !args.includes('migrate')),
  );
});
test('failed or unobservable migration never reaches service startup', async () => {
  const { deployCompose } = await import('./deploy-mac.mjs');
  for (const exitCode of ['1\n', '', 'unexpected']) {
    const calls = [];
    assert.throws(
      () =>
        deployCompose(selectComposeFiles(''), (args) => {
          calls.push(args);
          if (args[0] === 'wait') return exitCode;
          if (args.includes('-q')) return 'migration-container\n';
          return '';
        }),
      /Migration/,
    );
    assert.equal(
      calls.some((args) => args.includes('up') && !args.includes('migrate')),
      false,
    );
  }
});

test('missing or ambiguous migration identity never starts services', async () => {
  const { deployCompose } = await import('./deploy-mac.mjs');
  for (const identity of ['', 'one\ntwo']) {
    const calls = [];
    assert.throws(
      () =>
        deployCompose(selectComposeFiles(''), (args) => {
          calls.push(args);
          return args.includes('-q') ? identity : '';
        }),
      /Migration container/,
    );
    assert.equal(
      calls.some((args) => args[0] === 'wait'),
      false,
    );
    assert.equal(
      calls.some((args) => args.includes('up') && !args.includes('migrate')),
      false,
    );
  }
});
test('build failure preserves running writers and does not attempt migration', async () => {
  const { deployCompose } = await import('./deploy-mac.mjs');
  const calls = [];
  assert.throws(
    () =>
      deployCompose(selectComposeFiles(''), (args) => {
        calls.push(args);
        throw new Error('build failed');
      }),
    /build failed/,
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('build'));
});
