const bridge = window.sekerDesktop;
const locale = normalizeLocale(new window.URLSearchParams(window.location.search).get('lang'));
const messages = {
  'zh-CN': {
    pageTitle: 'SekerEagle 桌面设置',
    settingsNavigation: '桌面设置导航',
    desktopSettings: '桌面设置',
    connection: '连接',
    localMediaCache: '本地媒体缓存',
    backToLibrary: '返回图库',
    savedOnComputer: '仅保存在这台电脑上',
    cacheKicker: 'Local cache / 本地媒体缓存',
    cacheConsoleTitle: '缓存',
    cacheConsoleAccent: '控制台',
    cacheHitLongLabel: '长期命中率',
    cacheOrbitLabel: '长期 / 本机',
    cacheLimitShort: '上限',
    diskAvailable: '磁盘剩余',
    ofCap: '占上限 {{percent}}',
    fullyOffline: '完全免网',
    cacheConsoleControl: '控制',
    controlHint: '仅本机 · 不改服务端素材',
    longTermHintShort: '跨重启累计',
    connectionStatsHintShort: '本次启动后',
    hitRingLabel: '本机命中率 {{percent}}',
    connectionAndStorage: '连接与本机存储',
    connectionAndStorageDescription: '管理素材库连接与本地媒体缓存，不会改变服务端素材。',
    library: '素材库',
    automaticModeDescription: '自动模式优先保留当前连接；不可用时按本地、局域网、外网顺序选择。',
    connectionMode: '连接模式',
    automatic: '自动选择',
    fixedLocal: '固定本地',
    fixedLan: '固定局域网',
    fixedPublic: '固定外网',
    local: '本地',
    lan: '局域网',
    publicNetwork: '外网',
    notTested: '未检测',
    notConfigured: '未配置',
    allowPrivateHttp: '允许私有 IP 使用 HTTP（仅可信局域网）',
    allowPublicHttp: '允许外网使用 HTTP（危险：登录信息、Cookie 和图片将明文传输）',
    testAllConnections: '测试全部连接',
    saveAndConnect: '保存并连接',
    changeLibrary: '更换为另一套图库…',
    localStorage: '本机存储',
    allAccountsUsage: '这台电脑全部缓存',
    currentAccountUsage: '当前账号占用',
    cacheFiles: '缓存文件',
    memoryReuseNote: '已在内存中的缩略图直接显示，不计入上面的读取次数。',
    revalidated: '联网确认',
    cacheMisses: '联网下载',
    coalesced: '同批等待',
    cacheErrors: '读取失败',
    cacheLimit: '缓存容量上限',
    cacheLimitDescription: '允许 1–100 GiB；达到上限后自动淘汰较少使用的文件。',
    clearCurrentAccountCache: '清空当前账号缓存',
    cacheDirectory: '缓存目录',
    resetConfirm: '这会解除当前图库身份绑定。仅在这些地址确实属于另一套图库时继续。',
    cacheSettingsSaved: '缓存容量设置已保存。',
    clearCacheConfirm: '确定清空当前账号的本地媒体缓存吗？',
    cacheCleared: '已清理 {{deleted}} 个缓存文件{{deferred}}。',
    deferredCleanup: '，另有 {{count}} 个文件将在使用结束后清理',
    signedOut: '未登录',
    selectedConnection: '已选择 {{url}}（{{latency}}ms）',
    noConnection: '当前没有可用连接，请检查地址、服务器状态和可信来源配置。',
    available: '可用 · {{latency}}ms',
    unreachable: '无法连接',
    untrusted: '来源未受信任',
    incompatible: '版本不兼容',
    differentDeployment: '另一套图库',
    probeFailed: '检测失败',
    testingConnections: '正在检测连接…',
    connectionFailed: '连接设置失败。',
    readingCache: '正在读取缓存状态…',
    cacheFailed: '缓存设置失败。',
    cannotConnect: '无法连接素材库',
    autoRetryDescription: '正在自动重试。连接恢复后会自动打开图库。',
    retryNow: '立即重试',
    checkConnectionSettings: '检查连接设置',
    connected: '已连接素材库',
    connectionSettings: '连接设置',
    connectionSettingsHint: '更改地址或查看连接问题',
    cacheHeroDescription:
      '本地、局域网、外网共用一套缓存。长期命中、存储占用和本次读取，全部在这台机器上完成。',
    longTermStats: '长期使用',
    longTermHint: '跨重启累计，从当前缓存空间建立后开始。',
    longTermHitRate: '本机命中率',
    longTermHitRateHint: '从本机读取的比例',
    longTermSaved: '累计免下载',
    longTermSavedHint: '图片正文总量',
    connectionStats: '本次连接',
    connectionStatsHint: '只统计本次打开客户端后，重启归零。',
    localDirect: '本地直读',
    connectionSaved: '本次免下载',
    cacheHelp: '这些数字是什么？',
    cacheHelpHit:
      '本机命中率：长期从本机读取图片内容的比例，包含联网确认后复用，不等同于完全免网。',
    cacheHelpSaved: '累计免下载：长期从本机读取的图片正文总量，不是网页总流量。',
    cacheHelpConnection:
      '本次连接：只统计本次打开客户端后的读取，重启归零；完全免网只计算本地直读。',
    cacheHelpGlobal: '这台电脑全部缓存：包含其他账号和旧地址键缓存，无法按账号拆分。',
    cacheHelpPersistence:
      '缓存不会按时间过期：只有达到容量上限、清理旧版缓存或手动清空时才会移除。',
    cachePersistenceNote: '缓存不按时间过期；只有达到容量上限或手动清理时才会移除。',
    legacyCacheTitle: '旧版缓存',
    legacyCacheHint: '{{size}} 无法复用；清理只删除缓存，不影响原图。',
    legacyCacheEmpty: '没有可清理的旧版缓存。',
    clearLegacyCache: '清理旧版缓存',
    clearLegacyCacheConfirm:
      '清理这台电脑上不属于当前缓存空间的旧版/其他账号缓存？只删除缓存，不影响原图或服务器素材。',
    legacyCacheCleared: '已清理 {{deleted}} 个旧版缓存文件{{deferred}}。',
    cacheLimitLabel: '容量',
    saveCache: '保存',
    openCacheFolder: '打开缓存文件夹',
    clearCacheHint: '清空后，本机缓存的图片需要重新下载。',
    usedOfLimit: '已用',
    cacheMaintenance: '维护',
    legendCurrent: '当前账号',
    legendOther: '其他或旧缓存',
    averageSize: '平均 {{value}}',
    noReadsYet: '暂无图片读取',
    longTermEmpty: '还没有长期数据',
    noCacheYet: '尚无缓存',
    globalMeterLabel: '当前账号 {{account}}，其他或旧缓存 {{other}}',
    connectionMeterLabel:
      '本地 {{local}}，联网确认 {{revalidated}}，联网下载 {{network}}，同批等待 {{shared}}，失败 {{failed}}',
  },
  'en-US': {
    pageTitle: 'SekerEagle Desktop Settings',
    settingsNavigation: 'Desktop settings navigation',
    desktopSettings: 'Desktop Settings',
    connection: 'Connection',
    localMediaCache: 'Local Media Cache',
    backToLibrary: 'Back to Library',
    savedOnComputer: 'LOCAL STORAGE ONLY',
    cacheKicker: 'LOCAL CACHE / MEDIA',
    cacheConsoleTitle: 'Cache',
    cacheConsoleAccent: 'Console',
    cacheHitLongLabel: 'LONG-TERM HIT RATE',
    cacheOrbitLabel: 'LONG-TERM / LOCAL',
    cacheLimitShort: 'CAP',
    diskAvailable: 'Disk free',
    ofCap: '{{percent}} of cap',
    fullyOffline: 'Fully offline',
    cacheConsoleControl: 'Control',
    controlHint: 'LOCAL ONLY · NEVER TOUCHES SERVER ASSETS',
    longTermHintShort: 'Across restarts',
    connectionStatsHintShort: 'Since launch',
    hitRingLabel: 'Cache hit rate {{percent}}',
    connectionAndStorage: 'Connection and Local Storage',
    connectionAndStorageDescription:
      'Manage library connections and local media cache without changing server assets.',
    library: 'Library',
    automaticModeDescription:
      'Automatic mode keeps the current connection when possible, then tries local, LAN, and public endpoints.',
    connectionMode: 'Connection mode',
    automatic: 'Automatic',
    fixedLocal: 'Local only',
    fixedLan: 'LAN only',
    fixedPublic: 'Public only',
    local: 'Local',
    lan: 'LAN',
    publicNetwork: 'Public',
    notTested: 'Not tested',
    notConfigured: 'Not configured',
    allowPrivateHttp: 'Allow HTTP for private IPs (trusted LANs only)',
    allowPublicHttp:
      'Allow HTTP on public networks (danger: credentials, cookies, and images are sent in cleartext)',
    testAllConnections: 'Test All Connections',
    saveAndConnect: 'Save and Connect',
    changeLibrary: 'Connect to Another Library…',
    localStorage: 'Local Storage',
    allAccountsUsage: 'All cache on this computer',
    currentAccountUsage: 'Current account',
    cacheFiles: 'Cached files',
    memoryReuseNote:
      'Thumbnails already in memory display immediately and are not included in the read counts above.',
    revalidated: 'Online confirmed',
    cacheMisses: 'Downloaded',
    coalesced: 'Shared download',
    cacheErrors: 'Failed reads',
    cacheLimit: 'Cache capacity limit',
    cacheLimitDescription:
      'Choose 1–100 GiB. Less-used files are evicted automatically at the limit.',
    clearCurrentAccountCache: 'Clear Current Account Cache',
    cacheDirectory: 'Cache directory',
    resetConfirm:
      'This removes the current library identity binding. Continue only if these addresses belong to another library.',
    cacheSettingsSaved: 'Cache capacity saved.',
    clearCacheConfirm: 'Clear the local media cache for the current account?',
    cacheCleared: 'Cleared {{deleted}} cache files{{deferred}}.',
    deferredCleanup: '; {{count}} more will be removed after they are no longer in use',
    signedOut: 'Not signed in',
    selectedConnection: 'Connected to {{url}} ({{latency}} ms)',
    noConnection:
      'No connection is available. Check the addresses, server status, and trusted origin settings.',
    available: 'Available · {{latency}} ms',
    unreachable: 'Unreachable',
    untrusted: 'Origin not trusted',
    incompatible: 'Incompatible version',
    differentDeployment: 'Different library',
    probeFailed: 'Test failed',
    testingConnections: 'Testing connections…',
    connectionFailed: 'Connection settings failed.',
    readingCache: 'Reading cache status…',
    cacheFailed: 'Cache settings failed.',
    cannotConnect: 'Cannot connect to the library',
    autoRetryDescription:
      'Retrying automatically. The library will open when the connection returns.',
    retryNow: 'Retry now',
    checkConnectionSettings: 'Check connection settings',
    connected: 'Connected to the library',
    connectionSettings: 'Connection settings',
    connectionSettingsHint: 'Change addresses or inspect connection problems',
    cacheHeroDescription:
      'Common images stay on this computer; local, LAN and public entries share one cache.',
    longTermStats: 'Long-term use',
    longTermHint: 'Accumulated across restarts, starting when this cache space was created.',
    longTermHitRate: 'Local hit rate',
    longTermHitRateHint: 'Served from this computer',
    longTermSaved: 'Bytes avoided',
    longTermSavedHint: 'Image bodies from disk',
    connectionStats: 'This connection',
    connectionStatsHint: 'Counts since the client opened; reset on restart.',
    localDirect: 'Local reads',
    connectionSaved: 'Avoided this connection',
    cacheHelp: 'What do these numbers mean?',
    cacheHelpHit:
      'Local hit rate: the long-term share of image reads served from this computer, including online confirmation; it is not a fully-offline rate.',
    cacheHelpSaved:
      'Bytes avoided: long-term image bodies read from this computer, not total page traffic.',
    cacheHelpConnection:
      'This connection: counts since the client opened; reset on restart. Fully offline counts local reads only.',
    cacheHelpGlobal:
      'All cache on this computer includes other accounts and old address-keyed cache; it cannot be split by account.',
    cacheHelpPersistence:
      'Cache does not expire with time: it is removed only at the capacity limit, when clearing legacy cache, or when cleared manually.',
    cachePersistenceNote:
      'Cache does not expire with time; it is removed only at the capacity limit or when cleared manually.',
    legacyCacheTitle: 'Legacy cache',
    legacyCacheHint: '{{size}} cannot be reused; clearing only removes cache, not originals.',
    legacyCacheEmpty: 'No legacy cache to clear.',
    clearLegacyCache: 'Clear legacy cache',
    clearLegacyCacheConfirm:
      'Clear legacy or other-account cache outside the current cache space? Only cache is removed; originals and server assets are untouched.',
    legacyCacheCleared: 'Cleared {{deleted}} legacy cache files{{deferred}}.',
    cacheLimitLabel: 'Limit',
    saveCache: 'Save',
    openCacheFolder: 'Open cache folder',
    clearCacheHint: 'Cleared images will be downloaded again when needed.',
    usedOfLimit: 'used',
    cacheMaintenance: 'Maintenance',
    legendCurrent: 'Current account',
    legendOther: 'Other or legacy',
    averageSize: '{{value}} average',
    noReadsYet: 'No reads yet',
    longTermEmpty: 'No long-term data yet',
    noCacheYet: 'No cache yet',
    globalMeterLabel: 'Current account {{account}}, other or legacy {{other}}',
    connectionMeterLabel:
      'Local {{local}}, online confirmed {{revalidated}}, network {{network}}, shared {{shared}}, failed {{failed}}',
  },
};
const form = document.querySelector('#connection-form');
const message = document.querySelector('#message');
const testButton = document.querySelector('#test');
const cancelButton = document.querySelector('#cancel');
const resetButton = document.querySelector('#reset');
const submitButton = form.querySelector('button[type="submit"]');
const cacheForm = document.querySelector('#cache-form');
const cacheMessage = document.querySelector('#cache-message');
const saveCacheButton = document.querySelector('#save-cache');
const clearCacheButton = document.querySelector('#clear-cache');
const clearLegacyCacheButton = document.querySelector('#clear-legacy-cache');
const openCacheFolderButton = document.querySelector('#open-cache-folder');
const retryButton = document.querySelector('#retry');
const connectionDetails = document.querySelector('#connection-details');
let canClearCurrentAccount = false;
let canClearLegacy = false;
let retryPromise = null;
let connectionBusy = false;

