import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { LibraryWorkspaceProvider, useLibraryWorkspace } from './library-workspace';
it('fails closed when the workspace is missing', () => {
  expect(() => renderHook(() => useLibraryWorkspace())).toThrow('LibraryWorkspaceProvider');
});
it('exposes the same explicit API in both modes without module factory exports', () => {
  const workspace = (mode: 'MATERIAL' | 'PHOTO') =>
    renderHook(() => useLibraryWorkspace(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <LibraryWorkspaceProvider ownerId="owner" libraryMode={mode}>
          {children}
        </LibraryWorkspaceProvider>
      ),
    });
  const material = workspace('MATERIAL'),
    photo = workspace('PHOTO');
  expect(Object.keys(material.result.current.api).sort()).toEqual(
    Object.keys(photo.result.current.api).sort(),
  );
  expect(material.result.current.api).not.toHaveProperty('createEagleApi');
  material.unmount();
  photo.unmount();
});
