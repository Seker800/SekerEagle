import { useMemo, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import { IconFolderBolt, IconPalette, IconSettings } from '@tabler/icons-react';
import type { EagleSmartFolder } from '../../lib/eagle-api';
import styles from './EagleSmartFolderTree.module.css';

const SMART_FOLDER_COLORS = [
  { name: '无色', value: null },
  { name: '红色', value: '#e35d6a' },
  { name: '橙色', value: '#e09a4f' },
  { name: '黄色', value: '#d6bd52' },
  { name: '绿色', value: '#65ad78' },
  { name: '蓝色', value: '#5f91d8' },
  { name: '紫色', value: '#9674cf' },
] as const;

export interface MoveEagleSmartFolderInput {
  parentId: string | null;
  position: number;
  rowVersion: number;
}

interface EagleSmartFolderTreeProps {
  folders: EagleSmartFolder[];
  activeFolderId: string | null;
  busy?: boolean;
  onSelect: (folder: EagleSmartFolder) => void;
  onMove: (folder: EagleSmartFolder, input: MoveEagleSmartFolderInput) => void;
  onChangeColor: (folder: EagleSmartFolder, color: string | null) => void;
  onEdit: (folder: EagleSmartFolder) => void;
}

type FolderContextMenu = { folder: EagleSmartFolder; x: number; y: number };

function compareFolders(left: EagleSmartFolder, right: EagleSmartFolder) {
  return left.position - right.position || left.id.localeCompare(right.id);
}

export function EagleSmartFolderTree({
  folders,
  activeFolderId,
  busy,
  onSelect,
  onMove,
  onChangeColor,
  onEdit,
}: EagleSmartFolderTreeProps) {
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<FolderContextMenu | null>(null);
  const foldersById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders],
  );
  const roots = useMemo(
    () => folders.filter((folder) => folder.parentId === null).sort(compareFolders),
    [folders],
  );
  const childrenByParent = useMemo(() => {
    const result = new Map<string, EagleSmartFolder[]>();
    folders.forEach((folder) => {
      if (!folder.parentId) return;
      const children = result.get(folder.parentId) ?? [];
      children.push(folder);
      result.set(folder.parentId, children);
    });
    result.forEach((children) => children.sort(compareFolders));
    return result;
  }, [folders]);

  const beginDrag = (event: DragEvent<HTMLDivElement>, folder: EagleSmartFolder) => {
    setDraggedFolderId(folder.id);
    setContextMenu(null);
    event.dataTransfer?.setData('text/plain', folder.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  };

  const finishDrag = () => {
    setDraggedFolderId(null);
    setDropTarget(null);
  };

  const moveRelativeTo = (
    event: DragEvent<HTMLElement>,
    target: EagleSmartFolder,
    placement: 'before' | 'after',
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const dragged = draggedFolderId ? foldersById.get(draggedFolderId) : undefined;
    if (!dragged || dragged.id === target.id || busy) return finishDrag();
    const siblings = folders
      .filter((folder) => folder.parentId === target.parentId && folder.id !== dragged.id)
      .sort(compareFolders);
    const targetIndex = siblings.findIndex((folder) => folder.id === target.id);
    if (targetIndex < 0) return finishDrag();
    onMove(dragged, {
      parentId: target.parentId,
      position: targetIndex + (placement === 'after' ? 1 : 0),
      rowVersion: dragged.rowVersion,
    });
    finishDrag();
  };

  const moveInside = (event: DragEvent<HTMLDivElement>, parent: EagleSmartFolder) => {
    event.preventDefault();
    event.stopPropagation();
    const dragged = draggedFolderId ? foldersById.get(draggedFolderId) : undefined;
    const draggedHasChildren = dragged
      ? (childrenByParent.get(dragged.id)?.length ?? 0) > 0
      : false;
    if (!dragged || dragged.id === parent.id || parent.parentId || draggedHasChildren || busy) {
      return finishDrag();
    }
    const children = (childrenByParent.get(parent.id) ?? []).filter(
      (folder) => folder.id !== dragged.id,
    );
    onMove(dragged, {
      parentId: parent.id,
      position: children.length,
      rowVersion: dragged.rowVersion,
    });
    finishDrag();
  };

  const openContextMenu = (event: MouseEvent, folder: EagleSmartFolder) => {
    event.preventDefault();
    setContextMenu({ folder, x: event.clientX, y: event.clientY });
  };

  const renderDropZone = (folder: EagleSmartFolder, placement: 'before' | 'after') => {
    const key = `${placement}-${folder.id}`;
    return (
      <div
        className={`${styles.dropZone} ${dropTarget === key ? styles.dropZoneActive : ''}`}
        data-testid={`smart-folder-drop-${placement}-${folder.id}`}
        onDragEnter={() => setDropTarget(key)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => moveRelativeTo(event, folder, placement)}
      />
    );
  };

  const renderFolder = (folder: EagleSmartFolder, level: 1 | 2) => (
    <div
      key={folder.id}
      className={`${styles.item} ${level === 2 ? styles.child : ''} ${dropTarget === `inside-${folder.id}` ? styles.itemDropTarget : ''}`}
      role="treeitem"
      aria-label={folder.name}
      aria-level={level}
      aria-selected={activeFolderId === folder.id}
      draggable={!busy}
      data-smart-folder-id={folder.id}
      onContextMenu={(event) => openContextMenu(event, folder)}
      onDragStart={(event) => beginDrag(event, folder)}
      onDragEnd={finishDrag}
      onDragEnter={() => level === 1 && setDropTarget(`inside-${folder.id}`)}
      onDragOver={(event) => {
        if (level === 1) event.preventDefault();
      }}
      onDrop={(event) => level === 1 && moveInside(event, folder)}
    >
      <button
        className={activeFolderId === folder.id ? styles.active : undefined}
        type="button"
        onClick={() => onSelect(folder)}
      >
        <IconFolderBolt
          size={17}
          style={{ '--smart-folder-color': folder.color ?? undefined } as CSSProperties}
        />
        <span>{folder.name}</span>
      </button>
    </div>
  );

  return (
    <>
      <div className={styles.tree} role="tree" aria-label="智能文件夹">
        {roots.map((root) => {
          const children = childrenByParent.get(root.id) ?? [];
          return (
            <div className={styles.branch} key={root.id}>
              {renderDropZone(root, 'before')}
              {renderFolder(root, 1)}
              {children.map((child) => (
                <div key={child.id}>
                  {renderDropZone(child, 'before')}
                  {renderFolder(child, 2)}
                  {renderDropZone(child, 'after')}
                </div>
              ))}
              {renderDropZone(root, 'after')}
            </div>
          );
        })}
      </div>
      {contextMenu && (
        <>
          <button
            className={styles.menuDismiss}
            type="button"
            aria-label="关闭智能文件夹操作菜单"
            onClick={() => setContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className={styles.menu}
            role="menu"
            aria-label="智能文件夹操作"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className={styles.editAction}
              type="button"
              role="menuitem"
              aria-label="修改文件夹参数"
              disabled={busy}
              onClick={() => {
                onEdit(contextMenu.folder);
                setContextMenu(null);
              }}
            >
              <IconSettings size={14} />
              修改文件夹参数…
            </button>
            <div className={styles.menuTitle}>
              <IconPalette size={14} />
              修改文件夹颜色
            </div>
            <div className={styles.palette}>
              {SMART_FOLDER_COLORS.map((color) => (
                <button
                  key={color.name}
                  type="button"
                  role="menuitemradio"
                  aria-label={`设为${color.name}`}
                  aria-checked={contextMenu.folder.color === color.value}
                  disabled={busy}
                  style={{ '--palette-color': color.value ?? '#4b5058' } as CSSProperties}
                  onClick={() => {
                    onChangeColor(contextMenu.folder, color.value);
                    setContextMenu(null);
                  }}
                >
                  <span />
                  {color.name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
