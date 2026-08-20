import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  IconCheck,
  IconCopy,
  IconDatabase,
  IconKey,
  IconEye,
  IconLock,
  IconLogout,
  IconRefresh,
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
  getDesktopCacheBridge,
  type DesktopCacheStatus,
} from '../../lib/media-resolver';

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
  if (!value) return '从未使用';
  return new Intl.DateTimeFormat('zh-CN', {
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
  return expiresAt ? formatDate(expiresAt) : '永久有效';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

const statusLabels = { active: '有效', expired: '已过期', revoked: '已撤销' } as const;
const tokenPurposes = {
  capture: {
    label: '浏览器图片采集',
    defaultName: 'SekerEagle 浏览器插件',
    scopes: ['capture:write'],
  },
  importer: {
    label: 'Eagle 图库导入',
    defaultName: 'Eagle 导入器',
    scopes: ['import:read', 'import:write', 'asset:write'],
  },
} as const;

export function AccountHome({
  user,
  onPasswordChanged,
  onLogout,
  privacyVisibility: providedPrivacyVisibility,
  onPrivacyVisibilityChange,
}: {
  user: User;
  onPasswordChanged: () => Promise<void>;
  onLogout: () => void;
  privacyVisibility?: PrivacyVisibilityState;
  onPrivacyVisibilityChange?: (state: PrivacyVisibilityState) => void;
}) {
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
  const privacyVisibility = providedPrivacyVisibility ?? localPrivacyVisibility;
  const setPrivacyVisibility = onPrivacyVisibilityChange ?? setLocalPrivacyVisibility;
  const desktopCache = getDesktopCacheBridge();
  const [cacheStatus, setCacheStatus] = useState<DesktopCacheStatus | null>(null);
  const [cacheLimitGiB, setCacheLimitGiB] = useState(10);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheError, setCacheError] = useState('');

  const loadTokens = useCallback(async () => {
    setTokensLoading(true);
    setTokenError('');
    try {
      setTokens(await request<PersonalAccessToken[]>('/api/tokens'));
    } catch (cause) {
      setTokenError(cause instanceof Error ? cause.message : '加载令牌失败');
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
        setPrivacyError(cause instanceof Error ? cause.message : '加载隐私设置失败'),
      )
      .finally(() => setPrivacyLoading(false));
  }, [providedPrivacyVisibility]);

  const loadCacheStatus = useCallback(async () => {
    if (!desktopCache) return;
    try {
      const status = await desktopCache.getCacheStatus();
      setCacheStatus(status);
      setCacheLimitGiB(Math.round(status.limitBytes / 1024 ** 3));
      setCacheError('');
    } catch (cause) {
      setCacheError(cause instanceof Error ? cause.message : '加载本地缓存状态失败');
    }
  }, [desktopCache]);

  useEffect(() => {
    void loadCacheStatus();
  }, [loadCacheStatus]);

  async function saveCacheLimit() {
    if (!desktopCache) return;
    setCacheBusy(true);
    setCacheError('');
    try {
      await desktopCache.setCacheLimitGiB(cacheLimitGiB);
      await loadCacheStatus();
    } catch (cause) {
      setCacheError(cause instanceof Error ? cause.message : '保存缓存设置失败');
    } finally {
      setCacheBusy(false);
    }
  }

  async function clearDesktopCache() {
    if (!desktopCache || !window.confirm('确定清空当前账号的本地媒体缓存吗？')) return;
    setCacheBusy(true);
    setCacheError('');
    try {
      await desktopCache.clearCache();
      await loadCacheStatus();
    } catch (cause) {
      setCacheError(cause instanceof Error ? cause.message : '清空本地缓存失败');
    } finally {
      setCacheBusy(false);
    }
  }

  async function changePrivacyVisibility(enabled: boolean, durationHours: number) {
    setPrivacyLoading(true);
    setPrivacyError('');
    try {
      setPrivacyVisibility(await updatePrivacyVisibility(enabled, durationHours));
    } catch (cause) {
      setPrivacyError(cause instanceof Error ? cause.message : '更新隐私设置失败');
    } finally {
      setPrivacyLoading(false);
    }
  }

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
      setTokenError(cause instanceof Error ? cause.message : '创建连接令牌失败');
    } finally {
      setCreating(false);
    }
  }

  async function copyCreatedToken() {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      createdTokenInputRef.current?.focus();
      setTokenError('无法自动复制，已选中完整令牌，请手动复制。');
    }
  }

  async function revokeToken(token: PersonalAccessToken) {
    if (!window.confirm(`确定撤销“${token.name}”吗？撤销后无法恢复。`)) return;
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
      setTokenError(cause instanceof Error ? cause.message : '撤销令牌失败');
    } finally {
      setRevokingId(null);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError('');
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致。');
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError('新密码不能与当前密码相同。');
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
      setPasswordError(cause instanceof Error ? cause.message : '修改密码失败');
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <section className="account-page" data-testid="account-page">
      <header className="account-page-header">
        <div>
          <h1>个人账号</h1>
          <p>
            {user.email} · {user.role === 'ADMIN' ? '管理员' : '成员'}
          </p>
        </div>
        <button className="quiet-button" type="button" onClick={onLogout}>
          <IconLogout size={17} /> 退出登录
        </button>
      </header>

      <div className="account-content">
        {desktopCache ? (
          <section className="account-panel desktop-cache-panel" id="desktop-cache">
            <div className="panel-heading">
              <div>
                <p className="account-kicker">桌面客户端</p>
                <h2>本地媒体缓存</h2>
                <p>常用缩略图和切片保存在本机，按当前账号隔离并自动淘汰旧文件。</p>
              </div>
              <IconDatabase size={22} />
            </div>
            <div className="desktop-cache-stats">
              <span><strong>{cacheStatus ? formatBytes(cacheStatus.allocatedBytes) : '—'}</strong>已占用</span>
              <span><strong>{cacheStatus ? cacheStatus.entryCount.toLocaleString('zh-CN') : '—'}</strong>{cacheStatus ? ' 个文件' : '文件数'}</span>
              <span><strong>{cacheStatus ? `${Math.round((cacheStatus.hitCount / Math.max(1, cacheStatus.hitCount + cacheStatus.missCount)) * 100)}%` : '—'}</strong>命中率</span>
              <span><strong>{cacheStatus ? formatBytes(cacheStatus.savedBytes) : '—'}</strong>已节省流量</span>
            </div>
            <div className="desktop-cache-controls">
              <label>
                缓存容量上限
                <select
                  aria-label="缓存容量上限"
                  value={cacheLimitGiB}
                  disabled={cacheBusy}
                  onChange={(event) => setCacheLimitGiB(Number(event.currentTarget.value))}
                >
                  {[1, 5, 10, 25, 50, 100].map((value) => <option key={value} value={value}>{value} GiB</option>)}
                </select>
              </label>
              <button className="primary-button" type="button" disabled={cacheBusy} onClick={() => void saveCacheLimit()}>
                保存缓存设置
              </button>
              <button className="quiet-button" type="button" disabled={cacheBusy} onClick={() => void clearDesktopCache()}>
                <IconTrash size={16} /> 清空本地缓存
              </button>
            </div>
            {cacheError ? <p className="auth-error">{cacheError}</p> : null}
          </section>
        ) : null}
        <section className="account-panel privacy-panel" id="privacy">
          <div className="panel-heading">
            <div>
              <p className="account-kicker">内容隐私</p>
              <h2>隐私内容</h2>
              <p>关闭时，隐私素材不会出现在图库、搜索、标签、智能文件夹或推荐中。</p>
            </div>
            <IconEye size={22} />
          </div>
          <div className="privacy-controls">
            <label className="privacy-switch-row">
              <span>
                <strong>显示隐私内容</strong>
                <small>
                  {privacyVisibility.enabled && privacyVisibility.expiresAt
                    ? `将于 ${new Date(privacyVisibility.expiresAt).toLocaleString('zh-CN')} 自动关闭`
                    : '当前浏览器中保持隐藏'}
                </small>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label="显示隐私内容"
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
              自动关闭时间
              <select
                aria-label="自动关闭时间"
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
                    {hours} 小时
                  </option>
                ))}
              </select>
            </label>
          </div>
          {privacyError ? <p className="auth-error">{privacyError}</p> : null}
        </section>

        <section className="account-panel" id="connections">
          <div className="panel-heading">
            <div>
              <p className="account-kicker">连接管理</p>
              <h2>外部连接令牌</h2>
              <p>为浏览器采集或 Eagle 导入器签发最小权限令牌，不授予账号管理权限。</p>
            </div>
            <IconKey size={22} />
          </div>

          <form
            className="token-create-form"
            onSubmit={(event) => void createConnectionToken(event)}
          >
            <label>
              令牌用途
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
              令牌名称
              <input
                value={tokenName}
                onChange={(event) => setTokenName(event.target.value)}
                maxLength={80}
                placeholder="例如：工作室 Mac"
                required
              />
            </label>
            <p className="account-field-note">
              有效期
              <strong>永久有效</strong>
            </p>
            <button className="primary-button" type="submit" disabled={creating}>
              {creating ? '正在创建…' : '创建令牌'}
            </button>
          </form>

          {createdToken ? (
            <div className="token-reveal">
              <div>
                <strong>请立即保存，令牌只显示这一次</strong>
                <p>关闭或离开此页面后，将无法再次查看完整令牌。</p>
              </div>
              <div className="token-value">
                <input
                  ref={createdTokenInputRef}
                  aria-label="新创建的令牌"
                  readOnly
                  spellCheck={false}
                  value={createdToken.token}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button type="button" onClick={() => void copyCreatedToken()}>
                  {copied ? <IconCheck size={17} /> : <IconCopy size={17} />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
            </div>
          ) : null}

          {tokenError ? <p className="auth-error">{tokenError}</p> : null}

          <div className="token-list-heading">
            <h3>已创建的令牌</h3>
            <button
              className="icon-button"
              type="button"
              onClick={() => void loadTokens()}
              aria-label="刷新令牌列表"
            >
              <IconRefresh size={16} />
            </button>
          </div>
          {tokensLoading ? (
            <p className="account-empty">正在加载令牌…</p>
          ) : tokens.length === 0 ? (
            <p className="account-empty">尚未创建外部连接令牌。</p>
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
                        创建于 {formatDate(item.createdAt)} · 有效期{' '}
                        {formatTokenExpiry(item.expiresAt)}
                      </p>
                      <p>最近使用：{formatDate(item.lastUsedAt)}</p>
                    </div>
                    {status === 'active' ? (
                      <button
                        className="danger-icon-button"
                        type="button"
                        onClick={() => void revokeToken(item)}
                        disabled={revokingId === item.id}
                        aria-label={`撤销令牌 ${item.name}`}
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

        <section className="account-panel" id="security">
          <div className="panel-heading">
            <div>
              <p className="account-kicker">登录安全</p>
              <h2>修改密码</h2>
              <p>修改成功后会退出所有登录设备，并撤销现有外部连接令牌。</p>
            </div>
            <IconLock size={22} />
          </div>
          <form className="password-form" onSubmit={(event) => void changePassword(event)}>
            <label>
              当前密码
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
                新密码
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
                确认新密码
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
              {changingPassword ? '正在修改…' : '更新密码'}
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}