applyStaticTranslations();
void load();
window.setInterval(() => {
  if (!document.querySelector('#offline-view').hidden) {
    void retryConnection();
  }
}, 5000);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const settings = formValue();
  void run(async () => render(await bridge.saveConnections(settings)));
});
testButton.addEventListener('click', () => {
  const settings = formValue();
  void run(async () => renderProbes(await bridge.testConnections(settings)));
});
cancelButton.addEventListener('click', () => void bridge.cancelConnectionManager());
document.querySelector('#show-connection-settings').addEventListener('click', () => {
  connectionDetails.open = true;
  connectionDetails.scrollIntoView({ behavior: 'smooth' });
});
retryButton.addEventListener('click', () => void retryConnection());
window.addEventListener('online', () => void retryConnection());
resetButton.addEventListener('click', () => {
  if (!window.confirm(tr('resetConfirm'))) return;
  void run(async () => render(await bridge.resetDeploymentBinding()));
});
cacheForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const limitGiB = Number(cacheForm.elements.cacheLimitGiB.value);
  void runCache(async () => {
    await bridge.setCacheLimitGiB(limitGiB);
    await loadCacheStatus();
    cacheMessage.textContent = tr('cacheSettingsSaved');
  });
});
clearCacheButton.addEventListener('click', () => {
  if (!window.confirm(tr('clearCacheConfirm'))) return;
  void runCache(async () => {
    const result = await bridge.clearCache();
    await loadCacheStatus();
    cacheMessage.textContent = tr('cacheCleared', {
      deleted: result.deleted.toLocaleString(locale),
      deferred: result.deferred
        ? tr('deferredCleanup', { count: result.deferred.toLocaleString(locale) })
        : '',
    });
  });
});
clearLegacyCacheButton.addEventListener('click', () => {
  if (!window.confirm(tr('clearLegacyCacheConfirm'))) return;
  void runCache(async () => {
    const result = await bridge.clearLegacyCache();
    await loadCacheStatus();
    cacheMessage.textContent = tr('legacyCacheCleared', {
      deleted: result.deleted.toLocaleString(locale),
      deferred: result.deferred
        ? tr('deferredCleanup', { count: result.deferred.toLocaleString(locale) })
        : '',
    });
  });
});
openCacheFolderButton.addEventListener('click', () => {
  void runCache(async () => bridge.openCacheFolder());
});

