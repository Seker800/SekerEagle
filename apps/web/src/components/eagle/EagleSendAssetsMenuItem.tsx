import { IconSend } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { useEnqueueAssetOperation } from './useAssetOperations';
import type { AssetOperationSummary } from '@sekereagle/library-core';

export function EagleSendAssetsMenuItem({
  assetIds,
  label,
  disabled,
  onQueued,
}: {
  assetIds: string[];
  label: string;
  disabled: boolean;
  onQueued: (result: AssetOperationSummary) => void | Promise<void>;
}) {
  const enqueue = useEnqueueAssetOperation();
  const active = useRef(true),
    pendingRef = useRef(false);
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function send() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await enqueue('SEND', assetIds);
      if (active.current) await onQueued(result);
    } catch (cause) {
      if (active.current)
        setError(cause instanceof Error ? cause.message : t('发送失败，请重试。'));
    } finally {
      pendingRef.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <>
      <button
        type="button"
        role="menuitem"
        aria-label={label}
        disabled={disabled || pending}
        onClick={() => void send()}
      >
        <IconSend size={15} />
        {pending ? t('提交中…') : label}
      </button>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
