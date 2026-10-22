import { useEffect, useRef, useState } from 'react';
import { IconSearch, IconX } from '@tabler/icons-react';
import { t } from '../../i18n';
import styles from './EagleMobileSearch.module.css';
function readHistory(key: string, persist: boolean): string[] {
  if (!persist) return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value)
      ? value
          .filter(
            (item): item is string =>
              typeof item === 'string' && item.length > 0 && item.length <= 200,
          )
          .slice(0, 12)
      : [];
  } catch {
    return [];
  }
}
export function EagleMobileSearch({
  scopeKey,
  suggestions,
  value,
  onSearch,
  onClose,
  persist = true,
}: {
  scopeKey: string;
  suggestions: string[];
  value: string;
  onSearch: (value: string) => void;
  onClose: () => void;
  persist?: boolean;
}) {
  const key = `sekereagle:search-history:${scopeKey}`;
  const [query, setQuery] = useState(value);
  const [history, setHistory] = useState(() => readHistory(key, persist));
  const [offset, setOffset] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    input.current?.focus();
    return () => element?.close();
  }, []);
  const write = (items: string[]) => {
    setHistory(items);
    if (persist)
      try {
        localStorage.setItem(key, JSON.stringify(items));
      } catch {
        /* Search still works when storage is unavailable. */
      }
  };
  const submit = (text: string) => {
    const clean = text.trim().slice(0, 200);
    if (!clean) {
      onSearch('');
      return;
    }
    write([clean, ...history.filter((item) => item !== clean)].slice(0, 12));
    onSearch(clean);
  };
  const examples = [
    t('全家福'),
    t('海边日落'),
    t('宠物'),
    t('城市夜景'),
    t('花与植物'),
    t('雪景'),
    t('美食'),
    t('山川'),
  ];
  const unique = [...new Set(suggestions.length ? suggestions.filter(Boolean) : examples)];
  const visible = unique.slice(offset, offset + 4);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label={t('搜索')}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(query);
          }}
        >
          <IconSearch size={23} />
          <input
            ref={input}
            type="search"
            aria-label={t('搜索名称或描述画面内容')}
            placeholder={t('搜索名称或描述画面内容')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            enterKeyHint="search"
          />
        </form>
        <button type="button" className={styles.close} aria-label={t('关闭搜索')} onClick={onClose}>
          <IconX size={26} />
        </button>
      </header>
      <div className={styles.content}>
        <section>
          <div className={styles.caption}>
            <h2>{t('您可以搜')}</h2>
            {unique.length > 4 && (
              <button
                type="button"
                onClick={() =>
                  setOffset((current) => (current + 4 >= unique.length ? 0 : current + 4))
                }
              >
                {t('换一换')}
              </button>
            )}
          </div>
          <div className={styles.suggestions}>
            {visible.map((item) => (
              <button key={item} type="button" onClick={() => submit(item)}>
                {item}
              </button>
            ))}
          </div>
          {!visible.length && <p>{t('输入名称、标签或描述画面内容')}</p>}
        </section>
        <section>
          <div className={styles.caption}>
            <h2>{t('搜索历史')}</h2>
            {history.length > 0 && (
              <button type="button" aria-label={t('清空搜索历史')} onClick={() => write([])}>
                {t('清空')}
              </button>
            )}
          </div>
          <div className={styles.history}>
            {history.map((item) => (
              <button
                type="button"
                key={item}
                aria-label={t('搜索 {{value1}}', { value1: item })}
                onClick={() => submit(item)}
              >
                <span className={styles.historyTile}>
                  <IconSearch size={25} />
                </span>
                <span>“{item}”</span>
              </button>
            ))}
          </div>
          {!history.length && <p>{t('暂无搜索历史')}</p>}
        </section>
      </div>
    </dialog>
  );
}
