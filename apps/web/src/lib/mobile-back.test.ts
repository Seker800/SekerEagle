import { beforeEach, expect, it, vi } from 'vitest';
import { consumeMobileBack, registerMobileBack } from './mobile-back';
beforeEach(() => {
  document.body.innerHTML = '';
});
it('closes the front dialog and expanded menu before returning to its page', () => {
  const page = vi.fn(() => true),
    dispose = registerMobileBack(page, 0);
  const dialog = document.createElement('dialog');
  dialog.open = true;
  document.body.append(dialog);
  const cancel = vi.fn((event: Event) => {
    event.preventDefault();
    dialog.remove();
  });
  dialog.addEventListener('cancel', cancel);
  expect(consumeMobileBack()).toBe(true);
  expect(cancel).toHaveBeenCalledOnce();
  expect(page).not.toHaveBeenCalled();
  const details = document.createElement('details');
  details.open = true;
  document.body.append(details);
  expect(consumeMobileBack()).toBe(true);
  expect(details.open).toBe(false);
  expect(page).not.toHaveBeenCalled();
  expect(consumeMobileBack()).toBe(true);
  expect(page).toHaveBeenCalledOnce();
  dispose();
});
it('gives the latest modal priority and does not consume the home screen back action', () => {
  const page = vi.fn(() => false),
    modal = vi.fn(() => true);
  const first = registerMobileBack(page, 0),
    second = registerMobileBack(modal, 100);
  expect(consumeMobileBack()).toBe(true);
  expect(modal).toHaveBeenCalledOnce();
  expect(page).not.toHaveBeenCalled();
  second();
  expect(consumeMobileBack()).toBe(false);
  expect(page).toHaveBeenCalledOnce();
  first();
});
it('dismisses only the front visible custom modal before page navigation', () => {
  const page = vi.fn(() => false),
    dispose = registerMobileBack(page);
  document.body.innerHTML = `<div role="dialog" hidden><button data-mobile-back>Hidden</button></div>
    <dialog><div role="dialog"><button data-mobile-back>Closed</button></div></dialog>
    <section role="dialog"><details open><summary>More</summary></details><button data-mobile-back>Close</button></section>`;
  const modal = document.querySelector('section')!;
  const close = vi.fn(() => modal.remove());
  modal.querySelector('button')!.addEventListener('click', close);
  expect(consumeMobileBack()).toBe(true);
  expect(close).not.toHaveBeenCalled();
  expect(modal.querySelector('details')!.open).toBe(false);
  expect(consumeMobileBack()).toBe(true);
  expect(close).toHaveBeenCalledOnce();
  expect(consumeMobileBack()).toBe(false);
  expect(page).toHaveBeenCalledOnce();
  dispose();
});
it('keeps a modal open without an enabled dismiss action and closes an uncancelled native dialog', () => {
  document.body.innerHTML =
    '<div role="alertdialog"><button data-mobile-back disabled>Wait</button></div>';
  expect(consumeMobileBack()).toBe(true);
  document.body.innerHTML = '<dialog open></dialog>';
  const dialog = document.querySelector('dialog')!;
  const close = vi.fn(() => {
    dialog.open = false;
  });
  dialog.close = close;
  expect(consumeMobileBack()).toBe(true);
  expect(close).toHaveBeenCalledOnce();
  expect(consumeMobileBack()).toBe(false);
});
it('cancels only handled native events and releases its event listener at disposal', () => {
  const callback = vi.fn(() => true),
    dispose = registerMobileBack(callback);
  expect(window.dispatchEvent(new Event('sekereagle:back', { cancelable: true }))).toBe(false);
  callback.mockReturnValue(false);
  expect(window.dispatchEvent(new Event('sekereagle:back', { cancelable: true }))).toBe(true);
  dispose();
  window.dispatchEvent(new Event('sekereagle:back', { cancelable: true }));
  expect(callback).toHaveBeenCalledTimes(2);
});
import { renderHook } from '@testing-library/react';
import { useMobileBack } from './mobile-back';
it('uses the latest page state and unregisters a disabled or unmounted page', () => {
  const callback = vi.fn(() => false);
  const { rerender, unmount } = renderHook(
    ({ enabled, handled }) =>
      useMobileBack(
        () => {
          callback();
          return handled;
        },
        5,
        enabled,
      ),
    { initialProps: { enabled: true, handled: false } },
  );
  expect(consumeMobileBack()).toBe(false);
  rerender({ enabled: true, handled: true });
  expect(consumeMobileBack()).toBe(true);
  rerender({ enabled: false, handled: true });
  expect(consumeMobileBack()).toBe(false);
  unmount();
  expect(callback).toHaveBeenCalledTimes(2);
});
