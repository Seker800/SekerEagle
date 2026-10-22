import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EagleMobileSearch } from './EagleMobileSearch';
beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
it('submits real suggestions and reopens history only for the same owner and mode', () => {
  const search = vi.fn();
  const view = render(
    <EagleMobileSearch
      scopeKey="a:PHOTO"
      suggestions={['猫', '山']}
      value=""
      onSearch={search}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '猫' }));
  expect(search).toHaveBeenCalledWith('猫');
  view.rerender(
    <EagleMobileSearch
      key="next"
      scopeKey="a:PHOTO"
      suggestions={[]}
      value=""
      onSearch={search}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: '搜索 猫' })).toBeVisible();
  view.rerender(
    <EagleMobileSearch
      key="other"
      scopeKey="a:MATERIAL"
      suggestions={[]}
      value=""
      onSearch={search}
      onClose={vi.fn()}
    />,
  );
  expect(screen.queryByRole('button', { name: '搜索 猫' })).toBeNull();
});
it('does not persist private search terms and lets the user clear history', () => {
  const props = { suggestions: [], value: '', onSearch: vi.fn(), onClose: vi.fn() };
  const view = render(<EagleMobileSearch scopeKey="private" {...props} persist={false} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '秘密' } });
  fireEvent.submit(screen.getByRole('searchbox').closest('form')!);
  expect(localStorage.length).toBe(0);
  view.rerender(<EagleMobileSearch key="public" scopeKey="public" {...props} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '山' } });
  fireEvent.submit(screen.getByRole('searchbox').closest('form')!);
  fireEvent.click(screen.getByRole('button', { name: '清空搜索历史' }));
  expect(screen.queryByRole('button', { name: '搜索 山' })).toBeNull();
});
