import { createContext, useContext, useMemo, type ReactNode } from 'react';
import * as assets from './eagle-api';
import * as aiTags from './eagle-ai-tag-api';
import * as vectors from './eagle-vector-api';
import * as processing from './eagle-processing-admin-api';
import * as privacy from './eagle-privacy-api';
import * as visibility from './privacy-visibility-api';
import type { LibraryMode } from './library-api-scope';

const materialApi = { ...assets, ...aiTags, ...vectors, ...processing, ...privacy, ...visibility };
function photoApi() {
  return {
    ...assets.createEagleApi('PHOTO'),
    ...aiTags.createEagleAiTagApi('PHOTO'),
    ...vectors.createEagleVectorApi('PHOTO'),
    ...processing.createEagleProcessingAdminApi('PHOTO'),
    ...privacy.createEaglePrivacyApi('PHOTO'),
    ...visibility.createPrivacyVisibilityApi('PHOTO'),
  };
}
interface LibraryWorkspace {
  libraryMode: LibraryMode;
  ownerId: string;
  api: ReturnType<typeof photoApi>;
}
const LibraryWorkspaceContext = createContext<LibraryWorkspace>({
  libraryMode: 'MATERIAL',
  ownerId: '',
  api: materialApi,
});
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
    () => ({ libraryMode, ownerId, api: libraryMode === 'PHOTO' ? photoApi() : materialApi }),
    [libraryMode, ownerId],
  );
  return (
    <LibraryWorkspaceContext.Provider value={value}>{children}</LibraryWorkspaceContext.Provider>
  );
}
export function useLibraryWorkspace() {
  return useContext(LibraryWorkspaceContext);
}
