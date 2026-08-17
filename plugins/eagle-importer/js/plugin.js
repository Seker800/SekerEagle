'use strict';

const path = require('node:path');

let ApiClient;
let scanEagleLibrary;
let ImportEngine;
let isImportPausedError;
let StateStore;
let ConnectionSupervisor;
let NightlySyncScheduler;
let formatBytes;
let randomId;

const ui = {};
let store;
let api;
let engine;
let currentScan;
let currentRunId = '';
let busy = false;
let connected = false;
let initialized = false;
let initializing = false;
let currentLibrary = { name: '', path: '' };
let connectionSupervisor;
let syncScheduler;
let lastConnectionError = '';
let sessionPat = '';

function normalizePluginPath(pluginPath) {
  let normalized = String(pluginPath || '');
  if (process.platform === 'win32')
    normalized = normalized.replace(/^[\\/]+(?=[A-Za-z]:[\\/])/, '');
  return path.resolve(normalized);
}

function loadDependencies(pluginPath) {
  const jsPath = path.join(normalizePluginPath(pluginPath), 'js');
  ({ ApiClient } = require(path.join(jsPath, 'api-client.js')));
  ({ scanEagleLibrary } = require(path.join(jsPath, 'eagle-source.js')));
  ({ ImportEngine, isImportPausedError } = require(path.join(jsPath, 'import-engine.js')));
  ({ StateStore } = require(path.join(jsPath, 'state-store.js')));
  ({ ConnectionSupervisor, NightlySyncScheduler } = require(path.join(jsPath, 'automation.js')));
  ({ formatBytes, randomId } = require(path.join(jsPath, 'utils.js')));
}

