import { t } from '../../i18n';
import { useCallback, useEffect, useState } from 'react';
import {
  fetchEagleAiTagSummary,
  retryFailedEagleAiTags,
  updateEagleAiTagSettings,
  type EagleAiTagSettings,
  type EagleAiTagSummary,
} from '../../lib/eagle-ai-tag-api';
import styles from './EagleAiTagSetupPanel.module.css';
type SavingPhase = 'idle' | 'starting' | 'stopping' | 'schedule' | 'retrying';
export function EagleAiTagSetupPanel() {
  const [summary, setSummary] = useState<EagleAiTagSummary | null>(null);
  const [phase, setPhase] = useState<SavingPhase>('idle');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [manualEnabled, setManualEnabled] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleStart, setScheduleStart] = useState('23:00');
  const [scheduleEnd, setScheduleEnd] = useState('06:00');
  const applySettings = useCallback((settings: EagleAiTagSettings) => {
    setManualEnabled(settings.manualEnabled);
    setScheduleEnabled(settings.scheduleEnabled);
    setScheduleStart(settings.scheduleStart);
    setScheduleEnd(settings.scheduleEnd);
  }, []);
  const reload = useCallback(async () => {
    try {
      const next = await fetchEagleAiTagSummary();
      setSummary(next);
      applySettings(next.settings);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('读取 AI 标签状态失败'));
    }
  }, [applySettings]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!manualEnabled && !scheduleEnabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [manualEnabled, reload, scheduleEnabled]);
  const settingsInput = (
    overrides: Partial<Omit<EagleAiTagSettings, 'timeZone'>> = {},
  ): Omit<EagleAiTagSettings, 'timeZone'> => ({
    manualEnabled,
    scheduleEnabled,
    scheduleStart,
    scheduleEnd,
    ...overrides,
  });
  const saveSettings = async (
    next: Omit<EagleAiTagSettings, 'timeZone'>,
    savingPhase: SavingPhase,
    success: string,
  ) => {
    setPhase(savingPhase);
    setNotice('');
    setError('');
    try {
      const result = await updateEagleAiTagSettings(next);
      applySettings(result);
      setSummary((current) => (current ? { ...current, settings: result } : current));
      setNotice(success);
    } catch (cause) {
      await reload();
      setError(cause instanceof Error ? cause.message : t('保存运行设置失败'));
    } finally {
      setPhase('idle');
    }
  };
  const toggleManual = () => {
    const enabled = !manualEnabled;
    setManualEnabled(enabled);
    void saveSettings(
      settingsInput({ manualEnabled: enabled }),
      enabled ? 'starting' : 'stopping',
      enabled ? t('已启动，后台会在 10 秒内开始补充任务。') : t('已停止领取新任务。'),
    );
  };
  const toggleSchedule = () => {
    const enabled = !scheduleEnabled;
    setScheduleEnabled(enabled);
    void saveSettings(
      settingsInput({ scheduleEnabled: enabled }),
      'schedule',
      enabled ? t('每日定时已开启。') : t('每日定时已关闭。'),
    );
  };
  const retryFailed = async () => {
    setPhase('retrying');
    setNotice('');
    setError('');
    try {
      const { retried } = await retryFailedEagleAiTags();
      setNotice(
        t('已重新排队 {{value1}} 个失败任务。', {
          value1: retried,
        }),
      );
      void reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('重试失败'));
    } finally {
      setPhase('idle');
    }
  };
  const ollamaOnline = summary?.ollama.status === 'ONLINE';
  const ollamaLabel = ollamaOnline
    ? t('Ollama 已就绪 · {{value1}}', {
        value1: summary.ollama.model,
      })
    : summary?.ollama.status === 'MODEL_MISSING'
      ? t('缺少模型 {{value1}}', {
          value1: summary.ollama.model,
        })
      : t('Ollama 未运行');
  const statusLabel = manualEnabled
    ? t('正在处理')
    : scheduleEnabled
      ? t('等待 {{value1}}–{{value2}}', {
          value1: scheduleStart,
          value2: scheduleEnd,
        })
      : t('已停止');
  const manualButtonLabel =
    phase === 'starting'
      ? t('正在启动…')
      : phase === 'stopping'
        ? t('正在停止…')
        : manualEnabled
          ? t('停止处理')
          : t('开始处理');
  return (
    <section className={styles.panel} aria-label={t('AI 自动标签运行设置')}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{t('搜索辅助')}</span>
          <h2>{t('具体名词标签')}</h2>
          <p>{t('每张图提取最多 10 个可见名词；精确标签优先，近义结果靠后。')}</p>
        </div>
        <span className={`${styles.status} ${manualEnabled ? styles.statusRunning : ''}`}>
          {statusLabel}
        </span>
      </header>

      <div className={styles.metrics} aria-label={t('处理统计')}>
        <div>
          <strong>{summary?.analyzed ?? '—'}</strong>
          <span>{t('已分析')}</span>
        </div>
        <div>
          <strong>{summary?.queued ?? '—'}</strong>
          <span>{t('待处理')}</span>
        </div>
        <div>
          <strong>{summary?.running ?? '—'}</strong>
          <span>{t('运行中')}</span>
        </div>
        <div>
          <strong>{summary?.tags ?? '—'}</strong>
          <span>{t('AI 标签')}</span>
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.primaryControl}>
          <div>
            <strong>{t('立即处理未分析图片')}</strong>
            <small>{t('启动后后台分批执行，可随时停止，不影响图库使用。')}</small>
          </div>
          <button
            type="button"
            className={manualEnabled ? styles.stopButton : styles.startButton}
            disabled={phase !== 'idle' || !ollamaOnline}
            onClick={toggleManual}
          >
            {manualButtonLabel}
          </button>
        </div>

        <div className={styles.scheduleControl}>
          <div className={styles.scheduleHeading}>
            <div>
              <strong>{t('每日定时')}</strong>
              <small>{t('北京时间，到点自动处理。')}</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-label={t('每日定时')}
              aria-checked={scheduleEnabled}
              className={styles.switch}
              disabled={phase !== 'idle' || !ollamaOnline}
              onClick={toggleSchedule}
            >
              <span />
            </button>
          </div>
          {scheduleEnabled ? (
            <div className={styles.timeSettings}>
              <label>
                {' ' + t('开始时间') + ' '}
                <input
                  type="time"
                  value={scheduleStart}
                  disabled={phase !== 'idle'}
                  onChange={(event) => setScheduleStart(event.target.value)}
                />
              </label>
              <span>{t('至')}</span>
              <label>
                {' ' + t('结束时间') + ' '}
                <input
                  type="time"
                  value={scheduleEnd}
                  disabled={phase !== 'idle'}
                  onChange={(event) => setScheduleEnd(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={phase !== 'idle'}
                onClick={() =>
                  void saveSettings(settingsInput(), 'schedule', t('定时时段已保存。'))
                }
              >
                {' ' + t('保存') + ' '}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <footer className={styles.footer}>
        <span className={ollamaOnline ? styles.online : styles.offline}>{ollamaLabel}</span>
        <span>
          {summary
            ? t('{{value1}} / {{value2}} 张已分析', {
                value1: summary.analyzed,
                value2: summary.eligible,
              })
            : t('正在读取状态…')}
        </span>
        <button
          type="button"
          disabled={phase !== 'idle' || !summary?.failed || !ollamaOnline}
          onClick={() => void retryFailed()}
        >
          {phase === 'retrying'
            ? t('正在重试…')
            : t('重试失败任务{{value1}}', {
                value1: summary?.failed ? `（${summary.failed}）` : '',
              })}
        </button>
      </footer>
      {notice ? (
        <div className={styles.notice} role="status">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
