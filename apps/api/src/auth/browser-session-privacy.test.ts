import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserSessionService } from './browser-session.service';
test('logout clears both independent library privacy grants', () => {
  const cleared: string[] = [];
  const browser = new BrowserSessionService({ getOrThrow: () => 'http://localhost:8180' } as never);
  browser.clear({ clearCookie: (name: string) => cleared.push(name) } as never);
  assert.ok(cleared.includes('sekereagle_privacy_visibility'));
  assert.ok(cleared.includes('sekereagle_photo_privacy_visibility'));
});
