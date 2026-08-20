import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const nginx = await readFile(new URL('../nginx.conf', import.meta.url), 'utf8');

test('web shell is always revalidated while hashed assets are immutable', () => {
  assert.match(
    nginx,
    /location = \/index\.html \{[\s\S]*add_header Cache-Control "no-cache" always;/u,
  );
  assert.match(
    nginx,
    /location \/assets\/ \{[\s\S]*add_header Cache-Control "public, max-age=31536000, immutable" always;/u,
  );
});
