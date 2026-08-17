import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EagleAiTag, EagleManualTag } from '../../lib/eagle-api';
import { EagleSmartFolderDialog } from './EagleSmartFolderDialog';

function manualTag(
  id: string,
  name: string,
  assetCount: number,
  options: { isStarred?: boolean; pinyin?: string; pinyinInitials?: string } = {},
): EagleManualTag {
  return {
    id,
    name,
    color: null,
    groupId: null,
    groupIds: [],
    isStarred: options.isStarred ?? false,
    rowVersion: 1,
    assetCount,
    pinyin: options.pinyin ?? name,
    pinyinInitials: options.pinyinInitials ?? name,
  };
}

function aiTag(
  id: string,
  name: string,
  assetCount: number,
  pinyin: string,
  pinyinInitials: string,
): EagleAiTag {
  return { id, name, assetCount, pinyin, pinyinInitials };
}

const manualTags = [
  manualTag('popular', '全民封面', 603, { pinyin: 'quanminfengmian', pinyinInitials: 'qmfm' }),
  manualTag('selected', '灵感', 2, { pinyin: 'linggan', pinyinInitials: 'lg' }),
  manualTag('starred', '收藏参考', 1, {
    isStarred: true,
    pinyin: 'shoucangcankao',
    pinyinInitials: 'scck',
  }),
  manualTag('night', '夜间氛围', 18, { pinyin: 'yejianfenwei', pinyinInitials: 'yjfw' }),
];

const aiTags = [
  aiTag('owl', '猫头鹰', 12, 'maotouying', 'mty'),
  aiTag('night-scene', '夜景', 30, 'yejing', 'yj'),
];

describe('EagleSmartFolderDialog', () => {
  it('defaults new smart folders to matching any selected tag', () => {
    const onSave = vi.fn();
    render(
      <EagleSmartFolderDialog
        initialFilters={{ manualTagIds: ['selected'], aiTagIds: ['owl'] }}
        manualTags={manualTags}
        aiTags={aiTags}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByRole('combobox', { name: '标签匹配方式' })).toHaveValue('ANY');

    fireEvent.change(screen.getByRole('textbox', { name: '智能文件夹名称' }), {
      target: { value: '任意标签' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存智能文件夹' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '任意标签',
        tagMatch: 'ANY',
      }),
    );
  });

  it('keeps legacy smart folders on matching all selected tags when editing', () => {
    render(
      <EagleSmartFolderDialog
        initialName="旧智能文件夹"
        mode="edit"
        initialFilters={{ manualTagIds: ['selected', 'popular'] }}
        manualTags={manualTags}
        aiTags={aiTags}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox', { name: '标签匹配方式' })).toHaveValue('ALL');
  });

  it('separates the primary workflow from optional filters and summarizes active conditions', () => {
    render(
      <EagleSmartFolderDialog
        initialName="重点素材"
        initialFilters={{
          manualTagIds: ['selected'],
          aiTagIds: ['owl'],
          formats: ['png'],
          rating: 3,
          assetColor: '#2e86ab',
        }}
        manualTags={manualTags}
        aiTags={aiTags}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText('设置条件后，匹配的素材会自动归入这个文件夹')).toBeVisible();

    const primaryConditions = screen.getByRole('region', { name: '核心筛选条件' });
    expect(
      within(primaryConditions).getByRole('textbox', { name: '智能文件夹名称' }),
    ).toBeVisible();
    expect(within(primaryConditions).getByRole('group', { name: '人工标签条件' })).toBeVisible();
    expect(within(primaryConditions).getByRole('group', { name: 'AI 自动标签条件' })).toBeVisible();

    const optionalConditions = screen.getByRole('region', { name: '其他筛选条件' });
    expect(within(optionalConditions).getByRole('group', { name: '格式条件' })).toBeVisible();
    expect(
      within(optionalConditions).getByRole('combobox', { name: '智能文件夹星级' }),
    ).toBeVisible();
    expect(within(optionalConditions).getByRole('group', { name: '相似颜色条件' })).toBeVisible();

    expect(screen.getByRole('status')).toHaveTextContent('已启用 5 个条件');
  });

  it('keeps selected manual tags visible and searches the remaining list by pinyin initials', () => {
    render(
      <EagleSmartFolderDialog
        initialFilters={{ manualTagIds: ['selected'] }}
        manualTags={manualTags}
        aiTags={aiTags}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const manualPicker = screen.getByRole('group', { name: '人工标签条件' });
    expect(within(manualPicker).getByRole('button', { name: '移除已选标签 灵感' })).toBeVisible();
    expect(
      within(manualPicker)
        .getAllByRole('checkbox')
        .map((checkbox) => checkbox.getAttribute('aria-label')),
    ).toEqual(['灵感', '收藏参考', '全民封面', '夜间氛围']);

    fireEvent.change(within(manualPicker).getByRole('searchbox', { name: '搜索人工标签' }), {
      target: { value: '全民' },
    });
    expect(within(manualPicker).getByRole('checkbox', { name: '全民封面' })).toBeVisible();

    fireEvent.change(within(manualPicker).getByRole('searchbox', { name: '搜索人工标签' }), {
      target: { value: 'yjfw' },
    });

    expect(within(manualPicker).getByRole('checkbox', { name: '夜间氛围' })).toBeVisible();
    expect(within(manualPicker).queryByRole('checkbox', { name: '灵感' })).not.toBeInTheDocument();
    expect(within(manualPicker).getByRole('button', { name: '移除已选标签 灵感' })).toBeVisible();
  });

  it('shows usage counts and searches AI tags by full pinyin', () => {
    render(
      <EagleSmartFolderDialog
        initialFilters={{}}
        manualTags={manualTags}
        aiTags={aiTags}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const manualPicker = screen.getByRole('group', { name: '人工标签条件' });
    expect(within(manualPicker).getByText('603')).toBeVisible();

    const aiPicker = screen.getByRole('group', { name: 'AI 自动标签条件' });
    fireEvent.change(within(aiPicker).getByRole('searchbox', { name: '搜索 AI 自动标签' }), {
      target: { value: 'maotouying' },
    });
    expect(within(aiPicker).getByRole('checkbox', { name: '猫头鹰' })).toBeVisible();
    expect(within(aiPicker).queryByRole('checkbox', { name: '夜景' })).not.toBeInTheDocument();
  });

  it('preserves selections made across searches when saving an edited smart folder', () => {
    const onSave = vi.fn();
    render(
      <EagleSmartFolderDialog
        initialName="常用参考"
        mode="edit"
        initialFilters={{ manualTagIds: ['selected'], aiTagIds: ['owl'] }}
        manualTags={manualTags}
        aiTags={aiTags}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    const manualPicker = screen.getByRole('group', { name: '人工标签条件' });
    fireEvent.change(within(manualPicker).getByRole('searchbox', { name: '搜索人工标签' }), {
      target: { value: 'qmfm' },
    });
    fireEvent.click(within(manualPicker).getByRole('checkbox', { name: '全民封面' }));
    fireEvent.click(screen.getByRole('button', { name: '保存智能文件夹' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '常用参考',
        manualTagIds: ['selected', 'popular'],
        aiTagIds: ['owl'],
      }),
    );
  });
});
