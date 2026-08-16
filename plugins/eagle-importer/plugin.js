'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const stateKey = 'sekereagle-independent-importer-v2';
const elements = {};
let library = null;
let api = null;
let busy = false;
let cancelled = false;

function element(id) { return document.getElementById(id); }
function log(message) { elements.log.textContent += `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}\n`; elements.log.scrollTop = elements.log.scrollHeight; }
function progress(label, current, total) { const ratio = total ? Math.min(1, current / total) : 0; elements.phase.textContent = label; elements.percent.textContent = `${Math.round(ratio * 100)}%`; elements.bar.style.width = `${ratio * 100}%`; }
function readState() { try { return JSON.parse(localStorage.getItem(stateKey) || '{}'); } catch { return {}; } }
function saveState(patch) { localStorage.setItem(stateKey, JSON.stringify({ ...readState(), ...patch })); }
function setConnected(value) { elements.badge.textContent = value ? '已连接' : '未连接'; elements.badge.classList.toggle('connected', value); elements.start.disabled = !value || busy; elements.resume.disabled = !value || busy || !readState().activeRunId; }
function setBusy(value) { busy = value; elements.connect.disabled = value; elements.start.disabled = value || !api; elements.resume.disabled = value || !api || !readState().activeRunId; elements.cancel.disabled = !value; }
function assertActive() { if (cancelled) throw new Error('任务已取消。'); }

