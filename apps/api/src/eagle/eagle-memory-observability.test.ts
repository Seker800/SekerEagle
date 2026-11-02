import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LibraryReadObserver, readerActionEnabled } from './eagle-memory-observability';

test('default policy leaves indexed pages and counts to SQL and keeps aggregate acceleration', () => {
  assert.equal(readerActionEnabled('page', undefined), false);
  assert.equal(readerActionEnabled('count', undefined), false);
  for (const action of ['statistics', 'facets', 'peopleCounts', 'smartFolderPage', 'colorPage'] as const)
    assert.equal(readerActionEnabled(action, undefined), true);
  assert.equal(readerActionEnabled('page', 'page,count'), true);
  assert.equal(readerActionEnabled('count', ''), false);
});

test('a failed action bypasses the reader until one recovery probe succeeds', () => {
  const observer = new LibraryReadObserver();
  assert.equal(observer.enter('colorPage', 'http://reader', 0), true);
  observer.failed('colorPage', 'http://reader', 5000, 0);
  assert.equal(observer.enter('colorPage', 'http://reader', 10), false);
  assert.equal(observer.enter('statistics', 'http://reader', 10), true);
  assert.equal(observer.enter('colorPage', 'http://reader', 5001), true);
  assert.equal(observer.enter('colorPage', 'http://reader', 5002), false);
  observer.recovered('colorPage');
  assert.equal(observer.enter('colorPage', 'http://reader', 5003), true);
});

test('bounded diagnostics count actual fallback reasons and approximate latency without retaining user data', () => {
  const observer = new LibraryReadObserver();
  observer.record('count', 'disabled');
  observer.record('colorPage', 'hit', 20);
  observer.record('colorPage', 'timeout', 1000);
  observer.record('colorPage', 'circuitOpen');
  observer.record('peopleCounts', 'hit', 30);
  observer.rejectHit('peopleCounts');
  const snapshot = observer.snapshot();
  assert.equal(snapshot.actions.count.bypassed, 1);
  assert.equal(snapshot.actions.colorPage.attempts, 2);
  assert.equal(snapshot.actions.colorPage.hits, 1);
  assert.equal(snapshot.actions.colorPage.fallbacks, 1);
  assert.equal(snapshot.actions.colorPage.reasons.timeout, 1);
  assert.equal(snapshot.actions.colorPage.reasons.circuitOpen, 1);
  assert.equal(snapshot.actions.colorPage.p95UpperBoundMs, 1000);
  assert.equal(snapshot.actions.peopleCounts.hits, 0);
  assert.equal(snapshot.actions.peopleCounts.reasons.stale, 1);
  assert.equal(JSON.stringify(snapshot).includes('owner'), false);
});
