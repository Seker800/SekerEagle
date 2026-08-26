import assert from 'node:assert/strict';
import test from 'node:test';
import { failureStageLabel, jobTimestamp, relativeTime, retrySchedule } from '../src/popup-time.js';

test('uses completion time for completed captures and update time for failures', () => {
  assert.equal(
    jobTimestamp({ status: 'COMPLETED', createdAt: 1, updatedAt: 2, completedAt: 3 }),
    3,
  );
  assert.equal(jobTimestamp({ status: 'FAILED', createdAt: 1, updatedAt: 2 }), 2);
});

test('formats queue ages in useful human units', () => {
  const now = 10 * 24 * 60 * 60 * 1_000;
  assert.equal(relativeTime(now - 30_000, now), '刚刚');
  assert.equal(relativeTime(now - 12 * 60_000, now), '12 分钟前');
  assert.equal(relativeTime(now - 3 * 60 * 60_000, now), '3 小时前');
  assert.equal(relativeTime(now - 2 * 24 * 60 * 60_000, now), '2 天前');
});

test('shows the next automatic retry and a useful failure stage', () => {
  const now = 1_000_000;
  assert.equal(
    retrySchedule({ status: 'RETRY', nextAttemptAt: now + 3 * 60_000 }, now),
    '预计 3 分钟后重试',
  );
  assert.equal(
    retrySchedule({ status: 'RETRY', nextAttemptAt: now + 30_000 }, now),
    '即将自动重试',
  );
  assert.equal(retrySchedule({ status: 'COMPLETED', nextAttemptAt: now }, now), '');
  assert.equal(failureStageLabel('SOURCE_DOWNLOAD'), '源图下载失败');
  assert.equal(failureStageLabel('SERVER_CONNECT'), '服务器连接失败');
});
