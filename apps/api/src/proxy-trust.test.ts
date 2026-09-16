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
  assert.match(gateway, /location \/api\/ \{[^}]*proxy_set_header Host \$http_host;/u);
  assert.doesNotMatch(gateway, /location \/api\/ \{[^}]*proxy_set_header Host \$host;/u);
  assert.match(gateway, /location \/api\/[\s\S]*proxy_connect_timeout 3s;/u);
  assert.match(gateway, /location \/api\/[\s\S]*proxy_read_timeout 15s;/u);
  assert.match(gateway, /location \/api\/[\s\S]*proxy_send_timeout 15s;/u);
  assert.match(gateway, /location \/api\/[\s\S]*proxy_buffering off;/u);
});

void test('gateway re-resolves replaceable compose services without a manual restart', () => {
  const gateway = readFileSync(path.join(__dirname, '../../../deploy/gateway/nginx.conf'), 'utf8');

  assert.match(gateway, /upstream api_backend \{[\s\S]*server api:3000 resolve;/u);
  assert.match(gateway, /upstream web_backend \{[\s\S]*server web:8080 resolve;/u);
  assert.match(gateway, /upstream minio_backend \{[\s\S]*server minio:9000 resolve;/u);
  assert.match(gateway, /resolver 127\.0\.0\.11 valid=5s ipv6=off;/u);
  assert.match(gateway, /location \/api\/ \{[^}]*proxy_pass http:\/\/api_backend;/u);
  assert.match(gateway, /location \/ \{[^}]*proxy_pass http:\/\/web_backend;/u);
});
