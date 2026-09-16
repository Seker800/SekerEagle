import { getLocale, t } from '../../i18n';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  IconCheck,
  IconCopy,
  IconKey,
  IconEye,
  IconLock,
  IconLogout,
  IconRefresh,
  IconTags,
  IconTrash,
} from '@tabler/icons-react';
import { request } from '../../lib/api-client';
import type { User } from '../../App';
import {
  DEFAULT_PRIVACY_VISIBILITY,
  getPrivacyVisibility,
  updatePrivacyVisibility,
  type PrivacyVisibilityState,
} from '../../lib/privacy-visibility-api';
import {
  getEaglePrivacySettings,
  listEaglePrivacyTagOptions,
  updateEaglePrivacySettings,
  type EaglePrivacyTagOption,
} from '../../lib/eagle-privacy-api';
import { getDesktopCacheBridge } from '../../lib/media-resolver';
interface PersonalAccessToken {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}
interface CreatedToken extends Omit<PersonalAccessToken, 'revokedAt' | 'lastUsedAt'> {
  token: string;
}
function formatDate(value: string | null): string {
  if (!value) return t('从未使用');
  return new Intl.DateTimeFormat(getLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}
function getTokenStatus(token: PersonalAccessToken): 'active' | 'expired' | 'revoked' {
  if (token.revokedAt) return 'revoked';
  return token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()
    ? 'expired'
    : 'active';
}
function formatTokenExpiry(expiresAt: string | null): string {
  return expiresAt ? formatDate(expiresAt) : t('永久有效');
}
const statusLabels = {
  active: t('有效'),
  expired: t('已过期'),
  revoked: t('已撤销'),
} as const;
const tokenPurposes = {
  capture: {
    label: t('SekerEagle 灵感采集'),
    defaultName: t('SekerEagle 灵感采集'),
    scopes: ['capture:write'],
  },
  importer: {
    label: t('Eagle 图库导入'),
    defaultName: t('Eagle 导入器'),
    scopes: ['import:read', 'import:write', 'asset:write'],
  },
} as const;
type AccountSection = 'OVERVIEW' | 'PRIVACY' | 'CONNECTIONS' | 'SECURITY';
const ACCOUNT_SECTIONS: ReadonlyArray<{ id: AccountSection; label: string }> = [
  { id: 'OVERVIEW', label: t('概览') },
  { id: 'PRIVACY', label: t('隐私') },
  { id: 'CONNECTIONS', label: t('连接') },
  { id: 'SECURITY', label: t('安全') },
];
export function AccountHome({
  user,
  onPasswordChanged,
  onLogout,
  privacyVisibility: providedPrivacyVisibility,
  onPrivacyVisibilityChange,
  onPrivacyRulesChange,
}: {
  user: User;
  onPasswordChanged: () => Promise<void>;
  onLogout: () => void;
  privacyVisibility?: PrivacyVisibilityState;
  onPrivacyVisibilityChange?: (state: PrivacyVisibilityState) => void;
  onPrivacyRulesChange?: () => void;
}) {
  const [activeSection, setActiveSection] = useState<AccountSection>('OVERVIEW');
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [tokenError, setTokenError] = useState('');
  const [tokenPurpose, setTokenPurpose] = useState<keyof typeof tokenPurposes>('capture');
  const [tokenName, setTokenName] = useState<string>(tokenPurposes.capture.defaultName);
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);
  const createdTokenInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [localPrivacyVisibility, setLocalPrivacyVisibility] = useState(DEFAULT_PRIVACY_VISIBILITY);
  const [privacyLoading, setPrivacyLoading] = useState(providedPrivacyVisibility === undefined);
  const [privacyError, setPrivacyError] = useState('');
  const [privacyTagEditorOpen, setPrivacyTagEditorOpen] = useState(false);
  const [privacyTagOptions, setPrivacyTagOptions] = useState<EaglePrivacyTagOption[]>([]);
  const [privateTagIds, setPrivateTagIds] = useState<string[]>([]);
  const [draftPrivateTagIds, setDraftPrivateTagIds] = useState<string[]>([]);
  const [privacyTagQuery, setPrivacyTagQuery] = useState('');
  const [privacyTagsLoading, setPrivacyTagsLoading] = useState(false);
  const [privacyTagsSaving, setPrivacyTagsSaving] = useState(false);
  const [privacyTagsLoaded, setPrivacyTagsLoaded] = useState(false);
  const privacyVisibility = providedPrivacyVisibility ?? localPrivacyVisibility;
  const setPrivacyVisibility = onPrivacyVisibilityChange ?? setLocalPrivacyVisibility;
  const desktopCache = getDesktopCacheBridge();
  function handleSectionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % ACCOUNT_SECTIONS.length;
    if (event.key === 'ArrowLeft')
      nextIndex = (index - 1 + ACCOUNT_SECTIONS.length) % ACCOUNT_SECTIONS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = ACCOUNT_SECTIONS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const section = ACCOUNT_SECTIONS[nextIndex];
    setActiveSection(section.id);
    document.getElementById(`account-tab-${section.id.toLowerCase()}`)?.focus();
  }
  const loadTokens = useCallback(async () => {
    setTokensLoading(true);
    setTokenError('');
    try {
      setTokens(await request<PersonalAccessToken[]>('/api/tokens'));
    } catch (cause) {
      setTokenError(cause instanceof Error ? cause.message : t('加载令牌失败'));
    } finally {
      setTokensLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);
  useEffect(() => {
    if (providedPrivacyVisibility !== undefined) return;
    setPrivacyLoading(true);
    void getPrivacyVisibility()
      .then(setLocalPrivacyVisibility)
      .catch((cause) =>
        setPrivacyError(cause instanceof Error ? cause.message : t('加载隐私设置失败')),
      )
      .finally(() => setPrivacyLoading(false));
  }, [providedPrivacyVisibility]);
  async function changePrivacyVisibility(enabled: boolean, durationHours: number) {
    setPrivacyLoading(true);
    setPrivacyError('');
    try {
      setPrivacyVisibility(await updatePrivacyVisibility(enabled, durationHours));
    } catch (cause) {
      setPrivacyError(cause instanceof Error ? cause.message : t('更新隐私设置失败'));
    } finally {
      setPrivacyLoading(false);
    }
  }
  async function openPrivacyTagEditor() {
    if (privacyTagEditorOpen) {
      setPrivacyTagEditorOpen(false);
      return;
    }
    setPrivacyTagEditorOpen(true);
    if (privacyTagsLoaded) return;
    setPrivacyTagsLoading(true);
    setPrivacyError('');
    try {
      const [settings, tags] = await Promise.all([
        getEaglePrivacySettings(),
        listEaglePrivacyTagOptions(),
      ]);
      setPrivateTagIds(settings.tagIds);
      setDraftPrivateTagIds(settings.tagIds);
      setPrivacyTagOptions(tags);
      setPrivacyTagsLoaded(true);
    } catch (cause) {
      setPrivacyError(cause instanceof Error ? cause.message : t('加载私密标签失败'));
    } finally {
      setPrivacyTagsLoading(false);
    }
  }
  async function savePrivacyTags(event: FormEvent) {
    event.preventDefault();
    setPrivacyTagsSaving(true);
    setPrivacyError('');
    try {
      const settings = await updateEaglePrivacySettings(draftPrivateTagIds);
      setPrivateTagIds(settings.tagIds);
      setDraftPrivateTagIds(settings.tagIds);
      onPrivacyRulesChange?.();
      try {
        await desktopCache?.clearCache();
      } catch {
        setPrivacyError(t('私密标签已保存，但桌面媒体缓存清理失败。'));
      }
    } catch (cause) {
      setPrivacyError(cause instanceof Error ? cause.message : t('保存私密标签失败'));
    } finally {
      setPrivacyTagsSaving(false);
    }
  }
  const draftPrivateTagIdSet = useMemo(() => new Set(draftPrivateTagIds), [draftPrivateTagIds]);
  const visiblePrivacyTags = useMemo(() => {
    const query = privacyTagQuery.normalize('NFKC').trim().toLocaleLowerCase();
    return privacyTagOptions.filter((tag) => {
      if (!query) return true;
      return [tag.name, tag.pinyin, tag.pinyinInitials].some((value) =>
        value.normalize('NFKC').toLocaleLowerCase().includes(query),
      );
    });
  }, [privacyTagOptions, privacyTagQuery]);
  async function createConnectionToken(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setTokenError('');
    setCreatedToken(null);
    try {
      const result = await request<CreatedToken>('/api/tokens', {
        method: 'POST',
        body: JSON.stringify({
          name: tokenName.trim(),
          scopes: tokenPurposes[tokenPurpose].scopes,
        }),
      });
      setCreatedToken(result);
      setTokens((current) => [{ ...result, revokedAt: null, lastUsedAt: null }, ...current]);
    } catch (cause) {
      setTokenError(cause instanceof Error ? cause.message : t('创建连接令牌失败'));
    } finally {
      setCreating(false);
    }
  }
  async function copyCreatedToken() {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      createdTokenInputRef.current?.focus();
      setTokenError(t('无法自动复制，已选中完整令牌，请手动复制。'));
    }
  }
  async function revokeToken(token: PersonalAccessToken) {
    if (
      !window.confirm(
        t('确定撤销“{{value1}}”吗？撤销后无法恢复。', {
          value1: token.name,
        }),
      )
    )
      return;
    setRevokingId(token.id);
    setTokenError('');
    try {
      await request(`/api/tokens/${token.id}`, { method: 'DELETE', body: '{}' });
      setTokens((current) =>
        current.map((item) =>
          item.id === token.id ? { ...item, revokedAt: new Date().toISOString() } : item,
        ),
      );
      if (createdToken?.id === token.id) setCreatedToken(null);
    } catch (cause) {
      setTokenError(cause instanceof Error ? cause.message : t('撤销令牌失败'));
    } finally {
      setRevokingId(null);
    }
  }
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError('');
    if (newPassword !== confirmPassword) {
      setPasswordError(t('两次输入的新密码不一致。'));
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError(t('新密码不能与当前密码相同。'));
      return;
    }
    setChangingPassword(true);
    try {
      await request('/api/auth/me/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await onPasswordChanged();
    } catch (cause) {
      setPasswordError(cause instanceof Error ? cause.message : t('修改密码失败'));
    } finally {
      setChangingPassword(false);
    }
  }
  return (
    <section className="account-page" data-testid="account-page">
      <header className="account-page-header">
        <div>
          <h1>{t('个人账号')}</h1>
          <p>
            {user.email} · {user.role === 'ADMIN' ? t('管理员') : t('成员')}
          </p>
        </div>
        <button className="quiet-button" type="button" onClick={onLogout}>
          <IconLogout size={17} />
          {' ' + t('退出登录') + ' '}
        </button>
      </header>

      <nav className="account-section-tabs" role="tablist" aria-label={t('账号设置分类')}>
        {ACCOUNT_SECTIONS.map((section, index) => {
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              id={`account-tab-${section.id.toLowerCase()}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls="account-section-panel"
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveSection(section.id)}
              onKeyDown={(event) => handleSectionKeyDown(event, index)}
            >
              {section.label}
            </button>
          );
        })}
      </nav>

      <div
        id="account-section-panel"
        className="account-content"
        role="tabpanel"
        aria-labelledby={`account-tab-${activeSection.toLowerCase()}`}
      >
        {activeSection === 'OVERVIEW' ? (
          <section className="account-panel account-summary" id="overview">
            <div className="setting-row">
              <span>{t('邮箱')}</span>
              <strong>{user.email}</strong>
            </div>
            <div className="setting-row">
              <span>{t('账号角色')}</span>
              <strong>{user.role === 'ADMIN' ? t('管理员') : t('成员')}</strong>
            </div>
          </section>
        ) : null}
        {activeSection === 'PRIVACY' ? (
          <section className="account-panel privacy-panel" id="privacy">
            <div className="panel-heading">
              <div>
                <p className="account-kicker">{t('内容隐私')}</p>
                <h2>{t('隐私内容')}</h2>
                <p>{t('关闭时，隐私素材不会出现在图库、搜索、标签、智能文件夹或推荐中。')}</p>
              </div>
              <IconEye size={22} />
            </div>
            <div className="privacy-controls">
              <label className="privacy-switch-row">
                <span>
                  <strong>{t('显示隐私内容')}</strong>
                  <small>
                    {privacyVisibility.enabled && privacyVisibility.expiresAt
                      ? t('将于 {{value1}} 自动关闭', {
                          value1: new Date(privacyVisibility.expiresAt).toLocaleString(getLocale()),
                        })
                      : t('当前浏览器中保持隐藏')}
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={t('显示隐私内容')}
                  checked={privacyVisibility.enabled}
                  disabled={privacyLoading}
                  onChange={(event) =>
                    void changePrivacyVisibility(
                      event.currentTarget.checked,
                      privacyVisibility.durationHours,
                    )
                  }
                />
              </label>
              <label className="privacy-duration-field">
                {' ' + t('自动关闭时间') + ' '}
                <select
                  aria-label={t('自动关闭时间')}
                  value={privacyVisibility.durationHours}
                  disabled={privacyLoading}
                  onChange={(event) =>
                    void changePrivacyVisibility(
                      privacyVisibility.enabled,
                      Number(event.currentTarget.value),
                    )
                  }
                >
                  {[1, 3, 6, 12, 24].map((hours) => (
                    <option key={hours} value={hours}>
                      {hours}
                      {' ' + t('小时') + ' '}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="privacy-tag-settings">
              <div>
                <span className="privacy-tag-heading">
                  <IconTags size={16} />
                  <strong>{t('私密标签')}</strong>
                </span>
                <small>
                  {privacyTagsLoaded
                    ? t('已选择 {{value1}} 个私密标签', { value1: privateTagIds.length })
                    : t('拥有任一所选标签的素材会自动进入私密。')}
                </small>
              </div>
              <button
                className="quiet-button"
                type="button"
                onClick={() => void openPrivacyTagEditor()}
              >
                {privacyTagEditorOpen ? t('收起私密标签') : t('管理私密标签')}
              </button>
            </div>
            {privacyTagEditorOpen ? (
              <form
                className="privacy-tag-editor"
                onSubmit={(event) => void savePrivacyTags(event)}
              >
                <input
                  type="search"
                  aria-label={t('搜索私密标签')}
                  placeholder={t('搜索名称、拼音或首字母')}
                  value={privacyTagQuery}
                  onChange={(event) => setPrivacyTagQuery(event.currentTarget.value)}
                />
                {privacyTagsLoading ? (
                  <p>{t('正在加载私密标签…')}</p>
                ) : visiblePrivacyTags.length ? (
                  <div className="privacy-tag-list">
                    {visiblePrivacyTags.map((tag) => (
                      <label key={tag.id}>
                        <input
                          type="checkbox"
                          aria-label={tag.name}
                          checked={draftPrivateTagIdSet.has(tag.id)}
                          onChange={() =>
                            setDraftPrivateTagIds((current) =>
                              current.includes(tag.id)
                                ? current.filter((id) => id !== tag.id)
                                : [...current, tag.id],
                            )
                          }
                        />
                        <span
                          className="privacy-tag-color"
                          style={tag.color ? { backgroundColor: tag.color } : undefined}
                        />
                        <span>{tag.name}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p>{privacyTagOptions.length ? t('没有匹配的标签') : t('还没有人工标签')}</p>
                )}
                <div className="privacy-tag-actions">
                  <span>{t('匹配任意一个标签即可进入私密')}</span>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={privacyTagsLoading || privacyTagsSaving}
                  >
                    {privacyTagsSaving ? t('正在保存…') : t('保存私密标签')}
                  </button>
                </div>
              </form>
            ) : null}
            {privacyError ? <p className="auth-error">{privacyError}</p> : null}
          </section>
        ) : null}

        {activeSection === 'CONNECTIONS' ? (
          <section className="account-panel" id="connections">
            <div className="panel-heading">
              <div>
                <p className="account-kicker">{t('连接管理')}</p>
                <h2>{t('外部连接令牌')}</h2>
                <p>{t('为浏览器采集或 Eagle 导入器签发最小权限令牌，不授予账号管理权限。')}</p>
              </div>
              <IconKey size={22} />
            </div>

            <form
              className="token-create-form"
              onSubmit={(event) => void createConnectionToken(event)}
            >
              <label>
                {' ' + t('令牌用途') + ' '}
                <select
                  value={tokenPurpose}
                  onChange={(event) => {
                    const purpose = event.target.value as keyof typeof tokenPurposes;
                    setTokenPurpose(purpose);
                    setTokenName(tokenPurposes[purpose].defaultName);
                  }}
                >
                  {Object.entries(tokenPurposes).map(([value, purpose]) => (
                    <option key={value} value={value}>
                      {purpose.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {' ' + t('令牌名称') + ' '}
                <input
                  value={tokenName}
                  onChange={(event) => setTokenName(event.target.value)}
                  maxLength={80}
                  placeholder={t('例如：工作室 Mac')}
                  required
                />
              </label>
              <p className="account-field-note">
                {' ' + t('有效期') + ' '}
                <strong>{t('永久有效')}</strong>
              </p>
              <button className="primary-button" type="submit" disabled={creating}>
                {creating ? t('正在创建…') : t('创建令牌')}
              </button>
            </form>

            {createdToken ? (
              <div className="token-reveal">
                <div>
                  <strong>{t('请立即保存，令牌只显示这一次')}</strong>
                  <p>{t('关闭或离开此页面后，将无法再次查看完整令牌。')}</p>
                </div>
                <div className="token-value">
                  <input
                    ref={createdTokenInputRef}
                    aria-label={t('新创建的令牌')}
                    readOnly
                    spellCheck={false}
                    value={createdToken.token}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <button type="button" onClick={() => void copyCreatedToken()}>
                    {copied ? <IconCheck size={17} /> : <IconCopy size={17} />}
                    {copied ? t('已复制') : t('复制')}
                  </button>
                </div>
              </div>
            ) : null}

            {tokenError ? <p className="auth-error">{tokenError}</p> : null}

            <div className="token-list-heading">
              <h3>{t('已创建的令牌')}</h3>
              <button
                className="icon-button"
                type="button"
                onClick={() => void loadTokens()}
                aria-label={t('刷新令牌列表')}
              >
                <IconRefresh size={16} />
              </button>
            </div>
            {tokensLoading ? (
              <p className="account-empty">{t('正在加载令牌…')}</p>
            ) : tokens.length === 0 ? (
              <p className="account-empty">{t('尚未创建外部连接令牌。')}</p>
            ) : (
              <div className="token-list">
                {tokens.map((item) => {
                  const status = getTokenStatus(item);
                  return (
                    <article className="token-item" key={item.id}>
                      <span className="token-item-icon">
                        <IconKey size={17} />
                      </span>
                      <div>
                        <div className="token-title-row">
                          <strong>{item.name}</strong>
                          <span className={`token-status token-status-${status}`}>
                            {statusLabels[status]}
                          </span>
                        </div>
                        <p>
                          {' ' + t('创建于') + ' '}
                          {formatDate(item.createdAt)}
                          {' ' + t('· 有效期')} {formatTokenExpiry(item.expiresAt)}
                        </p>
                        <p>
                          {t('最近使用：')}
                          {formatDate(item.lastUsedAt)}
                        </p>
                      </div>
                      {status === 'active' ? (
                        <button
                          className="danger-icon-button"
                          type="button"
                          onClick={() => void revokeToken(item)}
                          disabled={revokingId === item.id}
                          aria-label={t('撤销令牌 {{value1}}', {
                            value1: item.name,
                          })}
                        >
                          <IconTrash size={16} />
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}

        {activeSection === 'SECURITY' ? (
          <section className="account-panel" id="security">
            <div className="panel-heading">
              <div>
                <p className="account-kicker">{t('登录安全')}</p>
                <h2>{t('修改密码')}</h2>
                <p>{t('修改成功后会退出所有登录设备，并撤销现有外部连接令牌。')}</p>
              </div>
              <IconLock size={22} />
            </div>
            <form className="password-form" onSubmit={(event) => void changePassword(event)}>
              <label>
                {' ' + t('当前密码') + ' '}
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  minLength={12}
                  maxLength={128}
                  autoComplete="current-password"
                  required
                />
              </label>
              <div className="password-grid">
                <label>
                  {' ' + t('新密码') + ' '}
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    required
                  />
                </label>
                <label>
                  {' ' + t('确认新密码') + ' '}
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    required
                  />
                </label>
              </div>
              {passwordError ? <p className="auth-error">{passwordError}</p> : null}
              <button
                className="primary-button password-submit"
                type="submit"
                disabled={changingPassword}
              >
                {changingPassword ? t('正在修改…') : t('更新密码')}
              </button>
            </form>
          </section>
        ) : null}
      </div>
    </section>
  );
}