async function load() {
  await Promise.all([
    run(async () => {
      const state = await bridge.getConnectionManagerState();
      fill(state.settings);
      render(state);
    }),
    runCache(loadCacheStatus),
  ]);
}

async function retryConnection() {
  if (retryPromise || connectionBusy || document.querySelector('#offline-view').hidden) return;
  retryButton.disabled = true;
  retryPromise = bridge.retryConnections();
  try {
    render(await retryPromise);
  } catch (error) {
    message.textContent = localizedError(error, 'connectionFailed');
  } finally {
    retryPromise = null;
    retryButton.disabled = false;
  }
}

async function loadCacheStatus() {
  const state = await bridge.getCacheManagerStatus();
  const account = state.currentAccountStats;
  const requests = account?.requests;
  const globalBytes = state.globalAllocatedBytes;
  const accountBytes = account?.allocatedBytes ?? 0;
  const otherBytes = Math.max(0, globalBytes - accountBytes);
  const accountShare = globalBytes > 0 ? accountBytes / globalBytes : 0;
  const otherShare = globalBytes > 0 ? otherBytes / globalBytes : 0;
  const longAttempts = account ? account.hitCount + account.missCount : 0;
  const longHitRate = account && longAttempts > 0 ? account.hitCount / longAttempts : null;
  const totalReads = requests
    ? requests.localHitCount +
      requests.revalidatedHitCount +
      requests.missCount +
      requests.coalescedCount +
      requests.errorCount
    : 0;
  const maxCount = requests
    ? Math.max(
        requests.localHitCount,
        requests.revalidatedHitCount,
        requests.missCount,
        requests.coalescedCount,
        requests.errorCount,
      )
    : 0;

  setText('cache-account-usage', account ? formatBytes(accountBytes) : tr('signedOut'));
  setText('cache-global-usage', `${formatBytes(globalBytes)} / ${formatBytes(state.limitBytes)}`);
  const globalShare = state.limitBytes > 0 ? globalBytes / state.limitBytes : 0;
  setText('cache-global-percent', tr('ofCap', { percent: formatPercent(globalShare) }));
  setMeter('cache-meter-account', accountShare);
  setMeter('cache-meter-other', otherShare);
  setText('cache-legend-account', account && globalBytes > 0 ? formatPercent(accountShare) : '—');
  setText('cache-legend-other', account && globalBytes > 0 ? formatPercent(otherShare) : '—');
  const hitLabel = longHitRate === null ? '—' : formatPercent(longHitRate);
  setText('cache-long-hit-rate', hitLabel);
  setText('cache-hit-rate-core', hitLabel);
  setRing('cache-hit-ring', longHitRate ?? 0, 703.7);
  document
    .querySelector('#cache-ring-svg')
    .setAttribute('aria-label', tr('hitRingLabel', { percent: hitLabel }));
  setMeter('cache-long-hit-bar', longHitRate ?? 0);
  setText('cache-long-saved', account ? formatBytes(account.savedBytes) : '—');
  setText(
    'cache-entry-count',
    (account?.entryCount ?? state.globalEntryCount).toLocaleString(locale),
  );
  setText(
    'cache-average-size',
    account && account.entryCount > 0
      ? tr('averageSize', { value: formatBytes(account.allocatedBytes / account.entryCount) })
      : '—',
  );
  setText('cache-free-space', formatBytes(state.availableBytes));
  setText('cache-capacity', formatBytes(state.limitBytes));

  for (const [id, counter] of [
    ['cache-hit-rate', 'localHitCount'],
    ['cache-revalidated', 'revalidatedHitCount'],
    ['cache-misses', 'missCount'],
    ['cache-coalesced', 'coalescedCount'],
    ['cache-errors', 'errorCount'],
  ]) {
    setText(id, requests ? requests[counter].toLocaleString(locale) : '—');
  }
  const localRate = totalReads > 0 ? requests.localHitCount / totalReads : 0;
  setText('cache-offline-rate', totalReads > 0 ? formatPercent(localRate) : '—');
  setText('cache-offline-note', totalReads > 0 ? '' : tr('noReadsYet'));
  setEq('cache-eq-local', requests?.localHitCount ?? 0, maxCount);
  setEq('cache-eq-revalidated', requests?.revalidatedHitCount ?? 0, maxCount);
  setEq('cache-eq-misses', requests?.missCount ?? 0, maxCount);
  setEq('cache-eq-coalesced', requests?.coalescedCount ?? 0, maxCount);
  setEq('cache-eq-errors', requests?.errorCount ?? 0, maxCount);
  setText('cache-saved-bytes', requests ? formatBytes(requests.savedBytes) : '—');

  document.querySelector('#cache-composition-bar').setAttribute(
    'aria-label',
    tr('globalMeterLabel', {
      account: formatBytes(accountBytes),
      other: formatBytes(otherBytes),
    }),
  );
  document.querySelector('#cache-eq').setAttribute(
    'aria-label',
    tr('connectionMeterLabel', {
      local: requests?.localHitCount ?? 0,
      revalidated: requests?.revalidatedHitCount ?? 0,
      network: requests?.missCount ?? 0,
      shared: requests?.coalescedCount ?? 0,
      failed: requests?.errorCount ?? 0,
    }),
  );
  setText(
    'cache-legacy-hint',
    account
      ? otherBytes > 0
        ? tr('legacyCacheHint', { size: formatBytes(otherBytes) })
        : tr('legacyCacheEmpty')
      : tr('signedOut'),
  );
  canClearLegacy = Boolean(account) && otherBytes > 0;
  clearLegacyCacheButton.disabled = !canClearLegacy;
  setText('cache-path', state.cachePath);
  cacheForm.elements.cacheLimitGiB.value = String(Math.round(state.limitBytes / 1024 ** 3));
  canClearCurrentAccount = Boolean(account);
  clearCacheButton.disabled = !canClearCurrentAccount;
}

