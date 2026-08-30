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
