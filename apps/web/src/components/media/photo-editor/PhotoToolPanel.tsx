import type { ReactNode } from 'react';
import styles from './PhotoEditor.module.css';

/** Keep every editing tool in the same order: inspector, navigation, options. */
export function PhotoToolPanel({
  inspector,
  children,
}: {
  inspector: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.toolPanel}>
      <div className={styles.parameterInspector}>{inspector}</div>
      {children}
    </div>
  );
}
