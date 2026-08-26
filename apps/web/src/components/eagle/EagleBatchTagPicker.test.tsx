import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EagleManualTag } from '../../lib/eagle-api';
import { EagleBatchTagPicker } from './EagleBatchTagPicker';

function tag(id: string, name: string, pinyin = name, pinyinInitials = name): EagleManualTag {
  return {
    id,
    name,
    color: null,
    groupId: null,
    groupIds: [],
    isStarred: false,
    rowVersion: 1,
    assetCount: 0,
    pinyin,
    pinyinInitials,
  };
}

describe('EagleBatchTagPicker', () => {
  it('searches a large tag collection by pinyin initials and applies multiple tags once', () => {
    const onApply = vi.fn();
    const tags = [
      tag('inspiration', '灵感', 'ling gan', 'lg'),
      tag('night', '夜间氛围', 'ye jian fen wei', 'yjfw'),
      ...Array.from({ length: 98 }, (_, index) => tag(`tag-${index}`, `标签 ${index}`)),
    ];

    render(<EagleBatchTagPicker assetCount={3} tags={tags} onApply={onApply} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: '添加标签' });
    expect(within(dialog).getAllByRole('checkbox').length).toBeLessThan(30);
    fireEvent.change(within(dialog).getByRole('searchbox', { name: '搜索可添加标签' }), {
      target: { value: 'yjfw' },
    });
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '夜间氛围' }));

    fireEvent.change(within(dialog).getByRole('searchbox', { name: '搜索可添加标签' }), {
      target: { value: 'lg' },
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '灵感' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '添加 2 个标签到 3 项素材' }));

    expect(onApply).toHaveBeenCalledWith(['night', 'inspiration']);
  });

  it('creates a missing tag, selects it and includes it in the batch apply', async () => {
    const onApply = vi.fn();
    const onCreate = vi.fn().mockResolvedValue(tag('new-tag', '新标签', 'xin biaoqian', 'xbq'));

    render(
      <EagleBatchTagPicker
        assetCount={2}
        tags={[tag('inspiration', '灵感', 'ling gan', 'lg')]}
        onApply={onApply}
        onCreate={onCreate}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '添加标签' });
    fireEvent.change(within(dialog).getByRole('searchbox', { name: '搜索可添加标签' }), {
      target: { value: '新标签' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建标签 新标签' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('新标签'));
    expect(within(dialog).getByRole('checkbox', { name: '新标签' })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: '添加 1 个标签到 2 项素材' }));
    expect(onApply).toHaveBeenCalledWith(['new-tag']);
  });

  it('does not offer to recreate an existing tag with the same normalized name', () => {
    render(
      <EagleBatchTagPicker
        assetCount={1}
        tags={[tag('inspiration', '灵感', 'ling gan', 'lg')]}
        onApply={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '添加标签' });
    fireEvent.change(within(dialog).getByRole('searchbox', { name: '搜索可添加标签' }), {
      target: { value: '  灵感  ' },
    });
    expect(within(dialog).queryByRole('button', { name: '创建标签 灵感' })).not.toBeInTheDocument();
  });

  it('does not offer to create a pinyin query when it already matches a tag', () => {
    render(
      <EagleBatchTagPicker
        assetCount={1}
        tags={[tag('night', '夜间氛围', 'ye jian fen wei', 'yjfw')]}
        onApply={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '添加标签' });
    fireEvent.change(within(dialog).getByRole('searchbox', { name: '搜索可添加标签' }), {
      target: { value: 'yjfw' },
    });
    expect(within(dialog).getByRole('checkbox', { name: '夜间氛围' })).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: '创建标签 yjfw' })).not.toBeInTheDocument();
  });

  it('removes selected manual tags and shows their coverage in the current asset selection', () => {
    const onApply = vi.fn();

    render(
      <EagleBatchTagPicker
        mode="remove"
        assetCount={2}
        tags={[
          tag('inspiration', '灵感', 'ling gan', 'lg'),
          tag('night', '夜间氛围', 'ye jian fen wei', 'yjfw'),
        ]}
        selectedAssetCountByTagId={{ inspiration: 2, night: 1 }}
        onApply={onApply}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '删除人工标签' });
    expect(within(dialog).getByText('灵感 · 2/2')).toBeInTheDocument();
    expect(within(dialog).getByText('夜间氛围 · 1/2')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /创建标签/ })).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole('searchbox', { name: '搜索可删除标签' }), {
      target: { value: 'lg' },
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '灵感' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '从 2 项素材删除 1 个标签' }));

    expect(onApply).toHaveBeenCalledWith(['inspiration']);
  });
});
