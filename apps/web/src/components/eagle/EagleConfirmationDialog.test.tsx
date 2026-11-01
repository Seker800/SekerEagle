import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EagleConfirmationDialog } from './EagleConfirmationDialog';
import { EagleTrashConfirmation } from './EagleTrashConfirmation';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

it('links title/description, focuses safe action and restores the connected initiating control', () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const cancelled = vi.fn(),
    outerCancel = vi.fn();
  const view = render(
    <dialog open onCancel={outerCancel}>
      <EagleConfirmationDialog
        title="Delete selection"
        description={<p>Recoverable until trash is emptied</p>}
        onCancel={cancelled}
        actions={
          <>
            <button>Keep reviewing</button>
            <button>Move to trash</button>
          </>
        }
      />
    </dialog>,
  );
  const modal = screen.getByRole('alertdialog', { name: 'Delete selection' });
  expect(modal).toHaveAccessibleDescription('Recoverable until trash is emptied');
  expect(within(modal).getByRole('button', { name: 'Keep reviewing' })).toHaveFocus();
  const cancel = new Event('cancel', { bubbles: true, cancelable: true });
  fireEvent(modal, cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(cancelled).toHaveBeenCalledOnce();
  expect(outerCancel).not.toHaveBeenCalled();
  view.unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});

it('can focus the native modal when every action is disabled by its caller', () => {
  render(
    <EagleConfirmationDialog
      title="Submitting"
      description="The operation is being admitted"
      onCancel={() => {}}
      actions={<button disabled>Submitting</button>}
    />,
  );
  expect(screen.getByRole('alertdialog')).toHaveFocus();
});

it('keeps irreversible empty-trash wording and delegates the decision without adding network work', () => {
  const close = vi.fn(),
    confirm = vi.fn();
  render(<EagleTrashConfirmation mode="PHOTO" onClose={close} onConfirm={confirm} />);
  const modal = screen.getByRole('alertdialog', { name: '确认清空回收站' });
  expect(modal).toHaveAccessibleDescription(expect.stringContaining('包括尚未加载的项目'));
  expect(within(modal).getByRole('button', { name: '取消' })).toHaveFocus();
  fireEvent.click(within(modal).getByRole('button', { name: '确认永久删除' }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
});

it('keeps focus inside the confirmation when submission disables the focused action', () => {
  const show = (pending: boolean) => (
    <EagleConfirmationDialog
      title="Confirm"
      description="Operation details"
      onCancel={() => {}}
      actions={<button disabled={pending}>Submit</button>}
    />
  );
  const view = render(show(false));
  expect(screen.getByRole('button', { name: 'Submit' })).toHaveFocus();
  view.rerender(show(true));
  expect(screen.getByRole('alertdialog')).toHaveFocus();
});

it('wraps Tab and Shift+Tab within the confirmation actions', () => {
  render(<EagleConfirmationDialog title="Confirm" description="Details" onCancel={() => {}} actions={<><button>Cancel</button><button>Confirm</button></>} />);
  const modal = screen.getByRole('alertdialog'), first = screen.getByRole('button', { name: 'Cancel' }), last = screen.getByRole('button', { name: 'Confirm' });
  last.focus(); fireEvent.keyDown(modal, { key: 'Tab' }); expect(first).toHaveFocus();
  fireEvent.keyDown(modal, { key: 'Tab', shiftKey: true }); expect(last).toHaveFocus();
});
