import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

// Single-owner use must not be rejected by a request-count quota.
test('the API has no global, endpoint or media request-frequency quota', () => {
  const violations: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
        if (/from\s+['"]@nestjs\/throttler(?:\/[^'"]*)?['"]/.test(readFileSync(file, 'utf8')))
          violations.push(file);
      }
    }
  };
  visit(__dirname);
  assert.deepEqual(violations, [], 'Request counting must not reject normal personal use');
});

test('removed rate-limit configuration cannot remain part of deployment defaults', () => {
  const root = resolve(__dirname, '../../..');
  for (const file of [
    '.env.example',
    'deploy/mac/docker-compose.yml',
    'apps/api/src/config/runtime-config.ts',
  ])
    assert.doesNotMatch(
      readFileSync(join(root, file), 'utf8'),
      /EAGLE_MEDIA_(?:THROTTLE|OWNER_RATE|IP_RATE)/,
      file,
    );
  const manifest = JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  assert.equal(manifest.dependencies['@nestjs/throttler'], undefined);
  assert.doesNotMatch(
    readFileSync(join(root, 'deploy/gateway/nginx.conf'), 'utf8'),
    /\blimit_req(?:_zone)?\b/,
  );
});
