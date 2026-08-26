import { CaptureApiClient, CaptureApiError } from './api-client.js';
import {
  buildOriginalName,
  resolveSupportedMimeType,
  sanitizeImageSourceUrl,
} from './capture-metadata.js';
import { normalizeCaptureSourceCandidates } from './capture-source.js';
import { buildServerCandidates } from './connection-config.js';
import { decideFailure, selectRunnableJobs } from './queue-policy.js';
import { runtimeFetch } from './runtime-fetch.js';

const MAX_BYTES = 100 * 1024 * 1024;

export function createQueueRunner({
  store,
  getConfig,
  fetchImpl = runtimeFetch,
  onStateChange = () => {},
  onTerminalState = () => {},
  onConnectionRestored = () => {},
}) {
  let runningPromise = null;

  async function drain() {
    if (runningPromise) return runningPromise;
    runningPromise = runLoop().finally(() => {
      runningPromise = null;
    });
    return runningPromise;
  }

  async function runLoop() {
    const config = await getConfig();
    const concurrency = Math.min(6, Math.max(1, Number(config.concurrency) || 3));
    while (true) {
      const queued = await store.list();
      const jobs = selectRunnableJobs(queued, Date.now(), queued.length);
      if (!jobs.length) break;
      for (let index = 0; index < jobs.length; index += concurrency) {
        await Promise.all(
          jobs.slice(index, index + concurrency).map((job) => processJob(job, config)),
        );
      }
    }
    await onStateChange();
  }

  async function processJob(job, config) {
    let failureStage = 'CONFIG';
    try {
      if (
        !String(config.pat || '')
          .trim()
          .startsWith('sea_pat_')
      ) {
        throw typedError('请先配置有效的服务器和 PAT。', 'CONFIG');
      }
      let serverCandidates;
      try {
        serverCandidates = buildServerCandidates(config);
      } catch (cause) {
        throw typedError(cause instanceof Error ? cause.message : '服务器配置无效。', 'CONFIG');
      }
      let blob = job.blob;
      let mimeType = job.mimeType;
      let originalName = job.originalName;
      let sourceUrl = job.sourceUrl;
      let metadata = job.metadata;
      if (!blob) {
        failureStage = 'SOURCE_DOWNLOAD';
        await store.update(job.id, { status: 'FETCHING', lastError: null });
        let downloaded;
        try {
          downloaded = await downloadFirstSupportedCandidate(job, fetchImpl);
        } catch (error) {
          if (!job.fallbackBlob) throw error;
          downloaded = {
            blob: job.fallbackBlob,
            mimeType: 'image/png',
            sourceUrl: job.sourceUrl || job.metadata.pageUrl,
          };
        }
        ({ blob, mimeType, sourceUrl } = downloaded);
        metadata = {
          ...job.metadata,
          imageUrl: sanitizeImageSourceUrl(job.sourceUrl || sourceUrl),
        };
        originalName = buildOriginalName({
          imageUrl: sourceUrl,
          displayName: job.metadata.displayName,
          mimeType,
        });
        await store.update(job.id, {
          blob,
          mimeType,
          originalName,
          sourceUrl,
          sourceCandidates: [],
          fallbackBlob: null,
          metadata,
          status: 'UPLOADING',
        });
      } else {
        await store.update(job.id, {
          status: 'UPLOADING',
          lastError: null,
          fallbackBlob: null,
        });
      }

      const declaration = {
        clientCaptureId: job.id,
        originalName,
        mimeType,
        size: blob.size,
        ...metadata,
        capturedAt: job.capturedAt,
        extensionVersion: chrome.runtime.getManifest().version,
      };
      failureStage = 'SERVER_CONNECT';
      const { api, session } = await initiateWithFallback({
        serverCandidates,
        pat: config.pat,
        fetchImpl,
        declaration,
      });
      await store.update(job.id, { server: { ...session, serverUrl: api.serverUrl } });
      if (session.status === 'COMPLETED' && session.assetId) {
        await markCompleted(store, job.id, session);
        await safelyReportConnectionRestored(onConnectionRestored, job.id);
        await safelyReportTerminalState(onTerminalState, job, {
          status: 'COMPLETED',
          assetId: session.assetId,
          duplicate: session.duplicate,
        });
        return;
      }
      failureStage = 'UPLOAD';
      const uploaded = session.replayed ? await api.listParts(job.id) : { parts: [] };
      const knownParts = new Map(uploaded.parts.map((part) => [part.partNumber, part]));
      const parts = [];
      const partCount = Math.ceil(blob.size / session.partSize);
      for (let index = 0; index < partCount; index += 1) {
        const partNumber = index + 1;
        const known = knownParts.get(partNumber);
        if (known) {
          parts.push({ partNumber, etag: known.etag });
          continue;
        }
        const signed = await api.presignPart(job.id, partNumber);
        const bytes = blob.slice(
          index * session.partSize,
          Math.min(blob.size, (index + 1) * session.partSize),
        );
        const uploadedPart = await api.uploadPart(signed.uploadUrl, bytes);
        parts.push({ partNumber, etag: uploadedPart.etag });
      }
      failureStage = 'COMMIT';
      await store.update(job.id, { status: 'COMMITTING' });
      const completed = await api.complete(job.id, parts);
      await markCompleted(store, job.id, completed);
      await safelyReportConnectionRestored(onConnectionRestored, job.id);
      await safelyReportTerminalState(onTerminalState, job, {
        status: 'COMPLETED',
        assetId: completed.assetId,
        duplicate: completed.duplicate,
      });
    } catch (error) {
      const attempts = (job.attempts || 0) + 1;
      const decision = decideFailure(error, attempts, Date.now());
      await store.update(job.id, {
        ...decision,
        attempts,
        lastFailureStage: failureStage,
        lastError: error instanceof Error ? error.message.slice(0, 500) : '未知错误',
      });
      if (['FAILED', 'PAUSED_AUTH', 'WAITING_CONFIG'].includes(decision.status)) {
        await safelyReportTerminalState(onTerminalState, job, {
          status: decision.status,
          lastError: error instanceof Error ? error.message.slice(0, 500) : '未知错误',
        });
      }
    }
  }

  return { drain };
}