class Api {
  constructor(server, pat) { this.base = `${server.replace(/\/+$/, '')}/api`; this.pat = pat; }
  async request(pathname, { method = 'GET', body } = {}) {
    const response = await fetch(`${this.base}${pathname}`, { method, headers: { authorization: `Bearer ${this.pat}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(Array.isArray(payload?.message) ? payload.message.join('；') : payload?.message || `HTTP ${response.status}`);
    return payload;
  }
}

async function connect() {
  const server = elements.server.value.trim();
  const pat = elements.pat.value.trim();
  if (!server || !pat.startsWith('se_pat_')) throw new Error('请输入独立 SekerEagle 地址和 PAT。');
  const candidate = new Api(server, pat);
  await candidate.request('/auth/me');
  await candidate.request('/eagle/imports/libraries');
  api = candidate;
  saveState({ server });
  setConnected(true);
  log('连接成功。PAT 只保存在当前插件进程内。');
}

async function scanLibrary() {
  const ids = await eagle.item.getIdsWithModifiedAt();
  const identifiers = [...new Set((ids || []).map((entry) => String(typeof entry === 'string' ? entry : entry?.id || '')).filter(Boolean))];
  const items = [];
  const sourceFiles = new Map();
  let totalBytes = 0;
  for (let offset = 0; offset < identifiers.length; offset += 100) {
    assertActive();
    const batch = await eagle.item.getByIds(identifiers.slice(offset, offset + 100));
    for (const item of batch || []) {
      if (!item?.id) continue;
      const filePath = item.filePath || '';
      let stat = null;
      try { stat = await fsp.stat(filePath); } catch { /* recorded as deleted/unreadable */ }
      const extension = String(item.ext || path.extname(filePath).slice(1) || 'unknown').toLowerCase();
      const size = stat?.isFile() ? stat.size : Math.max(1, Number(item.size) || 1);
      const contentSha256 = stat?.isFile() ? await sha256File(filePath) : undefined;
      const manifestItem = { sourceItemId: String(item.id), name: String(item.name || path.basename(filePath) || item.id).slice(0, 255), originalFileName: path.basename(filePath || `${item.id}.${extension}`).slice(0, 255), extension: extension.slice(0, 16), mimeType: mimeFor(extension), size, importedAt: timestamp(item.importedAt), modifiedAt: timestamp(item.modifiedAt) || null, star: Math.max(0, Math.min(5, Math.trunc(Number(item.star || 0)))), annotation: String(item.annotation || '').slice(0, 10000), sourceUrl: String(item.url || '').slice(0, 2048), tagNames: [...new Set((item.tags || []).map((tag) => String(typeof tag === 'string' ? tag : tag?.name || '')).filter(Boolean))].slice(0, 500), folderIds: [...new Set(item.folders || [])].map(String).slice(0, 100), isDeleted: Boolean(item.isDeleted || !stat?.isFile()), contentSha256, sourceFileModifiedAt: stat?.mtimeMs ? Math.trunc(stat.mtimeMs) : undefined };
      items.push(manifestItem);
      if (stat?.isFile()) sourceFiles.set(String(item.id), { filePath, size, mimeType: manifestItem.mimeType, originalFileName: manifestItem.originalFileName });
      totalBytes += size;
    }
    progress('扫描并计算校验值', Math.min(offset + 100, identifiers.length), identifiers.length);
  }
  return { items, sourceFiles, totalBytes };
}

async function startImport(resume = false) {
  setBusy(true); cancelled = false;
  try {
    const scan = await scanLibrary();
    let runId = resume ? readState().activeRunId : '';
    let run = runId ? await api.request(`/eagle/imports/${runId}`) : null;
    if (!runId) {
      const stableLibraryId = stableLibraryIdentity();
      run = await api.request('/eagle/imports', { method: 'POST', body: { idempotencyKey: `eagle-${Date.now()}-${crypto.randomUUID()}`.slice(0, 128), manifestVersion: 2, externalLibraryId: stableLibraryId, libraryName: library.name, sourceModifiedAt: new Date().toISOString(), declaredItemCount: scan.items.length, declaredByteSize: scan.totalBytes } });
      runId = run.id; saveState({ activeRunId: runId });
    }
    if (run.status === 'DRAFT') {
      for (let offset = 0; offset < scan.items.length; offset += 100) {
        assertActive();
        const index = Math.floor(offset / 100) + 1;
        await api.request(`/eagle/imports/${runId}/manifest/chunks`, { method: 'POST', body: { manifestVersion: 2, chunkKey: `items-${String(index).padStart(5, '0')}`, folders: [], tags: [], tagGroups: [], items: scan.items.slice(offset, offset + 100) } });
        progress('提交增量清单', Math.min(offset + 100, scan.items.length), scan.items.length);
      }
      const result = await api.request(`/eagle/imports/${runId}/preflight`, { method: 'POST' });
      log(`预检完成：需上传 ${result.uploadItemCount} 项，未变化 ${result.unchangedItemCount} 项。`);
    }
    if (['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(run.status)) {
      saveState({ activeRunId: null });
      throw new Error(`上次任务已经结束（${run.status}），请开始新的增量任务。`);
    }
    await uploadPending(runId, scan.sourceFiles);
    run = await api.request(`/eagle/imports/${runId}`);
    if (['COMPLETED', 'PARTIAL'].includes(run.status)) saveState({ activeRunId: null });
    progress(`导入${run.status === 'COMPLETED' ? '完成' : '结束：' + run.status}`, 1, 1);
    log(`任务 ${run.status}：已导入 ${run.importedItemCount}，跳过 ${run.skippedItemCount}，失败 ${run.failedItemCount}。`);
  } finally { setBusy(false); }
}

async function uploadPending(runId, sourceFiles) {
  let cursor = '';
  let completed = 0;
  do {
    const page = await api.request(`/eagle/imports/${runId}/items?status=STAGED&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const item of page.items) {
      assertActive();
      if (!['NEW', 'CONTENT_REPLACE'].includes(item.action)) continue;
      const source = sourceFiles.get(item.sourceItemId);
      if (!source) { log(`跳过无法读取的文件：${item.displayName}`); continue; }
      const session = await api.request(`/eagle/imports/${runId}/items/${item.id}/upload`, { method: 'POST' });
      const parts = await uploadFile(session, source);
      const finished = await api.request(`/eagle/uploads/${session.id}/complete`, { method: 'POST', body: { parts } });
      await api.request(`/eagle/imports/${runId}/items/${item.id}/finish`, { method: 'POST', body: { assetId: finished.assetId } });
      completed += 1; progress(`上传 ${item.displayName}`, completed, Math.max(1, page.items.length));
    }
    cursor = page.nextCursor || '';
  } while (cursor);
}

async function uploadFile(session, source) {
  const handle = await fsp.open(source.filePath, 'r');
  const parts = [];
  try {
    const partSize = session.partSizeBytes || session.partSize;
    const partCount = Math.ceil(source.size / partSize);
    for (let index = 0; index < partCount; index += 1) {
      assertActive();
      const partNumber = index + 1;
      const length = Math.min(partSize, source.size - index * partSize);
      const bytes = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(bytes, 0, length, index * partSize);
      const signed = await api.request(`/eagle/uploads/${session.id}/parts/${partNumber}`, { method: 'POST', body: {} });
      const response = await fetch(signed.uploadUrl, { method: 'PUT', body: bytes.subarray(0, bytesRead) });
      const etag = response.headers.get('etag');
      if (!response.ok || !etag) throw new Error(`上传分片 ${partNumber} 失败。`);
      parts.push({ partNumber, etag });
    }
  } finally { await handle.close(); }
  return parts;
}

function stableLibraryIdentity() {
  const state = readState();
  const identities = state.libraryIdentities || {};
  if (!identities[library.path]) { identities[library.path] = crypto.randomUUID(); saveState({ libraryIdentities: identities }); }
  return identities[library.path];
}
function sha256File(filePath) { return new Promise((resolve, reject) => { const hash = crypto.createHash('sha256'); const stream = fs.createReadStream(filePath); stream.on('data', (chunk) => hash.update(chunk)); stream.on('error', reject); stream.on('end', () => resolve(hash.digest('hex'))); }); }
function timestamp(value) { const number = value instanceof Date ? value.getTime() : Number(value); return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0; }
function mimeFor(extension) { return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', mov: 'video/quicktime', pdf: 'application/pdf' })[extension] || 'application/octet-stream'; }

async function initialize() {
  for (const id of ['badge','server','pat','connect','start','resume','cancel','libraryName','libraryPath','phase','percent','bar','log']) elements[id] = element(id);
  const info = typeof eagle.library.info === 'function' ? await eagle.library.info() : {};
  const libraryPath = eagle.library.path || info?.path || '';
  if (!libraryPath) throw new Error('请先在 Eagle 中打开图库。');
  library = { path: libraryPath, name: eagle.library.name || info?.name || path.basename(libraryPath).replace(/\.library$/i, '') };
  elements.libraryName.textContent = library.name; elements.libraryPath.textContent = library.path;
  elements.server.value = readState().server || 'http://localhost:8180';
  elements.resume.disabled = !readState().activeRunId;
  elements.connect.addEventListener('click', () => { void connect().catch((error) => log(`连接失败：${error.message}`)); });
  elements.start.addEventListener('click', () => { void startImport(false).catch((error) => log(`导入失败：${error.message}`)); });
  elements.resume.addEventListener('click', () => { void startImport(true).catch((error) => log(`继续失败：${error.message}`)); });
  elements.cancel.addEventListener('click', () => { cancelled = true; log('正在停止当前操作…'); });
}

if (typeof eagle !== 'undefined') eagle.onPluginCreate(() => void initialize().catch((error) => { document.body.textContent = `插件启动失败：${error.message}`; }));
