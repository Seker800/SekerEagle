const bridge = window.sekerDesktop;
const form = document.querySelector('#connection-form');
const message = document.querySelector('#message');
const testButton = document.querySelector('#test');
const cancelButton = document.querySelector('#cancel');
const resetButton = document.querySelector('#reset');
const submitButton = form.querySelector('button[type="submit"]');

void load();

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void run(async () => render(await bridge.saveConnections(formValue())));
});
testButton.addEventListener('click', () => {
  void run(async () => render(await bridge.testConnections(formValue())));
});
cancelButton.addEventListener('click', () => void bridge.cancelConnectionManager());
resetButton.addEventListener('click', () => {
  if (!window.confirm('这会解除当前图库身份绑定。仅在这些地址确实属于另一套图库时继续。')) return;
  void run(async () => render(await bridge.resetDeploymentBinding()));
});

async function load() {
  await run(async () => {
    const state = await bridge.getConnectionManagerState();
    fill(state.settings);
    render(state);
  });
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

function setBusy(busy) {
  for (const element of form.elements) element.disabled = busy;
  submitButton.disabled = busy;
}
