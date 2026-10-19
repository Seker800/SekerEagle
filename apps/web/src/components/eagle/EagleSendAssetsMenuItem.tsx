import { useQueryClient } from '@tanstack/react-query';
import { IconSend } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import type { EagleLibraryTransferResult } from '../../lib/eagle-api';

export function EagleSendAssetsMenuItem({
  assetIds,
  ownerId,
  label,
  disabled,
  onSent,
}: {
  assetIds: string[];
  ownerId: string;
  label: string;
  disabled: boolean;
  onSent: (result: EagleLibraryTransferResult) => void | Promise<void>;
}) {
  const {
    api: { sendEagleAssets },
  } = useLibraryWorkspace();
  const queryClient = useQueryClient();
  const operationId = useRef<string | null>(null);
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
    operationId.current ??= crypto.randomUUID();
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await sendEagleAssets('', { assetIds, operationId: operationId.current });
      await queryClient.invalidateQueries({ queryKey: ['eagle', ownerId] });
      if (active.current) await onSent(result);
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
        {pending ? t('正在发送…') : label}
      </button>
      {error && <small role="alert">{error}</small>}
    </>
  );
}