async function safelyReportConnectionRestored(report, successfulJobId) {
  try {
    await report({ successfulJobId });
  } catch {
    // Queue recovery feedback must never fail the capture that proved connectivity.
  }
}

async function safelyReportTerminalState(report, job, result) {
  try {
    await report({
      id: job.id,
      metadata: job.metadata,
      originTabId: job.originTabId,
      originFrameId: job.originFrameId,
      ...result,
    });
  } catch {
    // Feedback must never turn a successfully persisted capture into a failed job.
  }
}

async function downloadFirstSupportedCandidate(job, fetchImpl) {
  const candidates = normalizeCaptureSourceCandidates(job);
  let lastError = typedError('没有可下载的图片地址。', 'PERMANENT');
  for (const sourceUrl of candidates) {
    try {
      const blob = await fetchImage(sourceUrl, job.metadata.pageUrl, fetchImpl);
      const mimeType = resolveSupportedMimeType(blob.type, sourceUrl);
      if (!mimeType) {
        lastError = typedError('该候选图片格式暂不受 SekerEagle 支持。', 'PERMANENT');
        continue;
      }
      return { blob, mimeType, sourceUrl };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function initiateWithFallback({ serverCandidates, pat, fetchImpl, declaration }) {
  let lastError;
  for (const serverUrl of serverCandidates) {
    const api = new CaptureApiClient({
      serverUrl,
      pat,
      allowInsecureHttp: serverUrl.startsWith('http://') && !isLoopbackServer(serverUrl),
      fetchImpl,
    });
    try {
      return { api, session: await api.initiate(declaration) };
    } catch (error) {
      lastError = error;
      if (!(error instanceof CaptureApiError) || error.status !== 0) throw error;
    }
  }
  throw lastError ?? new CaptureApiError('无法连接 SekerEagle。');
}

function isLoopbackServer(serverUrl) {
  const hostname = new URL(serverUrl).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function markCompleted(store, jobId, completed) {
  return store.update(jobId, {
    status: 'COMPLETED',
    blob: null,
    fallbackBlob: null,
    assetId: completed.assetId,
    duplicate: completed.duplicate,
    completedAt: Date.now(),
    nextAttemptAt: null,
    lastFailureStage: null,
    lastError: null,
  });
}

async function fetchImage(sourceUrl, pageUrl, fetchImpl) {
  const protocol = new URL(sourceUrl).protocol;
  if (protocol === 'blob:') throw typedError('暂不支持网页临时 Blob 图片。', 'PERMANENT');
  if (!['http:', 'https:', 'data:'].includes(protocol)) {
    throw typedError('不支持该图片地址。', 'PERMANENT');
  }
  let response;
  try {
    response = await fetchImpl(sourceUrl, {
      credentials: 'include',
      cache: 'no-store',
      referrer: pageUrl,
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
  } catch (cause) {
    throw new CaptureApiError(cause instanceof Error ? cause.message : '图片下载失败。');
  }
  if (!response.ok) {
    const kind = response.status === 404 || response.status === 410 ? 'PERMANENT' : 'TRANSIENT';
    throw typedError(`图片下载失败（${response.status}）。`, kind);
  }
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > MAX_BYTES) throw typedError('图片大小不能超过 100MB。', 'PERMANENT');
  const blob = await response.blob();
  if (!blob.size) throw typedError('下载到的图片为空。', 'PERMANENT');
  if (blob.size > MAX_BYTES) throw typedError('图片大小不能超过 100MB。', 'PERMANENT');
  return blob;
}

function typedError(message, kind) {
  return new CaptureApiError(message, { kind });
}
