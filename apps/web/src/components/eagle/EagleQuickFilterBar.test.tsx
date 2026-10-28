import { LibraryWorkspaceProvider } from '../../lib/library-workspace';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EagleQuickFilterBar,
  buildEagleQuickFilterQuery,
  createEmptyEagleQuickFilterState,
  type EagleQuickFilterState,
} from './EagleQuickFilterBar';

beforeEach(() => {
  window.localStorage.removeItem('seker-eagle.quick-filter-fields.v1');
  window.localStorage.removeItem('seker-eagle.quick-filter-fields.v1.PHOTO');
});

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

function renderBar(initialValue: EagleQuickFilterState = createEmptyEagleQuickFilterState()) {
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
  return onChange;
}

describe('EagleQuickFilterBar', () => {
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
  fireEvent.click(screen.getByRole('button', { name: '添加筛选器' }));
  fireEvent.click(screen.getByRole('button', { name: '取消固定 相机' }));
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

it('renders filter panels outside the scrolling toolbar, keeps inside pointers open and restores focus on Escape', () => {
  renderBar();
  const trigger = screen.getByRole('button', { name: '标签筛选' });
  fireEvent.click(trigger);
  const panel = screen.getByRole('dialog', { name: '标签筛选' });
  expect(screen.getByRole('toolbar', { name: '快捷筛选' })).not.toContainElement(panel);
  fireEvent.pointerDown(panel);
  expect(panel).toBeInTheDocument();
  fireEvent.keyDown(panel, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: '标签筛选' })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

function scopedBar(mode: 'MATERIAL' | 'PHOTO') {
  return (
    <LibraryWorkspaceProvider ownerId="owner" libraryMode={mode}>
      <EagleQuickFilterBar
        value={createEmptyEagleQuickFilterState()}
        manualTags={[]}
        aiTags={[]}
        onChange={vi.fn()}
      />
    </LibraryWorkspaceProvider>
  );
}
function shownFields() {
  return within(screen.getByRole('toolbar', { name: '快捷筛选' }))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'))
    .filter((label) => label?.endsWith('筛选'));
}
it('uses photo defaults in order and restores independent customizations when switching and remounting', () => {
  const view = render(scopedBar('PHOTO'));
  expect(shownFields()).toEqual(['相机筛选', '镜头筛选', '标签筛选', '格式筛选']);
  fireEvent.click(screen.getByRole('button', { name: '添加筛选器' }));
  fireEvent.click(screen.getByRole('button', { name: '取消固定 镜头' }));
  fireEvent.click(screen.getByRole('button', { name: '固定 评分' }));
  view.rerender(scopedBar('MATERIAL'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(shownFields()).toEqual(['颜色筛选', '标签筛选', '形状筛选', '评分筛选', '格式筛选']);
  fireEvent.click(screen.getByRole('button', { name: '添加筛选器' }));
  fireEvent.click(screen.getByRole('button', { name: '取消固定 颜色' }));
  view.rerender(scopedBar('PHOTO'));
  expect(shownFields()).toEqual(['相机筛选', '标签筛选', '格式筛选', '评分筛选']);
  view.unmount();
  const reloaded = render(scopedBar('PHOTO'));
  expect(shownFields()).toEqual(['相机筛选', '标签筛选', '格式筛选', '评分筛选']);
  reloaded.rerender(scopedBar('MATERIAL'));
  expect(shownFields()).toEqual(['标签筛选', '形状筛选', '评分筛选', '格式筛选']);
});
it('keeps saved layouts including an intentionally empty photo toolbar and falls back per mode on corrupt storage', () => {
  window.localStorage.setItem(
    'seker-eagle.quick-filter-fields.v1',
    JSON.stringify(['FORMAT', 'MANUAL_TAGS']),
  );
  window.localStorage.setItem('seker-eagle.quick-filter-fields.v1.PHOTO', '[]');
  const view = render(scopedBar('MATERIAL'));
  expect(shownFields()).toEqual(['格式筛选', '标签筛选']);
  view.rerender(scopedBar('PHOTO'));
  expect(shownFields()).toEqual([]);
  view.unmount();
  window.localStorage.setItem('seker-eagle.quick-filter-fields.v1.PHOTO', 'broken json');
  render(scopedBar('PHOTO'));
  expect(shownFields()).toEqual(['相机筛选', '镜头筛选', '标签筛选', '格式筛选']);
});

it('camera missing-parameter selection generates an EMPTY rule and can be cleared', () => {
  const state = {
    ...createEmptyEagleQuickFilterState(),
    text: { CAMERA_MODEL: 'old camera' },
    presence: { CAMERA_MODEL: 'EMPTY' as const },
  };
  const query = buildEagleQuickFilterQuery(state);
  expect(query.conditions[0].rules[0]).toEqual(
    expect.objectContaining({ field: 'CAMERA_MODEL', operator: 'EMPTY', value: undefined }),
  );
});

it('offers missing camera parameters in the photo quick filter and clears the selection', () => {
  function PhotoBar() {
    const [value, onChange] = useState(createEmptyEagleQuickFilterState());
    return (
      <LibraryWorkspaceProvider ownerId="owner" libraryMode="PHOTO">
        <EagleQuickFilterBar value={value} manualTags={[]} aiTags={[]} onChange={onChange} />
      </LibraryWorkspaceProvider>
    );
  }
  render(<PhotoBar />);
  fireEvent.click(screen.getByRole('button', { name: '相机筛选' }));
  fireEvent.change(screen.getByRole('combobox', { name: '相机条件' }), {
    target: { value: 'EMPTY' },
  });
  expect(screen.queryByLabelText('相机包含')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '关闭相机筛选' }));
  expect(screen.getByRole('button', { name: /相机筛选，无参数/ })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /清除全部快捷筛选/ }));
  expect(screen.getByRole('button', { name: '相机筛选' })).toBeVisible();
});
