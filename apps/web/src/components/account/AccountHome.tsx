import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconKey,
  IconLock,
  IconLogout,
  IconRefresh,
  IconShieldCheck,
  IconTrash,
  IconUserCircle,
} from '@tabler/icons-react';
import sekerEagleLogo from '../../assets/seker-eagle-logo.svg';
import { request } from '../../lib/api-client';
import type { User } from '../../App';

interface PersonalAccessToken {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: string;
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
  return new Date(token.expiresAt).getTime() <= Date.now() ? 'expired' : 'active';
}

const statusLabels = { active: '有效', expired: '已过期', revoked: '已撤销' } as const;

export function AccountHome({
  user,
  onEnterLibrary,
  onPasswordChanged,
  onLogout,
}: {
  user: User;
  onEnterLibrary: () => void;
  onPasswordChanged: () => Promise<void>;
  onLogout: () => void;
}) {
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [tokenError, setTokenError] = useState('');
  const [tokenName, setTokenName] = useState('Eagle 导入器');
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

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

  async function createImporterToken(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setTokenError('');
    setCreatedToken(null);
    try {
      const result = await request<CreatedToken>('/api/tokens', {
        method: 'POST',
        body: JSON.stringify({
          name: tokenName.trim(),
          scopes: ['import:read', 'import:write', 'asset:write'],
          expiresInDays,
        }),
      });
      setCreatedToken(result);
      setTokens((current) => [{ ...result, revokedAt: null, lastUsedAt: null }, ...current]);
    } catch (cause) {
      setTokenError(cause instanceof Error ? cause.message : '创建导入令牌失败');
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
      setTokenError('无法自动复制，请手动选择令牌文本。');
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
    <main className="account-shell">
      <header className="account-header">
        <button className="account-brand" type="button" onClick={onEnterLibrary}>
          <span className="account-brand-mark">
            <img src={sekerEagleLogo} alt="" />
          </span>
          <span>SekerEagle</span>
        </button>
        <div className="account-header-actions">
          <button className="quiet-button" type="button" onClick={onEnterLibrary}>
            <IconArrowLeft size={17} /> 返回素材库
          </button>
          <button className="quiet-button" type="button" onClick={onLogout}>
            <IconLogout size={17} /> 退出登录
          </button>
        </div>
      </header>

      <div className="account-layout">
        <aside className="account-profile" aria-label="账号概览">
          <span className="profile-icon">
            <IconUserCircle size={32} />
          </span>
          <p className="account-kicker">个人账号</p>
          <h1>{user.email}</h1>
          <span className="role-badge">
            <IconShieldCheck size={15} /> {user.role === 'ADMIN' ? '管理员' : '成员'}
          </span>
          <p>账号、安全设置与 Eagle 导入器连接都集中在这里管理。</p>
          <nav aria-label="账号设置导航">
            <a href="#connections">
              <IconKey size={16} /> 导入器连接
            </a>
            <a href="#security">
              <IconLock size={16} /> 登录安全
            </a>
          </nav>
        </aside>

        <div className="account-content">
          <section className="account-panel" id="connections">
            <div className="panel-heading">
              <div>
                <p className="account-kicker">连接管理</p>
                <h2>Eagle 导入器令牌</h2>
                <p>令牌允许桌面导入器向此账号写入素材，不会获得账号管理权限。</p>
              </div>
              <IconKey size={22} />
            </div>

            <form
              className="token-create-form"
              onSubmit={(event) => void createImporterToken(event)}
            >
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
              <label>
                有效期
                <select
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(Number(event.target.value))}
                >
                  <option value={30}>30 天</option>
                  <option value={60}>60 天</option>
                  <option value={90}>90 天</option>
                </select>
              </label>
              <button className="primary-button" type="submit" disabled={creating}>
                {creating ? '正在创建…' : '创建令牌'}
              </button>
            </form>

            {createdToken ? (
              <div className="token-reveal" role="status">
                <div>
                  <strong>请立即保存，令牌只显示这一次</strong>
                  <p>关闭或离开此页面后，将无法再次查看完整令牌。</p>
                </div>
                <div className="token-value">
                  <code>{createdToken.token}</code>
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
              <p className="account-empty">尚未创建导入器令牌。</p>
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
                          创建于 {formatDate(item.createdAt)} · 到期 {formatDate(item.expiresAt)}
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
                <p>修改成功后会退出所有登录设备，并撤销现有导入令牌。</p>
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
      </div>
    </main>
  );
}
