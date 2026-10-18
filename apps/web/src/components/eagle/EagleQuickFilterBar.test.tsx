import { LibraryWorkspaceProvider } from '../../lib/library-workspace';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  EagleQuickFilterBar,
  buildEagleQuickFilterQuery,
  createEmptyEagleQuickFilterState,
  type EagleQuickFilterState,
} from './EagleQuickFilterBar';

const manualTags = [
  {
    id: 'manual-1',
    name: '工业',
    color: '#5078d0',
    groupId: null,
    groupIds: [],
    isStarred: true,
    rowVersion: 1,
    assetCount: 12,
    lastUsedAt: null,
    pinyin: 'gongye',
    pinyinInitials: 'gy',
  },
  {
    id: 'manual-2',
    name: '建筑',
    color: null,
    groupId: null,
    groupIds: [],
    isStarred: false,
    rowVersion: 1,
    assetCount: 8,
    lastUsedAt: null,
    pinyin: 'jianzhu',
    pinyinInitials: 'jz',
  },
];

const aiTags = [
  {
    id: 'ai-1',
    name: '管道',
    color: null,
    rowVersion: 1,
    assetCount: 20,
    pinyin: 'guandao',
    pinyinInitials: 'gd',
  },
];

function renderBar(
  initialValue: EagleQuickFilterState = createEmptyEagleQuickFilterState(),
  expand = true,
) {
  const onChange = vi.fn();
  function ControlledBar() {
    const [value, setValue] = useState(initialValue);
    return (
      <EagleQuickFilterBar
        value={value}
        manualTags={manualTags}
        aiTags={aiTags}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  render(<ControlledBar />);
  if (expand) fireEvent.click(screen.getByRole('button', { name: '展开筛选' }));
  return onChange;
}

describe('EagleQuickFilterBar', () => {
  it('starts collapsed and preserves active filters when collapsing an open menu', () => {
    const onChange = renderBar(undefined, false);
    const toggle = screen.getByRole('button', { name: '展开筛选' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '格式筛选' })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '格式筛选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'PNG' }));
    const applied = onChange.mock.lastCall?.[0];
    expect(applied.formats).toEqual(['png']);
    onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '收起筛选' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /格式筛选/ })).not.toBeInTheDocument();
    expect(screen.getByText('已启用 1 项筛选')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '展开筛选' }));
    expect(screen.getByRole('button', { name: /格式筛选，PNG/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起筛选' }));
    fireEvent.click(screen.getByRole('button', { name: /清除全部快捷筛选/ }));
    expect(screen.queryByText('已启用 1 项筛选')).not.toBeInTheDocument();
    expect(onChange.mock.lastCall?.[0].formats).toEqual([]);
  });

  it('shows Eagle-style pinned field entries instead of a rule builder', () => {
    renderBar();

    const toolbar = screen.getByRole('toolbar', { name: '快捷筛选' });
    expect(within(toolbar).getByRole('button', { name: '颜色筛选' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '标签筛选' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '形状筛选' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '评分筛选' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '格式筛选' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '添加筛选器' })).toBeInTheDocument();
    expect(screen.queryByText('规则筛选')).not.toBeInTheDocument();
  });

  it('uses a dedicated format popover and returns a multi-value selection', () => {
    const onChange = renderBar();

    fireEvent.click(screen.getByRole('button', { name: '格式筛选' }));
    const popover = screen.getByRole('dialog', { name: '格式筛选' });
    fireEvent.click(within(popover).getByRole('checkbox', { name: 'WEBP' }));
    fireEvent.click(within(popover).getByRole('checkbox', { name: 'PNG' }));

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ formats: ['webp', 'png'] }),
    );
  });

  it('lets users search, pin and persist additional filter fields', () => {
    renderBar();

    fireEvent.click(screen.getByRole('button', { name: '添加筛选器' }));
    const manager = screen.getByRole('dialog', { name: '管理快捷筛选器' });
    fireEvent.change(within(manager).getByRole('searchbox', { name: '搜索筛选器' }), {
      target: { value: '大小' },
    });
    fireEvent.click(within(manager).getByRole('button', { name: '固定 大小' }));

    expect(screen.getByRole('button', { name: '大小筛选' })).toBeInTheDocument();
    expect(window.localStorage.getItem('seker-eagle.quick-filter-fields.v1')).toContain(
      'FILE_SIZE',
    );
  });

  it('keeps tag selection searchable and exposes any/all matching without rule syntax', () => {
    const onChange = renderBar();

    fireEvent.click(screen.getByRole('button', { name: '标签筛选' }));
    const popover = screen.getByRole('dialog', { name: '标签筛选' });
    fireEvent.change(within(popover).getByRole('searchbox', { name: '搜索标签' }), {
      target: { value: '建筑' },
    });
    fireEvent.click(within(popover).getByRole('checkbox', { name: /建筑/ }));
    fireEvent.click(within(popover).getByRole('radio', { name: '匹配全部标签' }));

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ manualTagIds: ['manual-2'], manualTagMatch: 'ALL' }),
    );
  });
});

