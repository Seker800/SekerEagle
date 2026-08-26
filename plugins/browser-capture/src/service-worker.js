import {
  buildCaptureMetadata,
  buildOriginalName,
  resolveSupportedMimeType,
} from './capture-metadata.js';
import { normalizeCaptureSourceCandidates } from './capture-source.js';
import { createQueueRunner } from './queue-runner.js';
import {
  selectCompletedJobIdsToPrune,
  selectConnectivityRetryJobIds,
} from './queue-policy.js';
import { createQueueStore } from './queue-store.js';

const ALARM_NAME = 'sekereagle-capture-drain';
const MAX_BROWSER_COPY_BYTES = 16 * 1024 * 1024;
const CONNECTION_RECOVERY_WAKE_THROTTLE_MS = 30_000;
let lastConnectionRecoveryWakeAt = 0;
const store = createQueueStore();
const runner = createQueueRunner({
  store,
  getConfig,
  onStateChange: maintainQueueState,
  onTerminalState: notifyCaptureResult,
  onConnectionRestored: wakeConnectivityRetries,
});

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
    await store.update(job.id, {
      status: 'RETRY',
      nextAttemptAt: Date.now(),
      lastError: null,
      lastFailureStage: null,
    });
    void runner.drain();
    return queueSummary();
  }
  if (message?.type === 'queue:retry-all') {
    const retryable = (await store.list()).filter((job) =>
      ['RETRY', 'FAILED', 'PAUSED_AUTH', 'WAITING_CONFIG'].includes(job.status),
    );
    await Promise.all(
      retryable.map((job) =>
        store.update(job.id, {
          status: 'RETRY',
          nextAttemptAt: Date.now(),
          lastError: null,
          lastFailureStage: null,
        }),
      ),
    );
    await updateBadge();
    void runner.drain();
    return { ...(await queueSummary()), retriedCount: retryable.length };
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
  const sourceCandidates = normalizeCaptureSourceCandidates(payload);
  const sourceUrl = sourceCandidates[0] || null;
  const browserCopy = await decodeBrowserCopy(payload?.browserCopy, sourceCandidates);
  const screenshot = browserCopy ? null : await captureVisibleFallback(payload, sender);
  if (!sourceUrl && !screenshot) throw new Error('这里没有可采集的图片或可见内容。');
  const id = crypto.randomUUID();
  const now = Date.now();
  const metadata = buildCaptureMetadata({
    pageUrl: payload.pageUrl,
    pageTitle: String(payload.pageTitle || '').slice(0, 1000),
    imageUrl: sourceUrl || '',
    altText: String(payload.altText || '').slice(0, 1000),
  });
  const initialBlob = browserCopy?.blob ?? (!sourceUrl ? screenshot : null);
  const initialMimeType =
    browserCopy?.mimeType ?? (!sourceUrl && screenshot ? 'image/png' : null);
  await store.put({
    id,
    status: 'PENDING',
    sourceUrl,
    sourceCandidates,
    metadata,
    capturedAt: new Date(now).toISOString(),
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    lastFailureStage: null,
    blob: initialBlob,
    mimeType: initialMimeType,
    originalName: initialBlob
      ? buildOriginalName({
          imageUrl: sourceUrl || payload.pageUrl,
          displayName: metadata.displayName,
          mimeType: initialMimeType,
        })
      : null,
    fallbackBlob: sourceUrl ? screenshot : null,
    server: null,
    originTabId: sender.tab.id,
    originFrameId: sender.frameId ?? 0,
  });
  await updateBadge();
  void runner.drain();
  const summary = await queueSummary();
  return { id, pendingCount: summary.pendingCount };
}

async function decodeBrowserCopy(copy, sourceCandidates) {
  if (!copy || typeof copy.dataUrl !== 'string') return null;
  if (!sourceCandidates.includes(String(copy.originalUrl || ''))) return null;
  const declaredMimeType = String(copy.mimeType || '').trim().toLowerCase();
  const declaredSize = Number(copy.size);
  if (
    !Number.isSafeInteger(declaredSize) ||
    declaredSize <= 0 ||
    declaredSize > MAX_BROWSER_COPY_BYTES ||
    !copy.dataUrl.startsWith(`data:${declaredMimeType};base64,`)
  ) {
    return null;
  }
  const encoded = copy.dataUrl.slice(copy.dataUrl.indexOf(',') + 1);
  if (encoded.length > Math.ceil(declaredSize / 3) * 4 + 4) return null;
  try {
    const response = await fetch(copy.dataUrl);
    const blob = await response.blob();
    const mimeType = resolveSupportedMimeType(blob.type, copy.originalUrl);
    if (!mimeType || mimeType !== declaredMimeType || blob.size !== declaredSize) return null;
    return { blob, mimeType };
  } catch {
    return null;
  }
}

