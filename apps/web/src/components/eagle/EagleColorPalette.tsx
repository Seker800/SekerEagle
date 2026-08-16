import styles from './EagleColorPalette.module.css';

export interface EagleColorAnalysisView {
  assetRevision: number;
  processorVersion: string;
  status: string;
  lastError: string | null;
  completedAt: string | null;
  swatches: Array<{
    rank: number;
    hex: string;
    weight: number;
    labL: number;
    labA: number;
    labB: number;
  }>;
}

export function EagleColorPalette({
  analysis,
  onSelectColor,
}: {
  analysis: EagleColorAnalysisView | null;
  onSelectColor?: (color: string) => void;
}) {
  if (!analysis || analysis.status === 'PENDING' || analysis.status === 'RUNNING') {
    return <span className={styles.status}>等待颜色分析</span>;
  }
  if (analysis.status === 'FAILED') {
    return (
      <span className={styles.error} title={analysis.lastError ?? undefined}>
        颜色分析失败
      </span>
    );
  }
  if (analysis.swatches.length === 0)
    return <span className={styles.status}>未提取到有效颜色</span>;
  return (
    <div className={styles.palette} aria-label="图像提取颜色">
      {analysis.swatches.map((swatch) => {
        const percentage = Math.round(swatch.weight * 100);
        const common = {
          className: styles.swatch,
          style: { backgroundColor: swatch.hex, flexGrow: Math.max(1, percentage) },
          'aria-label': `提取颜色 ${swatch.hex}，占比 ${percentage}%`,
          title: `${swatch.hex} · ${percentage}%`,
        };
        return onSelectColor ? (
          <button
            key={`${swatch.rank}-${swatch.hex}`}
            {...common}
            type="button"
            onClick={() => onSelectColor(swatch.hex)}
          />
        ) : (
          <span key={`${swatch.rank}-${swatch.hex}`} {...common} />
        );
      })}
    </div>
  );
}