describe('buildEagleQuickFilterQuery', () => {
  it('combines different fields with AND and same-field choices with OR', () => {
    const query = buildEagleQuickFilterQuery({
      ...createEmptyEagleQuickFilterState(),
      formats: ['png', 'webp'],
      shapes: ['LANDSCAPE', 'SQUARE'],
      ratingAtLeast: 4,
    });

    expect(query.conditions).toHaveLength(3);
    expect(query.conditions.every((condition) => condition.result === 'MATCH')).toBe(true);
    expect(query.conditions.find((condition) => condition.rules[0]?.field === 'FORMAT')).toEqual(
      expect.objectContaining({
        match: 'ANY',
        rules: [
          expect.objectContaining({ field: 'FORMAT', value: 'png' }),
          expect.objectContaining({ field: 'FORMAT', value: 'webp' }),
        ],
      }),
    );
    expect(query.conditions.find((condition) => condition.rules[0]?.field === 'RATING')).toEqual(
      expect.objectContaining({
        match: 'ALL',
        rules: [expect.objectContaining({ operator: 'GTE', value: '4' })],
      }),
    );
  });
});

it('photography uses the shared quick-filter state and clears with all filters', () => {
  const state = createEmptyEagleQuickFilterState();
  state.text.CAMERA_MODEL = 'Test Camera';
  state.choices = { GPS: 'WITHOUT', PERSON: 'person-1' };
  const query = buildEagleQuickFilterQuery(state);
  expect(
    query.conditions.flatMap((condition) => condition.rules).map((rule) => rule.field),
  ).toEqual(expect.arrayContaining(['CAMERA_MODEL', 'GPS', 'PERSON']));
  renderBar(state);
  fireEvent.click(screen.getByRole('button', { name: /清除全部快捷筛选/ }));
  expect(screen.queryByRole('button', { name: /清除全部快捷筛选/ })).not.toBeInTheDocument();
});

it('material filter manager never offers photography fields', () => {
  renderBar();
  fireEvent.click(screen.getByRole('button', { name: '添加筛选器' }));
  const manager = screen.getByRole('dialog', { name: '管理快捷筛选器' });
  expect(within(manager).queryByText('相机')).not.toBeInTheDocument();
  expect(within(manager).queryByText('镜头')).not.toBeInTheDocument();
  expect(within(manager).queryByText('GPS')).not.toBeInTheDocument();
});

it('photo fields are managed and cleared in the existing filter toolbar', () => {
  function PhotoBar() {
    const [value, onChange] = useState(createEmptyEagleQuickFilterState());
    return (
      <LibraryWorkspaceProvider ownerId="owner" libraryMode="PHOTO">
        <EagleQuickFilterBar value={value} manualTags={[]} aiTags={[]} onChange={onChange} />
      </LibraryWorkspaceProvider>
    );
  }
  render(<PhotoBar />);
  expect(screen.queryByRole('button', { name: '相机筛选' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '展开筛选' }));
  fireEvent.click(screen.getByRole('button', { name: '添加筛选器' }));
  fireEvent.click(screen.getByRole('button', { name: '固定 相机' }));
  fireEvent.click(screen.getByRole('button', { name: '关闭筛选器管理' }));
  fireEvent.click(screen.getByRole('button', { name: '相机筛选' }));
  fireEvent.change(screen.getByLabelText('相机包含'), {
    target: { value: 'Test Camera' },
  });
  fireEvent.click(screen.getByRole('button', { name: '关闭相机筛选' }));
  expect(screen.getByRole('button', { name: /相机筛选，Test Camera/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /清除全部快捷筛选/ }));
  expect(screen.getByRole('button', { name: '相机筛选' })).toBeInTheDocument();
  expect(screen.getAllByRole('toolbar', { name: '快捷筛选' })).toHaveLength(1);
});
