export function jobTimestamp(job) {
  if (job.status === 'COMPLETED' && Number.isFinite(job.completedAt)) return job.completedAt;
  return Number.isFinite(job.updatedAt) ? job.updatedAt : job.createdAt;
}

export function relativeTime(timestamp, now = Date.now()) {
  const elapsed = Math.max(0, now - Number(timestamp || now));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function exactTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

export function retrySchedule(job, now = Date.now()) {
  if (job.status !== 'RETRY' || !Number.isFinite(job.nextAttemptAt)) return '';
  const remaining = job.nextAttemptAt - now;
  if (remaining <= 60_000) return '即将自动重试';
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return `预计 ${minutes} 分钟后重试`;
  return `预计 ${Math.ceil(minutes / 60)} 小时后重试`;
}

export function failureStageLabel(stage) {
  return (
    {
      SOURCE_DOWNLOAD: '源图下载失败',
      SERVER_CONNECT: '服务器连接失败',
      UPLOAD: '媒体上传失败',
      COMMIT: '上传提交失败',
      CONFIG: '配置检查失败',
    }[stage] || ''
  );
}