function setText(id, value) {
  document.querySelector(`#${id}`).textContent = value;
}

function setMeter(id, ratio) {
  document.querySelector(`#${id}`).style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

function setRing(id, ratio, circumference) {
  document
    .querySelector(`#${id}`)
    .setAttribute(
      'stroke-dashoffset',
      String(circumference * (1 - Math.max(0, Math.min(1, ratio)))),
    );
}

function setEq(id, count, maxCount) {
  const height = count > 0 && maxCount > 0 ? Math.max(6, Math.round((count / maxCount) * 60)) : 3;
  document.querySelector(`#${id}`).style.height = `${height}px`;
}

function formatPercent(ratio) {
  return `${Math.round(ratio * 100)}%`;
}

function formValue() {
  const data = new FormData(form);
  return {
    mode: data.get('mode'),
    localUrl: data.get('localUrl'),
    lanUrl: data.get('lanUrl'),
    publicUrl: data.get('publicUrl'),
    allowInsecureLan: data.get('allowInsecureLan') === 'on',
    allowInsecurePublicHttp: data.get('allowInsecurePublicHttp') === 'on',
  };
}

function fill(settings) {
  form.elements.mode.value = settings.mode;
  form.elements.localUrl.value = settings.localUrl;
  form.elements.lanUrl.value = settings.lanUrl;
  form.elements.publicUrl.value = settings.publicUrl;
  form.elements.allowInsecureLan.checked = settings.allowInsecureLan;
  form.elements.allowInsecurePublicHttp.checked = settings.allowInsecurePublicHttp;
}

function render(state) {
  renderProbes(state);
  cancelButton.hidden = !state.active;
  document.querySelector('#offline-view').hidden = Boolean(state.active);
  document.querySelector('#online-view').hidden = !state.active;
  document.querySelector('#cache-settings').hidden = !state.active;
  document.querySelector('#active-connection').textContent = state.active?.url ?? '—';
  resetButton.hidden = !state.settings.deploymentId;
  message.textContent = '';
}

function renderProbes(state) {
  for (const slot of ['LOCAL', 'LAN', 'PUBLIC']) {
    const target = document.querySelector(`[data-status="${slot}"]`);
    const probe = state.probes.find((item) => item.slot === slot);
    target.textContent = probe ? probeLabel(probe) : connectionConfigured(state.settings, slot);
    target.dataset.state = probe?.state ?? 'IDLE';
  }
}

function probeLabel(probe) {
  const labels = {
    AVAILABLE: tr('available', { latency: Math.round(probe.latencyMs) }),
    UNREACHABLE: tr('unreachable'),
    UNTRUSTED: tr('untrusted'),
    INCOMPATIBLE: tr('incompatible'),
    DIFFERENT_DEPLOYMENT: tr('differentDeployment'),
  };
  return labels[probe.state] ?? tr('probeFailed');
}

function connectionConfigured(settings, slot) {
  const key = slot === 'LOCAL' ? 'localUrl' : slot === 'LAN' ? 'lanUrl' : 'publicUrl';
  return settings[key] ? tr('notTested') : tr('notConfigured');
}

async function run(action) {
  if (retryPromise) await retryPromise.catch(() => undefined);
  connectionBusy = true;
  setBusy(true);
  message.textContent = tr('testingConnections');
  try {
    await action();
    if (message.textContent === tr('testingConnections')) message.textContent = '';
  } catch (error) {
    message.textContent = localizedError(error, 'connectionFailed');
  } finally {
    connectionBusy = false;
    setBusy(false);
  }
}

async function runCache(action) {
  setCacheBusy(true);
  cacheMessage.textContent = tr('readingCache');
  try {
    await action();
    if (cacheMessage.textContent === tr('readingCache')) cacheMessage.textContent = '';
  } catch (error) {
    cacheMessage.textContent = localizedError(error, 'cacheFailed');
  } finally {
    setCacheBusy(false);
  }
}

function setBusy(busy) {
  for (const element of form.elements) element.disabled = busy;
  submitButton.disabled = busy;
  retryButton.disabled = busy || Boolean(retryPromise);
}

function setCacheBusy(busy) {
  for (const element of cacheForm.elements) element.disabled = busy;
  saveCacheButton.disabled = busy;
  clearCacheButton.disabled = busy || !canClearCurrentAccount;
  clearLegacyCacheButton.disabled = busy || !canClearLegacy;
  openCacheFolderButton.disabled = busy;
}

function formatBytes(bytes) {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

function normalizeLocale(value) {
  return typeof value === 'string' && value.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
}

function tr(key, values = {}) {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
    messages[locale][key],
  );
}

function applyStaticTranslations() {
  document.documentElement.lang = locale;
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = tr(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', tr(element.dataset.i18nAriaLabel));
  }
}

function localizedError(error, fallbackKey) {
  return locale === 'zh-CN' && error instanceof Error ? error.message : tr(fallbackKey);
}