async function captureVisibleFallback(payload, sender) {
  if (!sender.tab || sender.frameId !== 0 || !payload?.captureRect || !payload?.viewport) {
    return null;
  }
  let bitmap;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
    const source = await (await fetch(dataUrl)).blob();
    bitmap = await createImageBitmap(source);
    const crop = normalizeCrop(payload.captureRect, payload.viewport, bitmap.width, bitmap.height);
    if (!crop) return null;
    const canvas = new OffscreenCanvas(crop.width, crop.height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );
    return await canvas.convertToBlob({ type: 'image/png' });
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

function normalizeCrop(rectangle, viewport, imageWidth, imageHeight) {
  const viewportWidth = Number(viewport.width);
  const viewportHeight = Number(viewport.height);
  if (viewportWidth <= 0 || viewportHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }
  const scaleX = imageWidth / viewportWidth;
  const scaleY = imageHeight / viewportHeight;
  const x = Math.max(0, Math.floor(Number(rectangle.x) * scaleX));
  const y = Math.max(0, Math.floor(Number(rectangle.y) * scaleY));
  const width = Math.min(
    imageWidth - x,
    Math.max(1, Math.ceil(Number(rectangle.width) * scaleX)),
  );
  const height = Math.min(
    imageHeight - y,
    Math.max(1, Math.ceil(Number(rectangle.height) * scaleY)),
  );
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

async function getConfig() {
  return chrome.storage.local.get({
    connectionMode: 'auto',
    localServerUrl: 'http://localhost:8180',
    allowInsecureLocalHttp: false,
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
    retryableCount: jobs.filter((job) =>
      ['RETRY', 'FAILED', 'PAUSED_AUTH', 'WAITING_CONFIG'].includes(job.status),
    ).length,
    jobs: jobs
      .slice(-20)
      .reverse()
      .map((job) => withoutSensitiveQueueFields(job)),
  };
}

async function wakeConnectivityRetries({ successfulJobId }) {
  const now = Date.now();
  if (now - lastConnectionRecoveryWakeAt < CONNECTION_RECOVERY_WAKE_THROTTLE_MS) return;
  lastConnectionRecoveryWakeAt = now;
  const jobIds = selectConnectivityRetryJobIds(await store.list(), successfulJobId);
  if (!jobIds.length) return;
  await Promise.all(
    jobIds.map((id) =>
      store.update(id, {
        status: 'RETRY',
        nextAttemptAt: now,
        recoveryWokenAt: now,
      }),
    ),
  );
  await updateBadge();
}

function withoutSensitiveQueueFields(job) {
  const summary = { ...job };
  delete summary.blob;
  delete summary.sourceUrl;
  delete summary.sourceCandidates;
  delete summary.fallbackBlob;
  delete summary.originTabId;
  delete summary.originFrameId;
  return summary;
}

async function notifyCaptureResult(result) {
  const succeeded = result.status === 'COMPLETED';
  const displayName = String(result.metadata?.displayName || '图片').slice(0, 80);
  const message = succeeded
    ? result.duplicate
      ? `“${displayName}”已存在，采集记录已保存。`
      : `“${displayName}”已成功保存到素材库。`
    : `“${displayName}”采集失败：${result.lastError || '未知错误'}`;

  const feedback = {
    type: 'capture:result',
    id: result.id,
    status: result.status,
    message,
  };
  if (Number.isInteger(result.originTabId)) {
    await chrome.tabs
      .sendMessage(result.originTabId, feedback, { frameId: result.originFrameId ?? 0 })
      .catch(() => {});
  }

  await chrome.notifications
    .create(`capture:${result.id}:${result.status}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon.svg'),
      title: succeeded ? 'SekerEagle 灵感采集成功' : 'SekerEagle 灵感采集失败',
      message,
      priority: succeeded ? 0 : 2,
      requireInteraction: !succeeded,
      silent: false,
    })
    .catch(() => {});
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
