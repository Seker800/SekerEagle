import { CaptureApiClient, CaptureApiError } from './api-client.js';
import { buildOriginalName, resolveSupportedMimeType } from './capture-metadata.js';
import { buildServerCandidates } from './connection-config.js';
import { decideFailure, selectRunnableJobs } from './queue-policy.js';

const MAX_BYTES = 100 * 1024 * 1024;

export function createQueueRunner({
  store,
  getConfig,
  fetchImpl = fetch,
  onStateChange = () => {},
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
    try {
      if (
        !String(config.pat || '')
          .trim()
          .startsWith('seg_pat_')
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
      if (!blob) {
        await store.update(job.id, { status: 'FETCHING', lastError: null });
        blob = await fetchImage(job.sourceUrl, job.metadata.pageUrl, fetchImpl);
        mimeType = resolveSupportedMimeType(blob.type, job.sourceUrl);
        if (!mimeType) throw typedError('该图片格式暂不受 SekerEagle 支持。', 'PERMANENT');
        originalName = buildOriginalName({
          imageUrl: job.sourceUrl,
          displayName: job.metadata.displayName,
          mimeType,
        });
        await store.update(job.id, { blob, mimeType, originalName, status: 'UPLOADING' });
      } else {
        await store.update(job.id, { status: 'UPLOADING', lastError: null });
      }

      const declaration = {
        clientCaptureId: job.id,
        originalName,
        mimeType,
        size: blob.size,
        ...job.metadata,
        capturedAt: job.capturedAt,
        extensionVersion: chrome.runtime.getManifest().version,
      };
      const { api, session } = await initiateWithFallback({
        serverCandidates,
        pat: config.pat,
        fetchImpl,
        declaration,
      });
      await store.update(job.id, { server: { ...session, serverUrl: api.serverUrl } });
      if (session.status === 'COMPLETED' && session.assetId) {
        await markCompleted(store, job.id, session);
        return;
      }
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
      await store.update(job.id, { status: 'COMMITTING' });
      const completed = await api.complete(job.id, parts);
      await markCompleted(store, job.id, completed);
    } catch (error) {
      const attempts = (job.attempts || 0) + 1;
      const decision = decideFailure(error, attempts, Date.now());
      await store.update(job.id, {
        ...decision,
        attempts,
        lastError: error instanceof Error ? error.message.slice(0, 500) : '未知错误',
      });
    }
  }

  return { drain };
}

async function initiateWithFallback({ serverCandidates, pat, fetchImpl, declaration }) {
  let lastError;
  for (const serverUrl of serverCandidates) {
    const api = new CaptureApiClient({ serverUrl, pat, fetchImpl });
    try {
      return { api, session: await api.initiate(declaration) };
    } catch (error) {
      lastError = error;
      if (!(error instanceof CaptureApiError) || error.status !== 0) throw error;
    }
  }
  throw lastError ?? new CaptureApiError('无法连接 SekerEagle。');
}

function markCompleted(store, jobId, completed) {
  return store.update(jobId, {
    status: 'COMPLETED',
    blob: null,
    assetId: completed.assetId,
    duplicate: completed.duplicate,
    completedAt: Date.now(),
    nextAttemptAt: null,
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
