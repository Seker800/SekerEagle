import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LibraryWorkspaceProvider } from '../lib/library-workspace';
import type { LibraryMode } from '../lib/library-api-scope';
function renderWorkspace(ui: ReactNode, options: RenderOptions | undefined, mode: LibraryMode) {
  const Outer = options?.wrapper;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <LibraryWorkspaceProvider ownerId="owner" libraryMode={mode}>
          {Outer ? <Outer>{children}</Outer> : children}
        </LibraryWorkspaceProvider>
      </QueryClientProvider>
    ),
  });
}
export const renderInWorkspace = (ui: ReactNode, options?: RenderOptions) =>
  renderWorkspace(ui, options, 'MATERIAL');
export const renderInPhotoWorkspace = (ui: ReactNode, options?: RenderOptions) =>
  renderWorkspace(ui, options, 'PHOTO');
