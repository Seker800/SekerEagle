import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EagleMobileChrome, EagleMobileNavigation } from './EagleMobileChrome';
import { EagleMobileMore } from './EagleMobileMore';
describe('reference mobile composition', () => {
  it('places mode switching and independent search below content, with only tools above', () => {
    const search = vi.fn();
    render(
      <EagleMobileChrome
        switcher={
          <select aria-label="图库模式">
            <option>相册</option>
          </select>
        }
        searchOpen={false}
        onSearch={search}
        tools={<button>图库选项</button>}
      >
        <p>gallery</p>
      </EagleMobileChrome>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '图库模式' })).toBeVisible();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox').closest('header')).toBeNull();
    expect(screen.getByRole('button', { name: '搜索' }).closest('header')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(search).toHaveBeenCalledOnce();
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更多' })).not.toBeInTheDocument();
  });
  it('removes photography-only destinations in material mode', () => {
    render(<EagleMobileNavigation mode="MATERIAL" active="tags" onNavigate={() => {}} />);
    expect(screen.queryByRole('button', { name: '地图' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '人物' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '素材' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '标签' }));
  });
  it('keeps photo map, people and more destinations selectable inside the menu', () => {
    const navigate = vi.fn();
    render(<EagleMobileNavigation mode="PHOTO" active="map" onNavigate={navigate} />);
    expect(screen.getByRole('button', { name: '地图' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: '人物' }));
    expect(navigate).toHaveBeenCalledWith('people');
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(navigate).toHaveBeenCalledWith('more');
    expect(screen.queryByRole('button', { name: '标签' })).not.toBeInTheDocument();
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
