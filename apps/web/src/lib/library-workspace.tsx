import { createContext, useContext, useMemo, type ReactNode } from 'react';
import * as assets from './eagle-api';
import * as vectors from './eagle-vector-api';
import * as processing from './eagle-processing-admin-api';
import * as privacy from './eagle-privacy-api';
import * as visibility from './privacy-visibility-api';
import * as tasks from './eagle-task-center-api';
import type { LibraryMode } from './library-api-scope';

function createWorkspaceApi(mode: LibraryMode) {
  return {
    ...assets.createEagleApi(mode),
    ...vectors.createEagleVectorApi(mode),
    ...processing.createEagleProcessingAdminApi(mode),
    ...privacy.createEaglePrivacyApi(mode),
    ...visibility.createPrivacyVisibilityApi(mode),
    ...tasks.createEagleTaskCenterApi(mode),
  };
}
interface LibraryWorkspace {
  libraryMode: LibraryMode;
  ownerId: string;
  api: ReturnType<typeof createWorkspaceApi>;
}
const LibraryWorkspaceContext = createContext<LibraryWorkspace | null>(null);
export function LibraryWorkspaceProvider({
  libraryMode,
  ownerId,
  children,
}: {
  libraryMode: LibraryMode;
  ownerId: string;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ libraryMode, ownerId, api: createWorkspaceApi(libraryMode) }),
    [libraryMode, ownerId],
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
