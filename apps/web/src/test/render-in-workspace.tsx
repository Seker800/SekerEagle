import { render, type RenderOptions } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LibraryWorkspaceProvider } from '../lib/library-workspace';
import type { LibraryMode } from '../lib/library-api-scope';
function renderWorkspace(ui: ReactNode, options: RenderOptions | undefined, mode: LibraryMode) {
  const Outer = options?.wrapper;
  return render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <LibraryWorkspaceProvider ownerId="owner" libraryMode={mode}>
        {Outer ? <Outer>{children}</Outer> : children}
      </LibraryWorkspaceProvider>
    ),
  });
}
export const renderInWorkspace = (ui: ReactNode, options?: RenderOptions) =>
  renderWorkspace(ui, options, 'MATERIAL');
export const renderInPhotoWorkspace = (ui: ReactNode, options?: RenderOptions) =>
  renderWorkspace(ui, options, 'PHOTO');
