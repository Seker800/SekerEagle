import { useEffect, useState } from 'react';
import { getLocale, t } from '../../i18n';
import { request } from '../../lib/api-client';
import styles from './BackupPanel.module.css';

interface BackupStatus {
  configured: boolean;
  target: string | null;
  status: 'never' | 'running' | 'succeeded' | 'failed';
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextScheduledAt: string | null;
  overdue: boolean;
}

function date(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat(getLocale(), {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Shanghai',
      }).format(new Date(value))
    : t('尚无记录');
}

export function BackupPanel() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void request<BackupStatus>('/api/backup/status')
        .then((value) => {
          if (!cancelled) {
            setStatus(value);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  const labels = {
    never: t('尚未成功备份'),
    running: t('正在备份'),
    succeeded: t('备份成功'),
    failed: t('最近一次备份失败'),
  };
  return (
    <section className="account-panel" aria-label={t('备份')}>
      <div className="panel-heading">
        <div>
          <h2>{t('完整数据备份')}</h2>
          <p>{t('每两周周六凌晨 01:00（北京时间），保留最近一次成功副本。')}</p>
        </div>
      </div>
      {failed ? <p role="alert">{t('暂时无法读取备份状态，请稍后重试。')}</p> : null}
      {!status && !failed ? <p role="status">{t('正在读取备份状态…')}</p> : null}
      {status ? (
        <>
          <p
            className={
              status.status === 'failed' || status.overdue ? styles.warning : styles.status
            }
            role="status"
          >
            {status.configured ? labels[status.status] : t('尚未配置自动备份')}
          </p>
          {status.overdue ? (
            <p className={styles.warning}>{t('备份已超期，请检查运行电脑和群晖连接。')}</p>
          ) : null}
          <dl className={styles.details}>
            <dt>{t('最后成功备份')}</dt>
            <dd>{date(status.lastSuccessAt)}</dd>
            <dt>{t('最近执行时间')}</dt>
            <dd>{date(status.lastAttemptAt)}</dd>
            <dt>{t('下次计划备份')}</dt>
            <dd>{date(status.nextScheduledAt)}</dd>
            <dt>{t('备份目标')}</dt>
            <dd>{status.target ?? t('尚无记录')}</dd>
          </dl>
          <p className={styles.note}>
            {t('电脑未运行时将在恢复运行后补做。备份期间图库暂时不可用。')}
          </p>
        </>
      ) : null}
    </section>
  );
}
