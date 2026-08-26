import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

void test('API trusts exactly one gateway hop and gateway replaces untrusted forwarded chains', () => {
  const main = readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
  const gateway = readFileSync(path.join(__dirname, '../../../deploy/gateway/nginx.conf'), 'utf8');

  assert.match(main, /app\.set\('trust proxy', 1\)/u);
  assert.doesNotMatch(main, /trust proxy', 'loopback'/u);
  assert.match(gateway, /proxy_set_header X-Forwarded-For \$remote_addr;/u);
  assert.doesNotMatch(gateway, /proxy_add_x_forwarded_for/u);
});
