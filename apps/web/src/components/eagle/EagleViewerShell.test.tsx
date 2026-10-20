import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EagleViewerShell } from './EagleViewerShell';

describe('EagleViewerShell', () => {
  it('locks scrolling, contains keyboard focus and restores the opener on close', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const view = render(
      <EagleViewerShell title="Photo" onClose={vi.fn()} actions={<button>Action</button>}>
        <div />
      </EagleViewerShell>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    const close = screen.getByRole('button', { name: '关闭' });
    const action = screen.getByRole('button', { name: 'Action' });
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(action).toHaveFocus();
    fireEvent.keyDown(action, { key: 'Tab' });
    expect(close).toHaveFocus();
    view.unmount();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
    opener.remove();
  });
  it('honors navigation boundaries and leaves editing keys to inputs', () => {
    const next = vi.fn(),
      close = vi.fn();
    render(
      <EagleViewerShell
        title="Photo"
        onClose={close}
        navigation={{ next, position: { current: 1, total: 2 } }}
      >
        <input aria-label="Caption" />
      </EagleViewerShell>,
    );
    expect(screen.getByRole('button', { name: '上一张' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
    expect(next).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowRight' });
    expect(next).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
