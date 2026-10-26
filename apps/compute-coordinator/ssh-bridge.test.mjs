import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setImmediate } from 'node:timers';
import { createSshBridge, sshAdminRequest } from './ssh-bridge.mjs';

test('SSH bridge authenticates locally and exposes only the existing bounded admin routes', async (t) => {
  const calls = [];
  const server = createSshBridge({
    token: 'local-admin-token',
    target: 'SekerDesign',
    invoke: async (input) => {
      calls.push(input);
      return { status: 200, body: '{"revision":1,"nodes":[]}' };
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/admin/fleet')).status, 401);
  assert.equal(
    (await fetch(base + '/arbitrary', { headers: { authorization: 'Bearer local-admin-token' } }))
      .status,
    404,
  );
  const response = await fetch(base + '/admin/policy', {
    method: 'POST',
    headers: { authorization: 'Bearer local-admin-token' },
    body: '{"expectedRevision":0}',
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 1);
  assert.deepEqual(calls, [
    { path: '/admin/policy', method: 'POST', body: '{"expectedRevision":0}' },
  ]);
  assert.equal(
    (
      await fetch(base + '/admin/policy', {
        method: 'POST',
        headers: { authorization: 'Bearer local-admin-token' },
        body: 'x'.repeat(16385),
      })
    ).status,
    413,
  );
  assert.equal(calls.length, 1);
});

test('SSH transport uses a fixed command and carries input on stdin without an inline credential', async () => {
  let wire = '';
  let args;
  const execute = (command, values, options, callback) => {
    assert.equal(command, '/usr/bin/ssh');
    args = values;
    assert.equal(options.timeout, 8000);
    return {
      stdin: {
        on() {},
        end(value) {
          wire = value;
          Promise.resolve().then(() => callback(null, '{"status":409,"body":"{}"}'));
        },
      },
    };
  };
  const input = {
    path: '/admin/enroll',
    method: 'POST',
    body: '{"token":"synthetic-sensitive-value"}',
  };
  assert.deepEqual(await sshAdminRequest('SekerDesign', input, execute), {
    status: 409,
    body: '{}',
  });
  assert.deepEqual(JSON.parse(wire), input);
  assert.ok(!args.join(' ').includes('synthetic-sensitive-value'));
  assert.ok(args.includes('StrictHostKeyChecking=yes'));
  await assert.rejects(sshAdminRequest('-oProxyCommand=bad', input, execute), /INVALID_SSH_TARGET/);
});

test('failed SSH calls do not expose errors or leak local admission slots', async (t) => {
  let fails = true;
  const server = createSshBridge({
    token: 'local-admin-token',
    target: 'SekerDesign',
    invoke: async () => {
      if (fails) throw new Error('synthetic private diagnostic');
      return { status: 200, body: '{}' };
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/admin/fleet`;
  for (let i = 0; i < 3; i++) {
    const response = await fetch(url, { headers: { authorization: 'Bearer local-admin-token' } });
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes('private diagnostic'));
  }
  fails = false;
  assert.equal(
    (await fetch(url, { headers: { authorization: 'Bearer local-admin-token' } })).status,
    200,
  );
});

test('a third concurrent management call is rejected until an admitted call finishes', async (t) => {
  let started = 0,
    release;
  const gate = new Promise((resolve) => (release = resolve));
  const server = createSshBridge({
    token: 'local-admin-token',
    target: 'SekerDesign',
    invoke: async () => {
      started++;
      await gate;
      return { status: 200, body: '{}' };
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    release();
    server.closeAllConnections();
    server.close();
  });
  const request = () =>
    fetch(`http://127.0.0.1:${server.address().port}/admin/fleet`, {
      headers: { authorization: 'Bearer local-admin-token' },
    });
  const a = request(),
    b = request();
  while (started < 2) await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await request()).status, 503);
  release();
  assert.equal((await a).status, 200);
  assert.equal((await b).status, 200);
});

test('SSH response envelopes reject malformed or oversized data', async () => {
  for (const output of [
    'not-json',
    JSON.stringify({ status: 600, body: '{}' }),
    JSON.stringify({ status: 200, body: 'x'.repeat(262145) }),
  ]) {
    const execute = (_command, _args, _options, callback) => ({
      stdin: {
        on() {},
        end() {
          void Promise.resolve().then(() => callback(null, output));
        },
      },
    });
    await assert.rejects(
      sshAdminRequest('SekerDesign', { path: '/admin/fleet', method: 'GET', body: '' }, execute),
      /INVALID_CONTROL_RESPONSE/,
    );
  }
});
