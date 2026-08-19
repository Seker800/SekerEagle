import { buildServerCandidates, normalizeServerUrl } from './connection-config.js';

const form = document.querySelector('form');
const connectionMode = document.querySelector('#connectionMode');
const localServerUrl = document.querySelector('#localServerUrl');
const publicServerUrl = document.querySelector('#publicServerUrl');
const pat = document.querySelector('#pat');
const concurrency = document.querySelector('#concurrency');
const status = document.querySelector('#status');

const saved = await chrome.storage.local.get({
  connectionMode: 'auto',
  localServerUrl: '',
  publicServerUrl: '',
  serverUrl: 'http://localhost:8180',
  concurrency: 3,
});
connectionMode.value = saved.connectionMode;
localServerUrl.value = saved.localServerUrl || saved.serverUrl;
publicServerUrl.value = saved.publicServerUrl;
concurrency.value = String(saved.concurrency);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = '';
  try {
    const nextConfig = {
      connectionMode: connectionMode.value,
      localServerUrl: localServerUrl.value.trim() ? normalizeServerUrl(localServerUrl.value) : '',
      publicServerUrl: publicServerUrl.value.trim()
        ? normalizeServerUrl(publicServerUrl.value)
        : '',
    };
    buildServerCandidates(nextConfig);
    const existing = await chrome.storage.local.get({ pat: '' });
    const nextPat = pat.value.trim() || existing.pat;
    if (!nextPat.startsWith('seg_pat_')) throw new Error('请输入具有 capture:write 权限的 PAT。');
    await chrome.storage.local.set({
      ...nextConfig,
      pat: nextPat,
      concurrency: Math.min(6, Math.max(1, Number(concurrency.value) || 3)),
    });
    await chrome.storage.local.remove('serverUrl');
    pat.value = '';
    pat.placeholder = '已保存；留空表示不更换';
    status.textContent = '配置已安全保存，队列正在继续。';
    await chrome.runtime.sendMessage({ type: 'config:changed' });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '保存失败。';
  }
});
