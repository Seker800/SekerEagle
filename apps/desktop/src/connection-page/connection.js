const bridge = window.sekerDesktop;
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
  if (!window.confirm('这会解除当前图库身份绑定。仅在这些地址确实属于另一套图库时继续。')) return;
  void run(async () => render(await bridge.resetDeploymentBinding()));
});
cacheForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const limitGiB = Number(cacheForm.elements.cacheLimitGiB.value);
  void runCache(async () => {
    await bridge.setCacheLimitGiB(limitGiB);
    await loadCacheStatus();
    cacheMessage.textContent = '缓存容量设置已保存。';
  });
});
clearCacheButton.addEventListener('click', () => {
  if (!window.confirm('确定清空当前账号的本地媒体缓存吗？')) return;
  void runCache(async () => {
    const result = await bridge.clearCache();
    await loadCacheStatus();
    cacheMessage.textContent = `已清理 ${result.deleted.toLocaleString('zh-CN')} 个缓存文件${result.deferred ? `，另有 ${result.deferred.toLocaleString('zh-CN')} 个文件将在使用结束后清理` : ''}。`;
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
    : '未登录';
  document.querySelector('#cache-entry-count').textContent = (
    account?.entryCount ?? state.globalEntryCount
  ).toLocaleString('zh-CN');
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
    ? `已选择 ${state.active.url}（${Math.round(state.active.latencyMs)}ms）`
    : '当前没有可用连接，请检查地址、服务器状态和可信来源配置。';
}

function probeLabel(probe) {
  const labels = {
    AVAILABLE: `可用 · ${Math.round(probe.latencyMs)}ms`,
    UNREACHABLE: '无法连接',
    UNTRUSTED: '来源未受信任',
    INCOMPATIBLE: '版本不兼容',
    DIFFERENT_DEPLOYMENT: '另一套图库',
  };
  return labels[probe.state] ?? '检测失败';
}

function connectionConfigured(settings, slot) {
  const key = slot === 'LOCAL' ? 'localUrl' : slot === 'LAN' ? 'lanUrl' : 'publicUrl';
  return settings[key] ? '未检测' : '未配置';
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
  message.textContent = '正在检测连接…';
  try {
    await action();
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : '连接设置失败。';
  } finally {
    setBusy(false);
  }
}

async function runCache(action) {
  setCacheBusy(true);
  cacheMessage.textContent = '正在读取缓存状态…';
  try {
    await action();
    if (cacheMessage.textContent === '正在读取缓存状态…') cacheMessage.textContent = '';
  } catch (error) {
    cacheMessage.textContent = error instanceof Error ? error.message : '缓存设置失败。';
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
