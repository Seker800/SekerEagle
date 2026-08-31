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
    testAllConnections: '测试全部连接',
    saveAndConnect: '保存并连接',
    changeLibrary: '更换为另一套图库…',
    localStorage: '本机存储',
    cacheDescription: '常用缩略图、预览图和大图切片保存在本机，并按账号隔离。',
    cacheStatus: '缓存状态',
    allAccountsUsage: '全部账号占用',
    currentAccountUsage: '当前账号占用',
    cacheFiles: '缓存文件',
    hitRate: '命中率',
    trafficSaved: '已节省流量',
    diskAvailable: '磁盘剩余',
    cacheLimit: '缓存容量上限',
    cacheLimitDescription: '允许 1–100 GiB；达到上限后自动淘汰较少使用的文件。',
    saveCacheSettings: '保存缓存设置',
    clearCurrentAccountCache: '清空当前账号缓存',
    cacheDirectory: '缓存目录',
    openInFileManager: '在访达中打开',
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
  },
  'en-US': {
    pageTitle: 'SekerEagle Desktop Settings',
    settingsNavigation: 'Desktop settings navigation',
    desktopSettings: 'Desktop Settings',
    connection: 'Connection',
    localMediaCache: 'Local Media Cache',
    backToLibrary: 'Back to Library',
    savedOnComputer: 'Saved only on this computer',
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
    testAllConnections: 'Test All Connections',
    saveAndConnect: 'Save and Connect',
    changeLibrary: 'Connect to Another Library…',
    localStorage: 'Local Storage',
    cacheDescription:
      'Frequently used thumbnails, previews, and image tiles are cached locally and isolated by account.',
    cacheStatus: 'Cache status',
    allAccountsUsage: 'All accounts',
    currentAccountUsage: 'Current account',
    cacheFiles: 'Cached files',
    hitRate: 'Hit rate',
    trafficSaved: 'Bandwidth saved',
    diskAvailable: 'Disk available',
    cacheLimit: 'Cache capacity limit',
    cacheLimitDescription:
      'Choose 1–100 GiB. Less-used files are evicted automatically at the limit.',
    saveCacheSettings: 'Save Cache Settings',
    clearCurrentAccountCache: 'Clear Current Account Cache',
    cacheDirectory: 'Cache directory',
    openInFileManager: 'Open in File Manager',
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
  },
};
const form = document.querySelector('#connection-form');
const message = document.querySelector('#message');
const testButton = document.querySelector('#test');
const cancelButton = document.querySelector('#cancel');
const sidebarCancelButton = document.querySelector('#sidebar-cancel');
const resetButton = document.querySelector('#reset');
const submitButton = form.querySelector('button[type="submit"]');
const cacheForm = document.querySelector('#cache-form');
const cacheMessage = document.querySelector('#cache-message');
const saveCacheButton = document.querySelector('#save-cache');
const clearCacheButton = document.querySelector('#clear-cache');
const openCacheFolderButton = document.querySelector('#open-cache-folder');
const settingsNavigations = [...document.querySelectorAll('.nav-item[href]')];
let canClearCurrentAccount = false;

applyStaticTranslations();
activateSettingsSection(window.location.hash.slice(1));
void load();

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const settings = formValue();
  void run(async () => render(await bridge.saveConnections(settings)));
});
testButton.addEventListener('click', () => {
  const settings = formValue();
  void run(async () => render(await bridge.testConnections(settings)));
});
cancelButton.addEventListener('click', () => void bridge.cancelConnectionManager());
sidebarCancelButton.addEventListener('click', () => void bridge.cancelConnectionManager());
for (const navigation of settingsNavigations) {
  navigation.addEventListener('click', (event) => {
    event.preventDefault();
    const target = navigation.getAttribute('href').slice(1);
    window.location.hash = target;
    activateSettingsSection(target);
  });
}
window.addEventListener('hashchange', () => activateSettingsSection(window.location.hash.slice(1)));
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

async function loadCacheStatus() {
  const state = await bridge.getCacheManagerStatus();
  const account = state.currentAccountStats;
  document.querySelector('#cache-global-usage').textContent =
    `${formatBytes(state.globalAllocatedBytes)} / ${formatBytes(state.limitBytes)}`;
  document.querySelector('#cache-account-usage').textContent = account
    ? formatBytes(account.allocatedBytes)
    : tr('signedOut');
  document.querySelector('#cache-entry-count').textContent = (
    account?.entryCount ?? state.globalEntryCount
  ).toLocaleString(locale);
  document.querySelector('#cache-hit-rate').textContent = account
    ? `${Math.round((account.hitCount / Math.max(1, account.hitCount + account.missCount)) * 100)}%`
    : '—';
  document.querySelector('#cache-saved-bytes').textContent = account
    ? formatBytes(account.savedBytes)
    : '—';
  document.querySelector('#cache-free-space').textContent = formatBytes(state.availableBytes);
  document.querySelector('#cache-path').textContent = state.cachePath;
  cacheForm.elements.cacheLimitGiB.value = String(Math.round(state.limitBytes / 1024 ** 3));
  canClearCurrentAccount = Boolean(account);
  clearCacheButton.disabled = !canClearCurrentAccount;
}

function formValue() {
  const data = new FormData(form);
  return {
    mode: data.get('mode'),
    localUrl: data.get('localUrl'),
    lanUrl: data.get('lanUrl'),
    publicUrl: data.get('publicUrl'),
    allowInsecureLan: data.get('allowInsecureLan') === 'on',
  };
}

function fill(settings) {
  form.elements.mode.value = settings.mode;
  form.elements.localUrl.value = settings.localUrl;
  form.elements.lanUrl.value = settings.lanUrl;
  form.elements.publicUrl.value = settings.publicUrl;
  form.elements.allowInsecureLan.checked = settings.allowInsecureLan;
}

function render(state) {
  for (const slot of ['LOCAL', 'LAN', 'PUBLIC']) {
    const target = document.querySelector(`[data-status="${slot}"]`);
    const probe = state.probes.find((item) => item.slot === slot);
    target.textContent = probe ? probeLabel(probe) : connectionConfigured(state.settings, slot);
    target.dataset.state = probe?.state ?? 'IDLE';
  }
  cancelButton.hidden = !state.active;
  sidebarCancelButton.hidden = !state.active;
  resetButton.hidden = !state.settings.deploymentId;
  message.textContent = state.active
    ? tr('selectedConnection', {
        url: state.active.url,
        latency: Math.round(state.active.latencyMs),
      })
    : tr('noConnection');
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

function activateSettingsSection(requestedSection) {
  const sectionId =
    requestedSection === 'cache-settings' ? requestedSection : 'connection-settings';
  for (const navigation of settingsNavigations) {
    const isActive = navigation.getAttribute('href') === `#${sectionId}`;
    if (isActive) navigation.setAttribute('aria-current', 'page');
    else navigation.removeAttribute('aria-current');
  }
  for (const section of document.querySelectorAll('.settings-card')) {
    section.hidden = section.id !== sectionId;
  }
  document.querySelector('.settings-scroll').scrollTop = 0;
}

async function run(action) {
  setBusy(true);
  message.textContent = tr('testingConnections');
  try {
    await action();
  } catch (error) {
    message.textContent = localizedError(error, 'connectionFailed');
  } finally {
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
}

function setCacheBusy(busy) {
  for (const element of cacheForm.elements) element.disabled = busy;
  saveCacheButton.disabled = busy;
  clearCacheButton.disabled = busy || !canClearCurrentAccount;
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
