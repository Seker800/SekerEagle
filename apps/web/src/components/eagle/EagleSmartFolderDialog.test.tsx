import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyEagleFilterQuery, type EagleFilterQuery } from '@sekereagle/eagle-filter-core';
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
    lastUsedAt: null,
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
  it('saves semantic-only folders and preserves the intent while editing ordinary rules', () => {
    const { onSave } = renderDialog();
    fireEvent.change(screen.getByRole('combobox', { name: '规则 1 字段' }), {
      target: { value: 'SEMANTIC' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '画面描述' }), {
      target: { value: '海边日落' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: '匹配范围' }), {
      target: { value: 'STRICT' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存智能文件夹' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          conditions: [
            expect.objectContaining({
              rules: [
                expect.objectContaining({
                  field: 'SEMANTIC',
                  value: '海边日落',
                  breadth: 'STRICT',
                }),
              ],
            }),
          ],
        }),
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('保存后在后台生成');
  });

  it('edits scene content inside the same ANY/NOT_MATCH group as camera rules', () => {
    const { onSave } = renderDialog(vi.fn(), {
      initialQuery: {
        version: 2,
        conditions: [
          {
            id: 'g',
            match: 'ANY',
            result: 'NOT_MATCH',
            rules: [
              {
                id: 'scene',
                field: 'SEMANTIC',
                operator: 'SIMILAR',
                value: '海边',
                breadth: 'BROAD',
              },
              { id: 'camera', field: 'CAMERA_MODEL', operator: 'EMPTY' },
            ],
          },
        ],
      },
    });
    const group = screen.getByRole('region', { name: '条件组 1' });
    expect(within(group).getByRole('textbox', { name: '画面描述' })).toHaveValue('海边');
    expect(within(group).getByRole('combobox', { name: '规则 2 运算符' })).toHaveDisplayValue(
      '无参数',
    );
    fireEvent.change(within(group).getByRole('textbox', { name: '画面描述' }), {
      target: { value: '城市' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存智能文件夹' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          conditions: [
            expect.objectContaining({
              match: 'ANY',
              result: 'NOT_MATCH',
              rules: [
                expect.objectContaining({ field: 'SEMANTIC', value: '城市' }),
                expect.objectContaining({ field: 'CAMERA_MODEL', operator: 'EMPTY' }),
              ],
            }),
          ],
        }),
      }),
    );
  });

  it('restores semantic-only intent and can explicitly remove it', () => {
    const { onSave } = renderDialog(vi.fn(), {
      initialQuery: { version: 2, conditions: [], semantic: { text: '雨天', breadth: 'BROAD' } },
    });
    expect(screen.getByRole('textbox', { name: '画面描述' })).toHaveValue('雨天');
    expect(screen.getByRole('combobox', { name: '匹配范围' })).toHaveValue('BROAD');
    fireEvent.change(screen.getByRole('textbox', { name: '画面描述' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存智能文件夹' }));
    expect(onSave).toHaveBeenCalledWith({
      name: 'KIT',
      query: expect.objectContaining({
        version: 2,
        conditions: [
          expect.objectContaining({
            rules: [expect.objectContaining({ field: 'SEMANTIC', value: '' })],
          }),
        ],
      }),
    });
  });

  it('only requests a semantic preview after an explicit click and reports model unavailability', async () => {
    countEagleAssetsMock.mockClear();
    countEagleAssetsMock.mockResolvedValueOnce({
      count: null,
      semanticStatus: 'UNAVAILABLE',
      previewItems: [],
    });
    renderDialog(vi.fn(), {
      initialQuery: { version: 2, conditions: [], semantic: { text: '海边', breadth: 'BALANCED' } },
    });
    expect(countEagleAssetsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '预览匹配照片' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('可以保存并等待后台重试');
    expect(countEagleAssetsMock).toHaveBeenCalledTimes(1);
  });

  it('discards semantic preview results when the dialog closes', async () => {
    countEagleAssetsMock.mockResolvedValueOnce({
      count: null,
      semanticStatus: 'READY',
      previewItems: [],
    });
    const options = {
      initialQuery: {
        version: 2 as const,
        conditions: [],
        semantic: { text: '海边', breadth: 'BALANCED' as const },
      },
    };
    const first = renderDialog(vi.fn(), options);
    fireEvent.click(screen.getByRole('button', { name: '预览匹配照片' }));
    expect(await screen.findByText('匹配预览，最多显示 12 张，不代表全部结果。')).toBeVisible();
    first.unmount();
    renderDialog(vi.fn(), options);
    expect(
      screen.queryByText('匹配预览，最多显示 12 张，不代表全部结果。'),
    ).not.toBeInTheDocument();
  });

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

  it('shows zero results without requesting a count when no rule is active', () => {
    countEagleAssetsMock.mockClear();
    renderDialog();

    expect(screen.getByRole('status')).toHaveTextContent('找到 0 项符合规则的素材');
    expect(countEagleAssetsMock).not.toHaveBeenCalled();
  });

  it.each(['删除规则 1', '删除条件组 1'])(
    'allows the final filter to be removed through “%s” and saves an explicitly empty query',
    (removeAction) => {
      const onSave = vi.fn();
      renderDialog(onSave, {
        initialQuery: {
          version: 2,
          conditions: [
            {
              id: 'condition-format',
              match: 'ANY',
              result: 'MATCH',
              rules: [
                {
                  id: 'rule-format',
                  field: 'FORMAT',
                  operator: 'EQUALS',
                  value: 'png',
                },
              ],
            },
          ],
        },
      });

      fireEvent.click(screen.getByRole('button', { name: removeAction }));

      expect(screen.queryByRole('region', { name: '条件组 1' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '添加筛选条件' })).toBeVisible();
      expect(screen.getByRole('status')).toHaveTextContent('找到 0 项符合规则的素材');

      fireEvent.click(screen.getByRole('button', { name: '保存智能文件夹' }));
      expect(onSave).toHaveBeenCalledWith({
        name: 'KIT',
        query: { version: 2, conditions: [] },
      });
    },
  );

  it('shows the Eagle-style rule sentence and live result count for an active rule', async () => {
    countEagleAssetsMock.mockClear();
    renderDialog();

    const group = screen.getByRole('region', { name: '条件组 1' });
    expect(within(group).getByRole('combobox', { name: '条件组 1 匹配方式' })).toHaveValue('ANY');
    expect(within(group).getByRole('combobox', { name: '条件组 1 结果方式' })).toHaveValue('MATCH');
    expect(within(group).getByRole('combobox', { name: '规则 1 字段' })).toHaveValue('MANUAL_TAGS');
    expect(within(group).getByRole('combobox', { name: '规则 1 运算符' })).toHaveValue('ALL_OF');
    expect(within(group).getByText('选择标签…')).toBeVisible();

    fireEvent.click(within(group).getByText('选择标签…'));
    fireEvent.click(screen.getByRole('checkbox', { name: /KIT/ }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('找到 327 项符合规则的素材'),
    );
    expect(countEagleAssetsMock).toHaveBeenCalledTimes(1);
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
              expect.objectContaining({ field: 'MANUAL_TAGS', operator: 'ALL_OF' }),
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
    fireEvent.click(screen.getByText('选择标签…'));
    fireEvent.click(screen.getByRole('checkbox', { name: /KIT/ }));

    expect(within(screen.getByLabelText('选择标签')).getByText('KIT')).toBeVisible();
    expect(screen.getByRole('combobox', { name: '条件组 1 结果方式' })).toHaveValue('NOT_MATCH');
  });

  it('preserves a meaningful initial name rule instead of replacing it with the tag default', () => {
    renderDialog(vi.fn(), {
      initialQuery: {
        version: 2,
        conditions: [
          {
            id: 'condition-existing',
            match: 'ANY',
            result: 'MATCH',
            rules: [
              {
                id: 'rule-existing',
                field: 'NAME',
                operator: 'CONTAINS',
                value: '海报',
              },
            ],
          },
        ],
      },
    });

    expect(screen.getByRole('combobox', { name: '规则 1 字段' })).toHaveValue('NAME');
    expect(screen.getByRole('textbox', { name: '名称值' })).toHaveValue('海报');
  });
});
