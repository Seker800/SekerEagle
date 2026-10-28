import { useLibraryWorkspace } from '../../lib/library-workspace';
import { t } from '../../i18n';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconFolderBolt, IconX } from '@tabler/icons-react';
import {
  countActiveEagleFilterRules,
  editableEagleFilterQuery,
  readEagleSemanticIntent,
  createEmptyEagleFilterQuery,
  createEagleFilterRule,
  type EagleFilterQuery,
} from '@sekereagle/eagle-filter-core';
import type { EagleAiTag, EagleManualTag } from '../../lib/eagle-api';

import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { EagleRuleBuilder, type EagleFilterOptions } from './EagleRuleBuilder';
import { EagleAssetThumbnail } from './EagleAssetThumbnail';
import { MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import styles from './EagleSmartFolderDialog.module.css';
interface EagleSmartFolderDialogProps {
  fieldOptions?: EagleFilterOptions;
  accessToken?: string;
  initialQuery: EagleFilterQuery;
  initialName?: string;
  mode?: 'create' | 'edit';
  manualTags: EagleManualTag[];
  aiTags: EagleAiTag[];
  pending?: boolean;
  error?: string;
  onClose: () => void;
  onSave: (input: { name: string; query: EagleFilterQuery }) => void;
}
function createEditableQuery(query: EagleFilterQuery): EagleFilterQuery {
  if (query.semantic || countActiveEagleFilterRules(query) > 0) return query;
  const emptyQuery = createEmptyEagleFilterQuery();
  return {
    ...emptyQuery,
    conditions: emptyQuery.conditions.map((condition) => ({
      ...condition,
      rules: [createEagleFilterRule('MANUAL_TAGS')],
    })),
  };
}
export function EagleSmartFolderDialog({
  fieldOptions,
  accessToken = '',
  initialQuery,
  initialName = '',
  mode = 'create',
  manualTags,
  aiTags,
  pending,
  error,
  onClose,
  onSave,
}: EagleSmartFolderDialogProps) {
  const {
    libraryMode,
    ownerId,
    api: { countEagleAssets },
  } = useLibraryWorkspace();

  const [name, setName] = useState(initialName);
  const [query, setQuery] = useState(() =>
    editableEagleFilterQuery(createEditableQuery(initialQuery)),
  );
  const scheduler = useMemo(() => new MediaLoadScheduler(), []);
  useEffect(() => () => scheduler.clear({ abortActive: true }), [scheduler]);
  const semantic = readEagleSemanticIntent(query);
  const savedQuery = query;
  const deferredQuery = useDebouncedValue(query, 250);
  // Preview media belongs only to this dialog/privacy session, never the shared query cache.
  const previewQuery = useMutation({
    mutationFn: (input: EagleFilterQuery) => countEagleAssets(accessToken, input),
    retry: false,
    gcTime: 0,
  });
  const previewKey = JSON.stringify(savedQuery);
  const resetPreview = previewQuery.reset;
  useEffect(() => resetPreview(), [previewKey, resetPreview]);
  const activeConditionCount = countActiveEagleFilterRules(query);
  const hasActiveDeferredCondition = countActiveEagleFilterRules(deferredQuery) > 0;
  const countQuery = useQuery({
    queryKey: ['eagle', ownerId, libraryMode, 'smart-folder-preview', deferredQuery],
    queryFn: () => countEagleAssets(accessToken, deferredQuery),
    enabled: hasActiveDeferredCondition && !semantic,
    staleTime: 10000,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = name.normalize('NFKC').trim();
    if (!normalized) return;
    onSave({ name: normalized, query: savedQuery });
  };
  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="smart-folder-title"
        aria-describedby="smart-folder-description"
        onSubmit={submit}
      >
        <header>
          <div className={styles.headerIdentity}>
            <span className={styles.headerIcon}>
              <IconFolderBolt size={19} />
            </span>
            <div className={styles.headerCopy}>
              <h2 id="smart-folder-title">
                {mode === 'edit' ? t('修改规则') : t('新建智能文件夹')}
              </h2>
              <p id="smart-folder-description">{t('符合规则的素材会自动出现在这个智能文件夹中')}</p>
            </div>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            data-mobile-back
            aria-label={t('关闭智能文件夹窗口')}
            onClick={onClose}
          >
            <IconX size={19} />
          </button>
        </header>
        <div className={styles.body}>
          <label className={styles.nameField}>
            <span>{t('智能文件夹名称')}</span>
            <input
              autoFocus
              aria-label={t('智能文件夹名称')}
              maxLength={64}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <p className={styles.explainer}>
            {' ' + t('智能文件夹会依据筛选条件，自动把符合条件的素材显示在一起。') + ' '}
          </p>
          <EagleRuleBuilder
            fieldOptions={fieldOptions}
            value={query}
            manualTags={manualTags}
            aiTags={aiTags}
            onChange={setQuery}
          />
          {semantic && (
            <section className={styles.semanticPanel} aria-label={t('画面内容')}>
              <p className={styles.explainer}>
                {t('保存后自动整理匹配结果，新照片处理完成后自动加入。其他筛选条件同时生效。')}
              </p>
              <button
                type="button"
                disabled={!semantic || previewQuery.isPending}
                onClick={() => previewQuery.mutate(savedQuery)}
              >
                {previewQuery.isPending ? t('正在预览…') : t('预览匹配照片')}
              </button>
              {previewQuery.isError || previewQuery.data?.semanticStatus === 'UNAVAILABLE' ? (
                <p role="alert">{t('画面搜索暂时不可用，可以保存并等待后台重试。')}</p>
              ) : null}
              {previewQuery.data?.semanticStatus === 'READY' ? (
                <>
                  <p>{t('匹配预览，最多显示 12 张，不代表全部结果。')}</p>
                  <div className={styles.semanticPreview}>
                    {previewQuery.data.previewItems?.map((asset, order) => (
                      <div key={asset.id}>
                        <EagleAssetThumbnail
                          asset={asset}
                          scheduler={scheduler}
                          order={order}
                          displayWidth={120}
                          alt={asset.displayName}
                        />
                      </div>
                    ))}
                  </div>
                  {!previewQuery.data.previewItems?.length ? (
                    <p>{t('预览样本中暂无匹配照片；保存后会在完整图库中计算结果。')}</p>
                  ) : null}
                </>
              ) : null}
            </section>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </div>
        <footer>
          <span className={styles.conditionSummary} role="status" aria-live="polite">
            {semantic
              ? t('保存后在后台生成，之后打开直接读取结果')
              : activeConditionCount === 0
                ? t('找到 0 项符合规则的素材')
                : countQuery.isLoading
                  ? t('正在计算符合规则的素材…')
                  : countQuery.isError
                    ? t('已启用 {{value1}} 条规则', {
                        value1: activeConditionCount,
                      })
                    : t('找到 {{value1}} 项符合规则的素材', {
                        value1: countQuery.data?.count ?? 0,
                      })}
          </span>
          <div className={styles.footerActions}>
            <button type="button" onClick={onClose}>
              {' ' + t('取消') + ' '}
            </button>
            <button
              className={styles.primary}
              type="submit"
              aria-label={t('保存智能文件夹')}
              disabled={!name.trim() || pending}
            >
              {' ' + t('保存设置') + ' '}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
