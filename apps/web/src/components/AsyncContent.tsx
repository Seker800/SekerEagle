import { Component, Suspense, type ReactNode } from 'react';
import { t } from '../i18n';

class ContentErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert">
          <p>{t('界面加载失败，请重新加载。')}</p>
          <button type="button" onClick={() => window.location.reload()}>
            {t('重新加载')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** A failed import is cached by React.lazy; a fresh document retries the module graph. */
export function AsyncContent({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  return (
    <ContentErrorBoundary>
      <Suspense fallback={fallback}>{children}</Suspense>
    </ContentErrorBoundary>
  );
}
