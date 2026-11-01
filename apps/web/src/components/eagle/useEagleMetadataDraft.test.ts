// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useEagleMetadataDraft } from './useEagleMetadataDraft';

const asset = {
  id: 'a',
  displayName: 'Original',
  annotation: { color: null, description: 'Old', sourceUrl: null },
};
it('keeps dirty fields across processing refreshes and ignores late save acknowledgements', () => {
  const { result } = renderHook(() => useEagleMetadataDraft('scope'));
  act(() => result.current.load(asset));
  act(() => result.current.change('description', 'First'));
  const first = result.current.submission()!;
  act(() => result.current.change('description', 'Second'));
  act(() => result.current.saved('a', first.revision));
  act(() => result.current.load({ ...asset, displayName: 'Server refresh' }));
  expect(result.current.values.displayName).toBe('Original');
  expect(result.current.submission()?.input).toEqual({ description: 'Second' });
  const latest = result.current.submission()!;
  act(() => result.current.saved('a', latest.revision));
  expect(result.current.dirty).toBe(false);
});
it('resets on an asset or privacy scope change, sending only edited fields', () => {
  const { result, rerender } = renderHook(({ scope }) => useEagleMetadataDraft(scope), {
    initialProps: { scope: 'private' },
  });
  act(() => result.current.load(asset));
  act(() => result.current.change('description', '   '));
  act(() => result.current.change('sourceUrl', ' https://example.invalid '));
  expect(result.current.submission()?.input).toEqual({
    description: null,
    sourceUrl: 'https://example.invalid',
  });
  act(() => result.current.load({ ...asset, id: 'b' }));
  expect(result.current.submission()).toBeNull();
  act(() => result.current.change('displayName', 'Draft'));
  act(() => result.current.saved('a', 1));
  expect(result.current.dirty).toBe(true);
  act(() => result.current.load(asset));
  act(() => result.current.change('displayName', 'New visit'));
  act(() => result.current.saved('a', 1));
  expect(result.current.dirty).toBe(true);
  rerender({ scope: 'public' });
  expect(result.current.values.displayName).toBe('');
  expect(result.current.submission()).toBeNull();
});
