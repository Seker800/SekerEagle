import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EagleAssetActionMenu } from './EagleAssetActionMenu';

it('escapes the caller panel so generic panel button styles cannot turn its dismiss surface opaque', () => {
  const close = vi.fn();
  render(
    <section data-testid="clipping-panel">
      <EagleAssetActionMenu position={{ x: 20, y: 20 }} count={2} onClose={close}>
        <button type="button" role="menuitem">
          发送到素材
        </button>
        <button type="button" role="menuitem">
          移入回收站
        </button>
      </EagleAssetActionMenu>
    </section>,
  );
  const menu = screen.getByRole('menu');
  expect(screen.getByTestId('clipping-panel')).not.toContainElement(menu);
  expect(screen.getByTestId('clipping-panel')).not.toContainElement(
    screen.getByRole('button', { name: '关闭素材操作菜单' }),
  );
  expect(screen.getByRole('menuitem', { name: '发送到素材' })).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: '移入回收站' })).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(1);
});
