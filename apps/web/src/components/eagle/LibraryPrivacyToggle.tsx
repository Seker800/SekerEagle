import { useEffect, useRef, useState } from 'react';
import { IconLock, IconLockOpen } from '@tabler/icons-react';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import type { PrivacyVisibilityState } from '../../lib/privacy-visibility-api';
import { t } from '../../i18n';

/** Uses the existing scoped grant; navigation never precedes server confirmation. */
export function LibraryPrivacyToggle({
  value,
  onChange,
  onOpen,
}: {
  value: PrivacyVisibilityState;
  onChange: (value: PrivacyVisibilityState) => void;
  onOpen: () => void;
}) {
  const { api } = useLibraryWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function toggle() {
    if (busy.current) return;
    busy.current = true;
    const epoch = generation.current;
    setPending(true);
    setError('');
    try {
      const next = await api.updatePrivacyVisibility(!value.enabled, value.durationHours);
      if (epoch !== generation.current) return;
      onChange(next);
      if (next.enabled) onOpen();
    } catch (cause) {
      if (epoch === generation.current)
        setError(cause instanceof Error ? cause.message : t('更新隐私设置失败'));
    } finally {
      busy.current = false;
      if (epoch === generation.current) setPending(false);
    }
  }
  return (
    <>
      <button
        type="button"
        aria-pressed={value.enabled}
        disabled={pending}
        onClick={() => void toggle()}
      >
        {value.enabled ? <IconLockOpen size={17} /> : <IconLock size={17} />}
        {pending ? t('保存中…') : value.enabled ? t('隐藏隐私内容') : t('显示隐私内容')}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
