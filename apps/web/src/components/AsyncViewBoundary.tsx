import { Component, Suspense, type ReactNode } from 'react';
import { t } from '../i18n';

type Props = { children: ReactNode; onReload?: () => void };

/** A new index is required after a deployed lazy chunk expires. */
export class AsyncViewBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div role="alert">
          {t('界面加载失败，请刷新后重试。')}
          <button type="button" onClick={this.props.onReload ?? (() => window.location.reload())}>
            {t('刷新')}
          </button>
        </div>
      );
    return (
      <Suspense fallback={<div role="status">{t('正在加载界面…')}</div>}>
        {this.props.children}
      </Suspense>
    );
  }
}
