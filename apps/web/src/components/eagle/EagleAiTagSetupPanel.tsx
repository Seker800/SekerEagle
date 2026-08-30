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
      setError(cause instanceof Error ? cause.message : '读取 AI 标签状态失败');
    }
  }, [applySettings]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!manualEnabled && !scheduleEnabled) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, 5_000);
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
      setError(cause instanceof Error ? cause.message : '保存运行设置失败');
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
      enabled ? '已启动，后台会在 10 秒内开始补充任务。' : '已停止领取新任务。',
    );
  };

  const toggleSchedule = () => {
    const enabled = !scheduleEnabled;
    setScheduleEnabled(enabled);
    void saveSettings(
      settingsInput({ scheduleEnabled: enabled }),
      'schedule',
      enabled ? '每日定时已开启。' : '每日定时已关闭。',
    );
  };

  const retryFailed = async () => {
    setPhase('retrying');
    setNotice('');
    setError('');
    try {
      const { retried } = await retryFailedEagleAiTags();
      setNotice(`已重新排队 ${retried} 个失败任务。`);
      void reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重试失败');
    } finally {
      setPhase('idle');
    }
  };

  const ollamaOnline = summary?.ollama.status === 'ONLINE';
  const ollamaLabel = ollamaOnline
    ? `Ollama 已就绪 · ${summary.ollama.model}`
    : summary?.ollama.status === 'MODEL_MISSING'
      ? `缺少模型 ${summary.ollama.model}`
      : 'Ollama 未运行';
  const statusLabel = manualEnabled
    ? '正在处理'
    : scheduleEnabled
      ? `等待 ${scheduleStart}–${scheduleEnd}`
      : '已停止';
  const manualButtonLabel =
    phase === 'starting'
      ? '正在启动…'
      : phase === 'stopping'
        ? '正在停止…'
        : manualEnabled
          ? '停止处理'
          : '开始处理';

  return (
    <section className={styles.panel} aria-label="AI 自动标签运行设置">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>搜索辅助</span>
          <h2>具体名词标签</h2>
          <p>每张图提取最多 10 个可见名词；精确标签优先，近义结果靠后。</p>
        </div>
        <span className={`${styles.status} ${manualEnabled ? styles.statusRunning : ''}`}>
          {statusLabel}
        </span>
      </header>

      <div className={styles.metrics} aria-label="处理统计">
        <div>
          <strong>{summary?.analyzed ?? '—'}</strong>
          <span>已分析</span>
        </div>
        <div>
          <strong>{summary?.queued ?? '—'}</strong>
          <span>待处理</span>
        </div>
        <div>
          <strong>{summary?.running ?? '—'}</strong>
          <span>运行中</span>
        </div>
        <div>
          <strong>{summary?.tags ?? '—'}</strong>
          <span>AI 标签</span>
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.primaryControl}>
          <div>
            <strong>立即处理未分析图片</strong>
            <small>启动后后台分批执行，可随时停止，不影响图库使用。</small>
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
              <strong>每日定时</strong>
              <small>北京时间，到点自动处理。</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="每日定时"
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
                开始时间
                <input
                  type="time"
                  value={scheduleStart}
                  disabled={phase !== 'idle'}
                  onChange={(event) => setScheduleStart(event.target.value)}
                />
              </label>
              <span>至</span>
              <label>
                结束时间
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
                onClick={() => void saveSettings(settingsInput(), 'schedule', '定时时段已保存。')}
              >
                保存
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <footer className={styles.footer}>
        <span className={ollamaOnline ? styles.online : styles.offline}>{ollamaLabel}</span>
        <span>
          {summary ? `${summary.analyzed} / ${summary.eligible} 张已分析` : '正在读取状态…'}
        </span>
        <button
          type="button"
          disabled={phase !== 'idle' || !summary?.failed || !ollamaOnline}
          onClick={() => void retryFailed()}
        >
          {phase === 'retrying'
            ? '正在重试…'
            : `重试失败任务${summary?.failed ? `（${summary.failed}）` : ''}`}
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
