const summary = document.querySelector('#summary');
const jobs = document.querySelector('#jobs');
document
  .querySelector('#options')
  .addEventListener('click', () => chrome.runtime.openOptionsPage());

await render();

async function render() {
  const response = await chrome.runtime.sendMessage({ type: 'queue:summary' });
  if (!response?.ok) {
    summary.textContent = response?.error || '无法读取队列。';
    return;
  }
  summary.textContent = `待处理 ${response.pendingCount} · 失败 ${response.failedCount} · 已完成 ${response.completedCount}`;
  jobs.replaceChildren(
    ...response.jobs.slice(0, 8).map((job) => {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = job.metadata?.displayName || '未命名图片';
      const detail = document.createElement('span');
      detail.textContent = `${statusLabel(job.status)}${job.lastError ? ` · ${job.lastError}` : ''}`;
      item.append(title, detail);
      if (['FAILED', 'PAUSED_AUTH', 'WAITING_CONFIG'].includes(job.status)) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '重试';
        retry.addEventListener('click', async () => {
          await chrome.runtime.sendMessage({ type: 'queue:retry', id: job.id });
          await render();
        });
        item.append(retry);
      }
      return item;
    }),
  );
}

function statusLabel(value) {
  return (
    {
      PENDING: '等待下载',
      RETRY: '等待重试',
      FETCHING: '正在下载',
      UPLOADING: '正在上传',
      COMMITTING: '正在提交',
      COMPLETED: '已完成',
      FAILED: '失败',
      PAUSED_AUTH: '认证已暂停',
      WAITING_CONFIG: '等待配置',
    }[value] || value
  );
}
