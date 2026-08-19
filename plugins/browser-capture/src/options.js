import { normalizeServerUrl } from './api-client.js';

const form = document.querySelector('form');
const serverUrl = document.querySelector('#serverUrl');
const pat = document.querySelector('#pat');
const concurrency = document.querySelector('#concurrency');
const status = document.querySelector('#status');

const saved = await chrome.storage.local.get({
  serverUrl: 'http://localhost:8180',
  concurrency: 3,
});
serverUrl.value = saved.serverUrl;
concurrency.value = String(saved.concurrency);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = '';
  try {
    const normalizedServerUrl = normalizeServerUrl(serverUrl.value);
    const existing = await chrome.storage.local.get({ pat: '' });
    const nextPat = pat.value.trim() || existing.pat;
    if (!nextPat.startsWith('seg_pat_')) throw new Error('请输入具有 capture:write 权限的 PAT。');
    await chrome.storage.local.set({
      serverUrl: normalizedServerUrl,
      pat: nextPat,
      concurrency: Math.min(6, Math.max(1, Number(concurrency.value) || 3)),
    });
    pat.value = '';
    pat.placeholder = '已保存；留空表示不更换';
    status.textContent = '配置已安全保存，队列正在继续。';
    await chrome.runtime.sendMessage({ type: 'config:changed' });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '保存失败。';
  }
});
