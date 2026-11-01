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
  SEND: (mode: LibraryMode) => (mode === 'PHOTO' ? t('发送到素材') : t('发送到照片')),
  TRASH: () => t('移入回收站'),
  RESTORE: () => t('恢复'),
  EMPTY_TRASH: () => t('清空回收站'),
  DUPLICATE_SCAN: () => t('检查重复图片'),
  DUPLICATE_CLEANUP: () => t('清理重复项'),
} satisfies Record<AssetOperationKind, (mode: LibraryMode) => string>;

/** Unknown server kinds remain visible without borrowing another operation's effects. */
export function operationKindPresentation(kind: string, mode: LibraryMode): Presentation {
  const protocol = assetOperationProtocol(kind);
  if (!protocol)
    return {
      title: t('不支持的操作类型'),
      executable: false,
      optimisticMembership: 'NONE',
      compensation: null,
    };
  return {
    title: titles[kind as AssetOperationKind](mode),
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
