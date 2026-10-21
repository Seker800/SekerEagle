import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EagleMobileChrome } from './EagleMobileChrome';
import { EagleMobileMore } from './EagleMobileMore';
describe('reference mobile composition', () => {
  it('shows only the switch, search and tools above the content, with photo destinations below', () => {
    const navigate = vi.fn();
    const search = vi.fn();
    render(
      <EagleMobileChrome
        mode="PHOTO"
        switcher={
          <select aria-label="图库模式">
            <option>相册</option>
          </select>
        }
        searchOpen={false}
        onSearch={search}
        tools={<button>图库选项</button>}
        active="timeline"
        onNavigate={navigate}
      >
        <p>gallery</p>
      </EagleMobileChrome>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '图库模式' })).toBeVisible();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(search).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '地图' }));
    expect(navigate).toHaveBeenCalledWith('map');
    expect(screen.getByRole('button', { name: '照片' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '人物' })).toBeVisible();
  });
  it('removes photography-only destinations in material mode', () => {
    render(
      <EagleMobileChrome
        mode="MATERIAL"
        switcher={null}
        searchOpen={false}
        onSearch={() => {}}
        tools={null}
        active="more"
        onNavigate={() => {}}
      >
        <p>gallery</p>
      </EagleMobileChrome>,
    );
    expect(screen.queryByRole('button', { name: '地图' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '人物' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '素材' })).toBeVisible();
  });
  it('puts identity before the four more actions and disables native file operations in browsers', () => {
    const logout = vi.fn();
    const settings = vi.fn();
    render(
      <EagleMobileMore
        email="test@example.invalid"
        origin="http://localhost:42319"
        native={false}
        onSettings={settings}
        onLogout={logout}
      />,
    );
    expect(screen.getByText('test@example.invalid')).toBeVisible();
    expect(screen.getByText('http://localhost:42319')).toBeVisible();
    expect(screen.getByRole('button', { name: /备份/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /释放空间/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(settings).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '退出' }));
    expect(logout).toHaveBeenCalledOnce();
  });
  it('native navigation opens screens only and cannot carry deletion commands', () => {
    render(
      <EagleMobileMore
        email="test@example.invalid"
        origin="http://localhost:42319"
        native
        onSettings={() => {}}
        onLogout={() => {}}
      />,
    );
    expect(screen.getByRole('link', { name: /备份/ })).toHaveAttribute('href', '/_native/backup');
    expect(screen.getByRole('link', { name: /释放空间/ })).toHaveAttribute(
      'href',
      '/_native/cleanup',
    );
  });
});
