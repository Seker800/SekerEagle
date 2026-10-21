import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, it, expect, vi } from 'vitest';
import { LibraryModeControl } from './LibraryModeControl';
afterEach(() => vi.unstubAllGlobals());
it('resizing changes only the mode presentation and preserves the selected business scope', () => {
  let compact = false;
  const listeners = new Set<() => void>();
  const changed = vi.fn();
  vi.stubGlobal('matchMedia', () => ({
    matches: compact,
    addEventListener: (_event: string, callback: () => void) => listeners.add(callback),
    removeEventListener: (_event: string, callback: () => void) => listeners.delete(callback),
  }));
  const page = render(<LibraryModeControl value="PHOTO" onChange={changed} />);
  expect(screen.getByRole('button', { name: '照片' })).toHaveAttribute('aria-pressed', 'true');
  act(() => {
    compact = true;
    listeners.forEach((listener) => listener());
  });
  expect(screen.getByRole('button', { name: '照片' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '素材' }));
  expect(changed).toHaveBeenCalledWith('MATERIAL');
  page.rerender(<LibraryModeControl value="MATERIAL" onChange={changed} />);
  act(() => {
    compact = false;
    listeners.forEach((listener) => listener());
  });
  expect(screen.getByRole('button', { name: '素材' })).toHaveAttribute('aria-pressed', 'true');
});
