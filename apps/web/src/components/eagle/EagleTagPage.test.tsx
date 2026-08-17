import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EagleAiTag, EagleManualTag, EagleManualTagGroup } from '../../lib/eagle-api';
import { EagleTagPage } from './EagleTagPage';

const manualTags: EagleManualTag[] = [
  {
    id: 'tag-reference',
    name: 'Reference',
    color: '#d69b48',
    groupId: 'group-purpose',
    groupIds: ['group-purpose'],
    isStarred: true,
    rowVersion: 1,
    assetCount: 12,
    pinyin: 'reference',
    pinyinInitials: 'r',
  },
  {
    id: 'tag-ui',
    name: 'UI 界面',
    color: null,
    groupId: null,
    groupIds: [],
    isStarred: false,
    rowVersion: 1,
    assetCount: 3,
    pinyin: 'uijiemian',
    pinyinInitials: 'uijm',
  },
];

const aiTags: EagleAiTag[] = [
  { id: 'ai-owl', name: '猫头鹰', assetCount: 8, pinyin: 'maotouying', pinyinInitials: 'mty' },
  { id: 'ai-night', name: 'night', assetCount: 0, pinyin: 'night', pinyinInitials: 'n' },
];

const groups: EagleManualTagGroup[] = [
  {
    id: 'group-purpose',
    name: '用途',
    color: '#d69b48',
    description: null,
    rowVersion: 1,
    tagCount: 1,
  },
];

function renderManualPage(overrides: Partial<Parameters<typeof EagleTagPage>[0]> = {}) {
  const props: Parameters<typeof EagleTagPage>[0] = {
    kind: 'MANUAL',
    manualTags,
    aiTags,
    manualTagGroups: groups,
    onCreateManualTag: vi.fn(),
    onCreateManualTagGroup: vi.fn(),
    onUpdateManualTags: vi.fn(),
    onDeleteManualTags: vi.fn(),
    onUpdateManualTagGroup: vi.fn(),
    onDeleteManualTagGroup: vi.fn(),
    onSelectTag: vi.fn(),
    ...overrides,
  };
  render(<EagleTagPage {...props} />);
  return props;
}

