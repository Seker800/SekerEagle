import { assetOperationProtocol, type AssetOperationKind } from '@sekereagle/library-core';
import { t } from '../../i18n';
import type { LibraryMode } from '../../lib/library-api-scope';

type Presentation = {
  title: string;
  executable: boolean;
  optimisticMembership: 'HIDE_ACTIVE' | 'HIDE_TRASH' | 'NONE';
  compensation: 'RESTORE' | null;
};
const titles = {
  METADATA_COMMAND: () => t('更新信息'),
  BACKGROUND_COMMAND: () => t('后台任务'),
  SEND: (mode: LibraryMode) => (mode === 'PHOTO' ? t('发送到素材') : t('发送到照片')),
  TRASH: () => t('移入回收站'),
  RESTORE: () => t('恢复'),
  EMPTY_TRASH: () => t('清空回收站'),
  DUPLICATE_SCAN: () => t('检查重复图片'),
  DUPLICATE_CLEANUP: () => t('清理重复项'),
} satisfies Record<AssetOperationKind, (mode: LibraryMode) => string>;

const commandTitles = new Map<string, () => string>([
  ['DUPLICATE_IGNORE', () => t('检查重复图片')],
  ['ASSET_TAGS', () => t('人工标签')],
  ['ASSET_TAGS_REPLACE', () => t('人工标签')],
  ['TAG_UPDATE', () => t('人工标签')],
  ['TAG_DELETE', () => t('人工标签')],
  ['TAG_GROUP_DELETE', () => t('人工标签')],
  ['PRIVACY_SETTINGS', () => t('保存私密标签')],
  ['VECTOR_REVIEW', () => t('人工标签')],
  ['VECTOR_SCAN_MISSING', () => t('图片向量')],
  ['VECTOR_SCAN_UNCLASSIFIED', () => t('扫描无标签图片')],
  ['VECTOR_RETRY_FAILED', () => t('图片向量')],
  ['PHOTO_PEOPLE_SCAN', () => t('分析人物')],
  ['PHOTO_PERSON_RENAME', () => t('人物')],
  ['PHOTO_PERSON_PRIVACY', () => t('私密人物')],
  ['PHOTO_PEOPLE_MERGE', () => t('合并人物')],
  ['PHOTO_PEOPLE_MERGE_SELECTED', () => t('合并所选分组')],
  ['PHOTO_PEOPLE_REVIEW', () => t('相似人物确认')],
  ['PHOTO_FACE_REASSIGN', () => t('人物')],
  ['PHOTO_GROUPS_SCAN', () => t('照片')],
  ['PHOTO_GROUP_CREATE', () => t('照片')],
  ['PHOTO_GROUP_REMOVE_MEMBERS', () => t('照片')],
  ['PHOTO_GROUP_MERGE', () => t('照片')],
  ['PHOTO_GROUP_UPDATE', () => t('照片')],
  ['PHOTO_AGENT_REVIEW_BATCH', () => t('智能整理')],
  ['PHOTO_AGENT_REVIEW', () => t('智能整理')],
  ['PHOTO_AGENT_UNDO', () => t('智能整理')],
  ['PHOTO_AGENT_MANUAL', () => t('智能整理')],
  ['BATCH_EDIT_RENDER', () => t('批量套用编辑参数')],
]);

/** Unknown server kinds remain visible without borrowing another operation's effects. */
export function operationKindPresentation(
  kind: string,
  mode: LibraryMode,
  commandType?: string,
): Presentation {
  const protocol = assetOperationProtocol(kind);
  if (!protocol)
    return {
      title: t('不支持的操作类型'),
      executable: false,
      optimisticMembership: 'NONE',
      compensation: null,
    };
  return {
    title:
      ((kind === 'METADATA_COMMAND' || kind === 'BACKGROUND_COMMAND') && commandType
        ? commandTitles.get(commandType)?.()
        : undefined) ?? titles[kind as AssetOperationKind](mode),
    executable: true,
    optimisticMembership:
      protocol.membership === 'TRASH'
        ? 'HIDE_ACTIVE'
        : protocol.membership === 'ACTIVE'
          ? 'HIDE_TRASH'
          : 'NONE',
    compensation: protocol.compensation,
  };
}