function element(id) {
  return document.getElementById(id);
}
function log(message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  ui.log.textContent += `[${time}] ${message}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
}
function setProgress(label, current = 0, total = 1) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
  ui.progressLabel.textContent = label;
  ui.progressPercent.textContent = `${Math.round(ratio * 100)}%`;
  ui.progressBar.style.width = `${ratio * 100}%`;
}
function engineProgress(value) {
  const labels = { stage: '提交清单', upload: '上传文件' };
  setProgress(labels[value.phase] || value.phase, value.current, value.total);
}
function setConnected(value) {
  connected = value;
  ui.connectionBadge.textContent = value ? '已连接' : '未连接';
  ui.connectionBadge.classList.toggle('connected', value);
  ui.prepareButton.disabled = !value || busy;
  ui.refreshLibrariesButton.disabled = !value || busy;
  ui.libraryBinding.disabled = !value || busy;
}
function setBusy(value) {
  busy = value;
  ui.connectButton.disabled = value;
  ui.prepareButton.disabled = value || !connected;
  ui.refreshLibrariesButton.disabled = value || !connected;
  ui.libraryBinding.disabled = value || !connected;
  ui.autoReconnect.disabled = value;
  ui.autoSyncEnabled.disabled = value;
  ui.autoSyncTime.disabled = value || !ui.autoSyncEnabled.checked;
  ui.pauseButton.disabled = !value || !currentRunId;
  ui.cancelButton.disabled = !value || !currentRunId;
  if (value) {
    ui.uploadButton.disabled = true;
    ui.resumeButton.disabled = true;
  }
}
function showError(error, prefix = '失败') {
  console.error(error);
  const message = error?.message || String(error);
  const details = prefix === '启动错误' && error?.stack ? error.stack : message;
  const logElement = ui.log || element('log');
  const progressElement = ui.progressLabel || element('progressLabel');
  if (logElement) {
    logElement.textContent += `[${prefix}] ${details}\n`;
    logElement.scrollTop = logElement.scrollHeight;
  }
  if (progressElement)
    progressElement.textContent = prefix === '启动错误' ? '插件启动失败' : '发生错误';
}
function showStartupError(error) {
  showError(error, '启动错误');
}
function asConnectionError(error) {
  if (error?.status === 404 && /Eagle 导入任务不存在/.test(error.message || '')) {
    return new Error('当前服务器尚未部署 Eagle 增量导入 v2 API，请先更新 NAS 后端。');
  }
  return error;
}
function bindElements() {
  for (const id of [
    'connectionBadge',
    'serverUrl',
    'pat',
    'connectButton',
    'libraryName',
    'libraryPath',
    'autoReconnect',
    'autoSyncEnabled',
    'autoSyncTime',
    'autoSyncStatus',
    'libraryBinding',
    'refreshLibrariesButton',
    'prepareButton',
    'uploadButton',
    'resumeButton',
    'pauseButton',
    'cancelButton',
    'summaryCard',
    'summaryTitle',
    'summaryGrid',
    'runStatus',
    'progressLabel',
    'progressPercent',
    'progressBar',
    'log',
  ])
    ui[id] = element(id);
}

async function readCurrentLibrary() {
  const info = typeof eagle.library.info === 'function' ? await eagle.library.info() : {};
  const libraryPath = eagle.library.path || info?.path || '';
  if (!libraryPath) throw new Error('Eagle 未提供当前图库路径，请确认已打开图库。');
  const fallbackName = path.basename(libraryPath).replace(/\.library$/i, '');
  currentLibrary = {
    name: eagle.library.name || info?.name || fallbackName,
    path: libraryPath,
  };
  return currentLibrary;
}

function createApi() {
  api = new ApiClient({
    baseUrl: ui.serverUrl.value,
    accessToken: sessionPat,
  });
  engine = new ImportEngine({ api, store, log, progress: engineProgress });
}

function canReconnect() {
  return Boolean(store.state.serverUrl && sessionPat);
}

async function restoreConnection() {
  if (!canReconnect()) throw new Error('没有可用于自动重连的登录状态。');
  if (busy && connected) return;
  if (!api) createApi();
  await refreshLibraries();
}

function configureConnectionSupervisor() {
  if (connectionSupervisor) connectionSupervisor.stop();
  connectionSupervisor = new ConnectionSupervisor({
    connect: restoreConnection,
    onStateChange: async ({ connected: nextConnected, error }) => {
      setConnected(nextConnected);
      if (nextConnected) {
        if (lastConnectionError) log('连接已恢复。');
        lastConnectionError = '';
        ui.resumeButton.disabled = !store.state.activeRun?.runId || busy;
        return;
      }
      const message = asConnectionError(error)?.message || String(error);
      if (message !== lastConnectionError) log(`连接中断，等待自动重连：${message}`);
      lastConnectionError = message;
      if (error?.status === 401) {
        sessionPat = '';
        if (api) api.accessToken = '';
        connectionSupervisor.stop();
        log('PAT 已失效，请重新连接。');
      }
    },
  });
  if (store.state.autoReconnect && canReconnect()) void connectionSupervisor.start();
}

function renderAutoSyncSchedule(date) {
  if (!store.state.autoSyncEnabled) {
    ui.autoSyncStatus.textContent = '深夜同步未启用';
    return;
  }
  if (!date) {
    ui.autoSyncStatus.textContent = '正在计算下次同步时间…';
    return;
  }
  ui.autoSyncStatus.textContent = `下次同步：${date.toLocaleString('zh-CN', { hour12: false })}`;
}

function configureSyncScheduler() {
  if (syncScheduler) syncScheduler.stop();
  syncScheduler = new NightlySyncScheduler({
    getConfig: () => ({ enabled: store.state.autoSyncEnabled, time: store.state.autoSyncTime }),
    getState: () => store.state,
    saveState: (patch) => store.save(patch),
    run: automaticSync,
    onSchedule: renderAutoSyncSchedule,
    onResult: ({ ok, error }) => {
      if (ok) log('深夜自动同步完成。');
      else if (!error) log('深夜自动同步已暂停，将在下次定时时间继续。');
      else log(`深夜自动同步失败，将在执行窗口内重试：${error?.message || String(error)}`);
    },
  });
  void syncScheduler.start();
}

async function refreshLibraries() {
  const response = await api.listLibraries();
  const libraryPath = path.resolve(currentLibrary.path);
  const selected = store.state.libraryBindings[libraryPath] || '';
  ui.libraryBinding.innerHTML = '<option value="">为当前图库创建稳定身份</option>';
  for (const library of response.libraries || []) {
    const option = document.createElement('option');
    option.value = library.externalLibraryId;
    option.textContent = `${library.displayName} · ${library.assetCount} 项`;
    option.selected = library.externalLibraryId === selected;
    ui.libraryBinding.appendChild(option);
  }
}

async function connect() {
  if (connectionSupervisor) connectionSupervisor.stop();
  setBusy(true);
  try {
    const pat = ui.pat.value.trim();
    if (!pat.startsWith('se_pat_')) throw new Error('请输入独立 SekerEagle PAT。');
    sessionPat = pat;
    createApi();
    await api.request('/auth/me');
    await store.save({
      serverUrl: ui.serverUrl.value.trim(),
    });
    await refreshLibraries();
    setConnected(true);
    ui.resumeButton.disabled = !store.state.activeRun?.runId;
    log('连接成功，已读取服务端图库。');
    configureConnectionSupervisor();
  } catch (error) {
    if (error?.status === 401) {
      sessionPat = '';
      if (api) api.accessToken = '';
    }
    setConnected(false);
    showError(asConnectionError(error));
    if (store.state.autoReconnect && canReconnect()) configureConnectionSupervisor();
  } finally {
    setBusy(false);
  }
}

function resolveExternalLibraryId(libraryPath) {
  return ui.libraryBinding.value || store.state.libraryBindings[libraryPath] || randomId();
}

async function scanLibrary() {
  const libraryPath = path.resolve(currentLibrary.path);
  if (currentScan?.dispose) await currentScan.dispose();
  const workspace = await store.createScanWorkspace();
  try {
    currentScan = await scanEagleLibrary({
      eagleApi: eagle,
      hashCacheStore: store.hashCache,
      workspace,
      cancelled: () => engine?.cancelRequested,
      onProgress: ({ phase, current, total }) =>
        setProgress(phase === 'hash' ? '计算内容指纹' : '读取 Eagle 素材', current, total || 1),
    });
  } catch (error) {
    await workspace.dispose();
    currentScan = null;
    throw error;
  }
  const externalLibraryId = resolveExternalLibraryId(libraryPath);
  await store.save({
    libraryBindings: { ...store.state.libraryBindings, [libraryPath]: externalLibraryId },
  });
  return externalLibraryId;
}

function renderSummary(preflight) {
  ui.summaryCard.classList.remove('hidden');
  ui.summaryTitle.textContent = `${preflight.itemCount} 项 · ${formatBytes(preflight.byteSize)}`;
  ui.runStatus.textContent = preflight.status;
  const values = [
    ['新增', preflight.newItemCount],
    ['内容替换', preflight.contentReplaceItemCount],
    ['仅元数据', preflight.metadataUpdateItemCount],
    ['未变化', preflight.unchangedItemCount],
    ['需上传', preflight.uploadItemCount],
    ['上传体积', formatBytes(preflight.uploadByteSize)],
    ['不支持', preflight.skippedUnsupportedItemCount],
    ['警告', preflight.warningCount],
  ];
  ui.summaryGrid.innerHTML = '';
  for (const [label, value] of values) {
    const metric = document.createElement('div');
    metric.className = 'metric';
    const strong = document.createElement('strong');
    strong.textContent = value;
    const span = document.createElement('span');
    span.textContent = label;
    metric.append(strong, span);
    ui.summaryGrid.appendChild(metric);
  }
}

async function prepareRun() {
  engine.cancelRequested = false;
  log('开始扫描当前图库；未变化文件将复用本地 SHA-256 缓存。');
  const externalLibraryId = await scanLibrary();
  if (currentScan.unreadableItemCount > 0) {
    for (const item of currentScan.unreadableItems) {
      log(`[警告] 已跳过无法读取的素材：${item.name || item.sourceItemId}（${item.code}）`);
    }
    const hiddenCount = currentScan.unreadableItemCount - currentScan.unreadableItems.length;
    if (hiddenCount > 0) log(`[警告] 另有 ${hiddenCount} 项无法读取，已省略明细。`);
    log(`[警告] 共 ${currentScan.unreadableItemCount} 项将在下次扫描时重试，不会阻断本次同步。`);
  }
  if (currentScan.mergedTagCount > 0) {
    for (const detail of currentScan.mergedTagDetails) {
      log(`[警告] 已合并重复标签：${detail.names.join(' / ')} → ${detail.selectedName}`);
    }
    const hiddenCount = currentScan.mergedTagCount - currentScan.mergedTagDetails.length;
    if (hiddenCount > 0) log(`[警告] 另有 ${hiddenCount} 个重复标签变体，已省略明细。`);
    log(`[警告] 共合并 ${currentScan.mergedTagCount} 个标签变体，不会阻断本次同步。`);
  }
  if (currentScan.dataWarningCount > 0) {
    for (const warning of currentScan.dataWarnings) log(`[警告] ${warning}`);
    const hiddenCount = currentScan.dataWarningCount - currentScan.dataWarnings.length;
    if (hiddenCount > 0) log(`[警告] 另有 ${hiddenCount} 项元数据异常，已省略明细。`);
    log(`[警告] 共修正或跳过 ${currentScan.dataWarningCount} 项异常元数据，不会阻断本次同步。`);
  }
  log(`扫描完成：${currentScan.itemCount} 项，${formatBytes(currentScan.byteSize)}。`);
  const result = await engine.prepare(currentScan, externalLibraryId);
  currentRunId = result.run.id;
  ui.pauseButton.disabled = !busy;
  ui.cancelButton.disabled = !busy;
  renderSummary(result.preflight);
  ui.uploadButton.disabled = result.preflight.uploadItemCount === 0;
  ui.resumeButton.disabled = true;
  setProgress('预检完成，等待确认上传', 1, 1);
  log(`预检完成：需要上传 ${result.preflight.uploadItemCount} 项。`);
  return result;
}

async function prepare() {
  if (!connected) {
    showError(new Error('请先连接并完成服务端兼容性检查。'));
    return;
  }
  setBusy(true);
  try {
    await prepareRun();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
    ui.cancelButton.disabled = true;
  }
}

async function uploadRun() {
  if (!currentRunId || !currentScan) return;
  const run = await engine.upload(currentRunId, currentScan.sourceFiles);
  ui.runStatus.textContent = run.status;
  setProgress(`任务 ${run.status}`, 1, 1);
  log(
    `任务结束：${run.status}，成功 ${run.importedItemCount}，跳过 ${run.skippedItemCount}，失败 ${run.failedItemCount}。`,
  );
  return run;
}

async function upload() {
  let paused = false;
  setBusy(true);
  try {
    await uploadRun();
  } catch (error) {
    paused = handlePaused(error);
    if (!paused) showError(error);
  } finally {
    setBusy(false);
    ui.cancelButton.disabled = true;
    ui.uploadButton.disabled = true;
    ui.resumeButton.disabled = paused ? !connected : true;
  }
}

async function resumeRun() {
  const active = store.state.activeRun;
  if (!active?.runId) return;
  if (path.resolve(currentLibrary.path) !== path.resolve(active.libraryPath))
    throw new Error('请先打开该任务对应的 Eagle 图库。');
  currentRunId = active.runId;
  engine.cancelRequested = false;
  const externalLibraryId = await scanLibrary();
  const existingRun = await api.getRun(currentRunId);
  if (existingRun.status === 'DRAFT') {
    log(`继续提交任务 ${currentRunId} 的清单。`);
    const prepared = await engine.resumePreparation(currentRunId, currentScan, externalLibraryId);
    renderSummary(prepared.preflight);
    if (prepared.preflight.uploadItemCount === 0) {
      setProgress('没有需要上传的文件', 1, 1);
      return;
    }
  }
  log(`继续任务 ${currentRunId}；将先查询服务端已上传分片。`);
  const run = await engine.upload(currentRunId, currentScan.sourceFiles);
  setProgress(`任务 ${run.status}`, 1, 1);
  log(`恢复任务结束：${run.status}。`);
  return run;
}

async function resume() {
  let paused = false;
  setBusy(true);
  try {
    await resumeRun();
  } catch (error) {
    paused = handlePaused(error);
    if (!paused) showError(error);
  } finally {
    setBusy(false);
    ui.cancelButton.disabled = true;
    ui.resumeButton.disabled = paused ? !connected : true;
  }
}

function handlePaused(error) {
  if (!isImportPausedError(error)) return false;
  ui.runStatus.textContent = '已暂停';
  setProgress('同步已安全暂停，可手动继续或等待下次定时同步', 0, 1);
  log('同步已暂停；服务端任务和已上传分片均已保留。');
  return true;
}

async function automaticSync() {
  let paused = false;
  if (busy) throw new Error('已有导入任务正在执行。');
  if (!connected) {
    const restored = connectionSupervisor && (await connectionSupervisor.checkNow());
    if (!restored) throw new Error('服务器尚未恢复连接。');
  }
  setBusy(true);
  try {
    log('深夜自动同步开始。');
    if (store.state.activeRun?.runId) {
      await resumeRun();
      return;
    }
    const prepared = await prepareRun();
    if (prepared.preflight.uploadItemCount > 0) await uploadRun();
    else setProgress('图库已是最新状态', 1, 1);
  } catch (error) {
    paused = handlePaused(error);
    throw error;
  } finally {
    setBusy(false);
    ui.cancelButton.disabled = true;
    ui.uploadButton.disabled = true;
    if (paused) ui.resumeButton.disabled = !connected;
  }
}

async function pause() {
  const activeRun = store.state.activeRun;
  if (!busy || !currentRunId || !activeRun?.runId) return;
  engine.pauseLocally();
  ui.pauseButton.disabled = true;
  setProgress('正在安全暂停…', 0, 1);
  log('已请求暂停；当前网络请求结束后将停止领取新分片。');
  await store.save({ activeRun: { ...activeRun, phase: 'PAUSED' } });
}

async function cancel() {
  if (!currentRunId) return;
  engine.cancelLocally();
  try {
    await engine.cancelRun(currentRunId);
    log('服务端导入任务已取消。');
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
    currentRunId = '';
  }
}

async function initialize(pluginPath) {
  if (initialized || initializing) return;
  initializing = true;
  try {
    loadDependencies(pluginPath);
    bindElements();
    const userDataPath = eagle.app.userDataPath || (await eagle.app.getPath('userData'));
    if (!userDataPath) throw new Error('Eagle 未提供用户数据目录。');
    store = new StateStore(userDataPath);
    await store.load();
    if (store.loadWarning) log(`[警告] ${store.loadWarning}`);
    await readCurrentLibrary();
    ui.serverUrl.value = store.state.serverUrl || 'http://localhost:8180';
    ui.pat.value = '';
    ui.autoReconnect.checked = store.state.autoReconnect !== false;
    ui.autoSyncEnabled.checked = store.state.autoSyncEnabled === true;
    ui.autoSyncTime.value = store.state.autoSyncTime || '03:00';
    ui.autoSyncTime.disabled = !ui.autoSyncEnabled.checked;
    ui.libraryName.textContent = currentLibrary.name;
    ui.libraryPath.textContent = currentLibrary.path;
    setConnected(false);
    ui.connectButton.addEventListener('click', connect);
    ui.autoReconnect.addEventListener('change', () => {
      store
        .save({ autoReconnect: ui.autoReconnect.checked })
        .then(configureConnectionSupervisor)
        .catch(showError);
    });
    ui.autoSyncEnabled.addEventListener('change', () => {
      ui.autoSyncTime.disabled = !ui.autoSyncEnabled.checked;
      store
        .save({ autoSyncEnabled: ui.autoSyncEnabled.checked })
        .then(() => syncScheduler.reschedule())
        .catch(showError);
    });
    ui.autoSyncTime.addEventListener('change', () => {
      store
        .save({ autoSyncTime: ui.autoSyncTime.value || '03:00' })
        .then(() => syncScheduler.reschedule())
        .catch(showError);
    });
    ui.refreshLibrariesButton.addEventListener('click', () => refreshLibraries().catch(showError));
    ui.prepareButton.addEventListener('click', prepare);
    ui.uploadButton.addEventListener('click', upload);
    ui.resumeButton.addEventListener('click', resume);
    ui.pauseButton.addEventListener('click', () => pause().catch(showError));
    ui.cancelButton.addEventListener('click', cancel);
    ui.libraryBinding.addEventListener('change', async () => {
      const libraryPath = path.resolve(currentLibrary.path);
      const id = ui.libraryBinding.value || randomId();
      await store.save({ libraryBindings: { ...store.state.libraryBindings, [libraryPath]: id } });
    });

    configureConnectionSupervisor();
    configureSyncScheduler();
    if (store.state.activeRun?.runId) {
      currentRunId = store.state.activeRun.runId;
      ui.resumeButton.disabled = !connected;
      log(`发现未结束任务：${currentRunId}`);
    }
    initialized = true;
  } finally {
    initializing = false;
  }
}

eagle.onPluginCreate((plugin) => initialize(plugin.path).catch(showStartupError));
eagle.onLibraryChanged(() => window.location.reload());
eagle.onPluginBeforeExit(() => {
  if (engine) engine.cancelLocally();
  if (connectionSupervisor) connectionSupervisor.stop();
  if (syncScheduler) syncScheduler.stop();
  if (currentScan?.dispose) void currentScan.dispose();
});
