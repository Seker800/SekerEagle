import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyEagleFilterQuery,
  type EagleFilterQuery,
} from '@sekereagle/eagle-filter-core';
import type { EagleAiTag, EagleManualTag } from '../../lib/eagle-api';
import { EagleSmartFolderDialog } from './EagleSmartFolderDialog';

const countEagleAssetsMock = vi.fn().mockResolvedValue({ count: 327 });

vi.mock('../../lib/eagle-api', () => ({
  countEagleAssets: (...args: unknown[]) => countEagleAssetsMock(...args),
}));

const manualTags: EagleManualTag[] = [
  {
    id: 'kit',
    name: 'KIT',
    color: null,
    groupId: null,
    groupIds: [],
    isStarred: false,
    rowVersion: 1,
    assetCount: 327,
    pinyin: 'kit',
    pinyinInitials: 'kit',
  },
];
const aiTags: EagleAiTag[] = [
  { id: 'industrial', name: '工业', assetCount: 18, pinyin: 'gongye', pinyinInitials: 'gy' },
];

function renderDialog(
  onSave = vi.fn(),
  options: {
    initialQuery?: EagleFilterQuery;
    mode?: 'create' | 'edit';
  } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    onSave,
    ...render(
      <QueryClientProvider client={queryClient}>
        <EagleSmartFolderDialog
          initialName="KIT"
          initialQuery={options.initialQuery ?? createEmptyEagleFilterQuery()}
          mode={options.mode}
          manualTags={manualTags}
          aiTags={aiTags}
          onClose={vi.fn()}
          onSave={onSave}
        />
      </QueryClientProvider>,
    ),
  };
}

describe('EagleSmartFolderDialog', () => {
  it.each(['create', 'edit'] as const)(
    'turns an empty %s query into an editable blank filter rule',
    (mode) => {
      const onSave = vi.fn();
      renderDialog(onSave, { initialQuery: { version: 2, conditions: [] }, mode });

      const builder = screen.getByLabelText('筛选规则编辑器');
      expect(within(builder).getByRole('region', { name: '条件组 1' })).toBeVisible();
      fireEvent.change(within(builder).getByRole('combobox', { name: '规则 1 字段' }), {
        target: { value: 'FORMAT' },
      });
      fireEvent.click(screen.getByRole('button', { name: '保存智能文件夹' }));

      expect(onSave).toHaveBeenCalledWith({
        name: 'KIT',
        query: expect.objectContaining({
          conditions: [
            expect.objectContaining({
              rules: [expect.objectContaining({ field: 'FORMAT' })],
            }),
          ],
        }),
      });
    },
  );

  it('shows the Eagle-style rule sentence and live result count', async () => {
    renderDialog();

    const group = screen.getByRole('region', { name: '条件组 1' });
    expect(within(group).getByRole('combobox', { name: '条件组 1 匹配方式' })).toHaveValue('ANY');
    expect(within(group).getByRole('combobox', { name: '条件组 1 结果方式' })).toHaveValue('MATCH');
    expect(within(group).getByRole('combobox', { name: '规则 1 字段' })).toHaveValue('NAME');
    expect(within(group).getByRole('combobox', { name: '规则 1 运算符' })).toHaveValue('CONTAINS');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('找到 327 项符合规则的素材'),
    );
  });

  it('adds a rule, changes its field and saves the versioned query', () => {
    const { onSave } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: '在规则 1 后添加规则' }));
    fireEvent.change(screen.getByRole('combobox', { name: '规则 2 字段' }), {
      target: { value: 'FORMAT' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '格式值' }), {
      target: { value: 'webp' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存智能文件夹' }));

    expect(onSave).toHaveBeenCalledWith({
      name: 'KIT',
      query: expect.objectContaining({
        version: 2,
        conditions: [
          expect.objectContaining({
            rules: [
              expect.objectContaining({ field: 'NAME', operator: 'CONTAINS' }),
              expect.objectContaining({ field: 'FORMAT', operator: 'EQUALS', value: 'webp' }),
            ],
          }),
        ],
      }),
    });
  });

  it('supports negated groups and tag token values', () => {
    renderDialog();
    fireEvent.change(screen.getByRole('combobox', { name: '条件组 1 结果方式' }), {
      target: { value: 'NOT_MATCH' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '规则 1 字段' }), {
      target: { value: 'MANUAL_TAGS' },
    });
    fireEvent.click(screen.getByText('选择标签…'));
    fireEvent.click(screen.getByRole('checkbox', { name: /KIT/ }));

    expect(within(screen.getByLabelText('选择标签')).getByText('KIT')).toBeVisible();
    expect(screen.getByRole('combobox', { name: '条件组 1 结果方式' })).toHaveValue('NOT_MATCH');
  });
});
