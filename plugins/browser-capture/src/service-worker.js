import { buildCaptureMetadata } from './capture-metadata.js';
import { createQueueRunner } from './queue-runner.js';
import { selectCompletedJobIdsToPrune } from './queue-policy.js';
import { createQueueStore } from './queue-store.js';

const ALARM_NAME = 'sekereagle-capture-drain';
const store = createQueueStore();
const runner = createQueueRunner({ store, getConfig, onStateChange: maintainQueueState });

chrome.runtime.onInstalled.addListener(() => void initialize());
chrome.runtime.onStartup.addListener(() => void initialize());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void runner.drain();
});
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') void resumeConfiguredJobs();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) =>
      sendResponse({ ok: false, error: error instanceof Error ? error.message : '操作失败' }),
    );
  return true;
});

void initialize();

async function initialize() {
  if (chrome.storage.local.setAccessLevel) {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});
  }
  await store.recoverInterrupted();
  await ensureAlarm();
  await updateBadge();
  await runner.drain();
}

async function handleMessage(message, sender) {
  if (message?.type === 'capture:enqueue') return enqueue(message.payload, sender);
  if (message?.type === 'queue:summary') return queueSummary();
  if (message?.type === 'queue:retry') {
    const job = await store.get(message.id);
    if (!job) throw new Error('找不到该采集任务。');
    await store.update(job.id, { status: 'RETRY', nextAttemptAt: Date.now(), lastError: null });
    void runner.drain();
    return queueSummary();
  }
  if (message?.type === 'config:changed') {
    await resumeConfiguredJobs();
    return queueSummary();
  }
  throw new Error('不支持的插件消息。');
}

async function enqueue(payload, sender) {
  if (!sender.tab || !sender.url) throw new Error('采集请求必须来自当前网页。');
  const senderUrl = new URL(sender.url);
  const pageUrl = new URL(String(payload?.pageUrl || ''));
  if (!['http:', 'https:'].includes(senderUrl.protocol) || senderUrl.origin !== pageUrl.origin) {
    throw new Error('网页来源校验失败。');
  }
  const sourceUrl = String(payload?.sourceUrl || '');
  const sourceProtocol = new URL(sourceUrl).protocol;
  if (!['http:', 'https:', 'data:', 'blob:'].includes(sourceProtocol)) {
    throw new Error('不支持该图片地址。');
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  await store.put({
    id,
    status: 'PENDING',
    sourceUrl,
    metadata: buildCaptureMetadata({
      pageUrl: payload.pageUrl,
      pageTitle: String(payload.pageTitle || '').slice(0, 1000),
      imageUrl: sourceUrl,
      altText: String(payload.altText || '').slice(0, 1000),
    }),
    capturedAt: new Date(now).toISOString(),
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    blob: null,
    server: null,
  });
  await updateBadge();
  void runner.drain();
  const summary = await queueSummary();
  return { id, pendingCount: summary.pendingCount };
}

async function getConfig() {
  return chrome.storage.local.get({
    connectionMode: 'auto',
    localServerUrl: 'http://localhost:8180',
    publicServerUrl: '',
    allowInsecurePublicHttp: false,
    serverUrl: '',
    pat: '',
    concurrency: 3,
  });
}

async function resumeConfiguredJobs() {
  for (const job of await store.list()) {
    if (['WAITING_CONFIG', 'PAUSED_AUTH'].includes(job.status)) {
      await store.update(job.id, { status: 'RETRY', nextAttemptAt: Date.now(), lastError: null });
    }
  }
  await updateBadge();
  void runner.drain();
}

async function queueSummary() {
  const jobs = await store.list();
  const activeStatuses = new Set([
    'PENDING',
    'RETRY',
    'FETCHING',
    'UPLOADING',
    'COMMITTING',
    'WAITING_CONFIG',
    'PAUSED_AUTH',
  ]);
  return {
    pendingCount: jobs.filter((job) => activeStatuses.has(job.status)).length,
    failedCount: jobs.filter((job) => job.status === 'FAILED').length,
    completedCount: jobs.filter((job) => job.status === 'COMPLETED').length,
    jobs: jobs
      .slice(-20)
      .reverse()
      .map((job) => withoutSensitiveQueueFields(job)),
  };
}

function withoutSensitiveQueueFields(job) {
  const summary = { ...job };
  delete summary.blob;
  delete summary.sourceUrl;
  return summary;
}

async function updateBadge() {
  const summary = await queueSummary();
  const count = summary.pendingCount + summary.failedCount;
  await chrome.action.setBadgeBackgroundColor({
    color: summary.failedCount ? '#b42318' : '#2f6fed',
  });
  await chrome.action.setBadgeText({ text: count ? String(Math.min(count, 999)) : '' });
}

async function maintainQueueState() {
  const jobs = await store.list();
  await Promise.all(selectCompletedJobIdsToPrune(jobs, Date.now()).map((id) => store.delete(id)));
  await updateBadge();
}

async function ensureAlarm() {
  if (!(await chrome.alarms.get(ALARM_NAME))) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  }
}