describe('EagleTagPage', () => {
  it('renders the manual tag management workbench with scopes and groups', () => {
    renderManualPage();

    const page = screen.getByRole('region', { name: '人工标签管理' });
    expect(within(page).getByRole('navigation', { name: '人工标签导航' })).toHaveTextContent(
      '全部标签',
    );
    expect(page).toHaveTextContent('未分类');
    expect(page).toHaveTextContent('常用标签');
    expect(page).toHaveTextContent('标签组');
    expect(page).toHaveTextContent('用途');
    expect(within(page).getByRole('button', { name: /人工标签 Reference/ })).toBeInTheDocument();
  });

  it('filters tags, sorts by count and switches to list view', () => {
    renderManualPage();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索人工标签' }), {
      target: { value: 'ui' },
    });
    expect(screen.queryByRole('button', { name: /人工标签 Reference/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /人工标签 UI 界面/ })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: '标签排序' }), {
      target: { value: 'COUNT_DESC' },
    });
    fireEvent.click(screen.getByRole('button', { name: '列表视图' }));
    expect(screen.getByRole('list', { name: '人工标签目录' })).toHaveAttribute(
      'data-layout',
      'list',
    );
  });

  it('selects a tag on click and opens its assets on double click', () => {
    const onSelectTag = vi.fn();
    renderManualPage({ onSelectTag });
    const tag = screen.getByRole('button', { name: /人工标签 Reference/ });

    fireEvent.click(tag);
    expect(tag).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('已选择 1 个')).toBeInTheDocument();
    expect(onSelectTag).not.toHaveBeenCalled();

    fireEvent.doubleClick(tag);
    expect(onSelectTag).toHaveBeenCalledWith('tag-reference');
  });

  it('moves and stars selected manual tags through management actions', () => {
    const onUpdateManualTags = vi.fn();
    renderManualPage({ onUpdateManualTags });
    fireEvent.click(screen.getByRole('button', { name: /人工标签 UI 界面/ }));

    fireEvent.click(screen.getByRole('button', { name: '设为常用' }));
    expect(onUpdateManualTags).toHaveBeenCalledWith([expect.objectContaining({ id: 'tag-ui' })], {
      isStarred: true,
    });

    fireEvent.change(screen.getByRole('combobox', { name: '移动到标签组' }), {
      target: { value: 'group-purpose' },
    });
    expect(onUpdateManualTags).toHaveBeenCalledWith([expect.objectContaining({ id: 'tag-ui' })], {
      groupId: 'group-purpose',
    });
  });

  it('reuses the same directory workbench for read-only AI tags', () => {
    const onSelectTag = vi.fn();
    render(
      <EagleTagPage
        kind="AI"
        manualTags={manualTags}
        aiTags={aiTags}
        manualTagGroups={groups}
        onCreateManualTag={vi.fn()}
        onCreateManualTagGroup={vi.fn()}
        onUpdateManualTags={vi.fn()}
        onDeleteManualTags={vi.fn()}
        onUpdateManualTagGroup={vi.fn()}
        onDeleteManualTagGroup={vi.fn()}
        onSelectTag={onSelectTag}
      />,
    );

    const page = screen.getByRole('region', { name: 'AI 标签管理' });
    expect(within(page).getByRole('navigation', { name: 'AI 标签导航' })).toHaveTextContent(
      '全部标签',
    );
    expect(page).toHaveTextContent('已使用');
    expect(page).toHaveTextContent('未使用');
    expect(screen.getByRole('searchbox', { name: '搜索AI标签' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '设为常用' })).not.toBeInTheDocument();

    fireEvent.doubleClick(screen.getByRole('button', { name: /AI标签 猫头鹰/ }));
    expect(onSelectTag).toHaveBeenCalledWith('ai-owl');
  });

  it('groups Chinese tags into A-Z by phrase-aware pinyin instead of a Chinese fallback', () => {
    render(
      <EagleTagPage
        kind="AI"
        manualTags={manualTags}
        aiTags={[
          {
            id: 'ai-changchun',
            name: '长春',
            assetCount: 1,
            pinyin: 'changchun',
            pinyinInitials: 'cc',
          },
          {
            id: 'ai-chongqing',
            name: '重庆',
            assetCount: 1,
            pinyin: 'chongqing',
            pinyinInitials: 'cq',
          },
          {
            id: 'ai-material',
            name: 'Material',
            assetCount: 1,
            pinyin: 'material',
            pinyinInitials: 'm',
          },
          {
            id: 'ai-owl',
            name: '猫头鹰',
            assetCount: 1,
            pinyin: 'maotouying',
            pinyinInitials: 'mty',
          },
          { id: 'ai-number', name: '42', assetCount: 1, pinyin: '42', pinyinInitials: '4' },
          {
            id: 'ai-symbol',
            name: '✨灵感',
            assetCount: 1,
            pinyin: 'linggan',
            pinyinInitials: 'lg',
          },
        ]}
        manualTagGroups={groups}
        onCreateManualTag={vi.fn()}
        onCreateManualTagGroup={vi.fn()}
        onUpdateManualTags={vi.fn()}
        onDeleteManualTags={vi.fn()}
        onUpdateManualTagGroup={vi.fn()}
        onDeleteManualTagGroup={vi.fn()}
        onSelectTag={vi.fn()}
      />,
    );

    const directory = screen.getByRole('list', { name: 'AI标签目录' });
    expect(within(directory).getByText('C', { selector: 'span' })).toBeInTheDocument();
    expect(within(directory).getByText('M', { selector: 'span' })).toBeInTheDocument();
    expect(within(directory).getByText('0–9', { selector: 'span' })).toBeInTheDocument();
    expect(within(directory).getByText('其他', { selector: 'span' })).toBeInTheDocument();
    expect(within(directory).queryByText('中文与其他')).not.toBeInTheDocument();

    const cSection = within(directory).getByText('C', { selector: 'span' }).closest('li');
    expect(cSection).not.toBeNull();
    expect(
      within(cSection!)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([expect.stringContaining('长春'), expect.stringContaining('重庆')]);
  });

  it('finds Chinese tags by full pinyin and pinyin initials', () => {
    render(
      <EagleTagPage
        kind="AI"
        manualTags={manualTags}
        aiTags={aiTags}
        manualTagGroups={groups}
        onCreateManualTag={vi.fn()}
        onCreateManualTagGroup={vi.fn()}
        onUpdateManualTags={vi.fn()}
        onDeleteManualTags={vi.fn()}
        onUpdateManualTagGroup={vi.fn()}
        onDeleteManualTagGroup={vi.fn()}
        onSelectTag={vi.fn()}
      />,
    );

    const search = screen.getByRole('searchbox', { name: '搜索AI标签' });
    fireEvent.change(search, { target: { value: 'maotouying' } });
    expect(screen.getByRole('button', { name: /AI标签 猫头鹰/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /AI标签 night/ })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'mty' } });
    expect(screen.getByRole('button', { name: /AI标签 猫头鹰/ })).toBeInTheDocument();
  });
});
