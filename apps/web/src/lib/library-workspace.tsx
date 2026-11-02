import { createContext, useContext, useMemo, type ReactNode } from 'react';
import * as assets from './eagle-api';
import * as vectors from './eagle-vector-api';
import * as processing from './eagle-processing-admin-api';
import * as privacy from './eagle-privacy-api';
import * as visibility from './privacy-visibility-api';
import * as tasks from './eagle-task-center-api';
import { useQueryClient } from '@tanstack/react-query';
import { observeAcceptedOperation } from './accepted-operation';
import type { LibraryMode } from './library-api-scope';

function createWorkspaceApi(mode: LibraryMode, observe: (value: unknown) => void) {
  const api = {
    ...assets.createEagleApi(mode),
    ...vectors.createEagleVectorApi(mode),
    ...processing.createEagleProcessingAdminApi(mode),
    ...privacy.createEaglePrivacyApi(mode),
    ...visibility.createPrivacyVisibilityApi(mode),
    ...tasks.createEagleTaskCenterApi(mode),
  };
  // Each adapter closes over this workspace's owner and QueryClient. Read helpers
  // remain synchronous; only actual JSON receipts are observed.
  return Object.fromEntries(
    Object.entries(api).map(([name, method]) => [
      name,
      (...args: unknown[]) => {
        const value = (method as (...input: unknown[]) => unknown)(...args);
        if (value instanceof Promise)
          return value.then((result: unknown) => {
            observe(result);
            return result;
          });
        return value;
      },
    ]),
  ) as typeof api;
}
interface LibraryWorkspace {
  libraryMode: LibraryMode;
  ownerId: string;
  includePrivate: boolean;
  api: ReturnType<typeof createWorkspaceApi>;
}
const LibraryWorkspaceContext = createContext<LibraryWorkspace | null>(null);
export function LibraryWorkspaceProvider({
  libraryMode,
  ownerId,
  includePrivate = false,
  children,
}: {
  libraryMode: LibraryMode;
  ownerId: string;
  includePrivate?: boolean;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const value = useMemo(
    () => ({
      libraryMode,
      ownerId,
      includePrivate,
      api: createWorkspaceApi(libraryMode, (result) => {
        observeAcceptedOperation(client, ownerId, libraryMode, result);
      }),
    }),
    [client, libraryMode, ownerId, includePrivate],
  );
  return (
    <LibraryWorkspaceContext.Provider value={value}>{children}</LibraryWorkspaceContext.Provider>
  );
}
export function useLibraryWorkspace() {
  const workspace = useContext(LibraryWorkspaceContext);
  if (!workspace) throw new Error('LibraryWorkspaceProvider is required.');
  return workspace;
}
