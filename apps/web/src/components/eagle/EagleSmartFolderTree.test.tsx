import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EagleSmartFolder } from '../../lib/eagle-api';
import { EagleSmartFolderTree } from './EagleSmartFolderTree';

const folders: EagleSmartFolder[] = [
  {
    id: 'root-a',
    name: '项目集合',
    color: '#5f91d8',
    parentId: null,
    queryVersion: 1,
    queryJson: { version: 1, filters: {} },
    position: 0,
    rowVersion: 1,
  },
  {
    id: 'child-a',
    name: '猫头鹰',
    color: null,
    parentId: 'root-a',
    queryVersion: 1,
    queryJson: { version: 1, filters: {} },
    position: 0,
    rowVersion: 2,
  },
  {
    id: 'root-b',
    name: '海报',
    color: null,
    parentId: null,
    queryVersion: 1,
    queryJson: { version: 1, filters: {} },
    position: 1,
    rowVersion: 1,
  },
];

describe('EagleSmartFolderTree', () => {
  it('renders a two-level tree and selects both parents and children', () => {
    const onSelect = vi.fn();
    render(
      <EagleSmartFolderTree
        folders={folders}
        activeFolderId={null}
        onSelect={onSelect}
        onMove={vi.fn()}
        onChangeColor={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByRole('treeitem', { name: '项目集合' })).toHaveAttribute('aria-level', '1');
    expect(screen.getByRole('treeitem', { name: '猫头鹰' })).toHaveAttribute('aria-level', '2');
    fireEvent.click(within(screen.getByRole('treeitem', { name: '项目集合' })).getByRole('button'));
    fireEvent.click(within(screen.getByRole('treeitem', { name: '猫头鹰' })).getByRole('button'));
    expect(onSelect.mock.calls.map(([folder]) => folder.id)).toEqual(['root-a', 'child-a']);
  });

  it('offers folder colors from the right-click menu', () => {
    const onChangeColor = vi.fn();
    const onEdit = vi.fn();
    render(
      <EagleSmartFolderTree
        folders={folders}
        activeFolderId={null}
        onSelect={vi.fn()}
        onMove={vi.fn()}
        onChangeColor={onChangeColor}
        onEdit={onEdit}
      />,
    );

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: '项目集合' }), {
      clientX: 20,
      clientY: 30,
    });
    const menu = screen.getByRole('menu', { name: '智能文件夹操作' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: '修改文件夹参数' }));
    expect(onEdit).toHaveBeenCalledWith(folders[0]);

    fireEvent.contextMenu(screen.getByRole('treeitem', { name: '项目集合' }), {
      clientX: 20,
      clientY: 30,
    });
    fireEvent.click(
      within(screen.getByRole('menu', { name: '智能文件夹操作' })).getByRole('menuitemradio', {
        name: '设为绿色',
      }),
    );
    expect(onChangeColor).toHaveBeenCalledWith(folders[0], '#65ad78');
  });

  it('moves a folder inside a root or between root siblings by drag and drop', () => {
    const onMove = vi.fn();
    render(
      <EagleSmartFolderTree
        folders={folders}
        activeFolderId={null}
        onSelect={vi.fn()}
        onMove={onMove}
        onChangeColor={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    fireEvent.dragStart(screen.getByRole('treeitem', { name: '海报' }));
    fireEvent.dragOver(screen.getByRole('treeitem', { name: '项目集合' }));
    fireEvent.drop(screen.getByRole('treeitem', { name: '项目集合' }));
    expect(onMove).toHaveBeenLastCalledWith(folders[2], {
      parentId: 'root-a',
      position: 1,
      rowVersion: 1,
    });

    fireEvent.dragStart(screen.getByRole('treeitem', { name: '海报' }));
    fireEvent.dragOver(screen.getByTestId('smart-folder-drop-before-root-a'));
    fireEvent.drop(screen.getByTestId('smart-folder-drop-before-root-a'));
    expect(onMove).toHaveBeenLastCalledWith(folders[2], {
      parentId: null,
      position: 0,
      rowVersion: 1,
    });
  });
});

