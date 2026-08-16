import type { EagleSmartFolder } from '../../lib/eagle-api';

interface SmartFolderDestination {
  parentId: string | null;
  position: number;
}

function compareFolders(left: EagleSmartFolder, right: EagleSmartFolder) {
  return left.position - right.position || left.id.localeCompare(right.id);
}

export function moveSmartFolderInTree(
  folders: EagleSmartFolder[],
  folderId: string,
  destination: SmartFolderDestination,
): EagleSmartFolder[] {
  const movedFolder = folders.find((folder) => folder.id === folderId);
  if (!movedFolder) return folders;

  const updates = new Map<string, EagleSmartFolder>();
  const reindex = (siblings: EagleSmartFolder[]) => {
    siblings.forEach((folder, position) => {
      updates.set(folder.id, { ...folder, position });
    });
  };
  const siblingsAt = (parentId: string | null) =>
    folders
      .filter((folder) => folder.parentId === parentId && folder.id !== folderId)
      .sort(compareFolders);

  if (movedFolder.parentId !== destination.parentId) {
    reindex(siblingsAt(movedFolder.parentId));
  }

  const destinationSiblings = siblingsAt(destination.parentId);
  const destinationPosition = Math.min(destination.position, destinationSiblings.length);
  destinationSiblings.splice(destinationPosition, 0, {
    ...movedFolder,
    parentId: destination.parentId,
    position: destinationPosition,
  });
  reindex(destinationSiblings);

  return folders.map((folder) => updates.get(folder.id) ?? folder);
}
