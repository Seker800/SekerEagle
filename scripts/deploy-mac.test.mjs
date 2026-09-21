import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertGatewayBindings,
  composeArgs,
  expectedGatewayBindings,
  isPrivateIpv4,
  parseEnv,
  selectComposeFiles,
} from './deploy-mac.mjs';

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
