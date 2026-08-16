import { useEffect, useState, type FormEvent } from 'react';
import { SekerEaglePage } from './components/eagle/SekerEaglePage';

interface User {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message) ? body.message.join('；') : body?.message;
    throw new Error(message ?? `请求失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAccount, setShowAccount] = useState(false);

  useEffect(() => {
    request<{ user: User }>('/api/auth/me')
      .then(({ user: current }) => setUser(current))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const result = await request<{ user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setUser(result.user);
      setShowAccount(false);
      setPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败');
    }
  }

  async function logout() {
    try {
      await request('/api/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      setUser(null);
      setNotice('');
    }
  }

  async function finishPasswordChange() {
    try {
      await request('/api/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      setUser(null);
      setPassword('');
      setNotice('密码已修改，请使用新密码重新登录。');
    }
  }

  if (loading) return <main className="auth-loading">正在连接 SekerEagle…</main>;
  if (!user) {
    return (
      <main className="auth-shell">
        <form className="auth-card" onSubmit={(event) => void login(event)}>
          <p className="auth-eyebrow">SekerEagle</p>
          <h1>登录素材库</h1>
          <label>
            邮箱
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              autoFocus
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {notice ? <p className="auth-success">{notice}</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}
          <button type="submit">登录</button>
        </form>
      </main>
    );
  }

  if (showAccount) {
    return (
      <AccountHome
        user={user}
        onEnterLibrary={() => setShowAccount(false)}
        onPasswordChanged={() => finishPasswordChange()}
        onLogout={() => void logout()}
      />
    );
  }

  return (
    <div className="standalone-eagle-shell">
      <SekerEaglePage
        ownerId={user.id}
        canManageProcessing={user.role === 'ADMIN'}
        onOpenAccount={() => setShowAccount(true)}
      />
    </div>
  );
}

function AccountHome({
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
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  async function createImporterToken() {
    setCreating(true);
    setError('');
    try {
      const result = await request<{ token: string }>('/api/tokens', {
        method: 'POST',
        body: JSON.stringify({
          name: `Eagle 导入器 ${new Date().toLocaleDateString('zh-CN')}`,
          scopes: ['import:read', 'import:write', 'asset:write'],
          expiresInDays: 30,
        }),
      });
      setToken(result.token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建导入令牌失败');
    } finally {
      setCreating(false);
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
      <section className="account-card">
        <p className="auth-eyebrow">SekerEagle · {user.email}</p>
        <h1>独立账号</h1>
        <p>素材库界面和你的原设置保持不变；这里仅承载独立账号与 Eagle 导入器连接。</p>
        <div className="account-actions">
          <button className="primary-action" type="button" onClick={onEnterLibrary}>
            进入素材库
          </button>
          <button type="button" onClick={() => void createImporterToken()} disabled={creating}>
            {creating ? '正在创建…' : '创建 30 天导入令牌'}
          </button>
          <button type="button" onClick={onLogout}>
            退出登录
          </button>
        </div>
        {token ? (
          <label className="token-result">
            令牌只显示一次
            <textarea readOnly value={token} onFocus={(event) => event.currentTarget.select()} />
          </label>
        ) : null}
        {error ? <p className="auth-error">{error}</p> : null}
        <form className="password-form" onSubmit={(event) => void changePassword(event)}>
          <div className="account-section-heading">
            <h2>修改密码</h2>
            <p>修改后会退出当前账号，并撤销其他登录和导入令牌。</p>
          </div>
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
          {passwordError ? <p className="auth-error">{passwordError}</p> : null}
          <button className="password-submit" type="submit" disabled={changingPassword}>
            {changingPassword ? '正在修改…' : '修改密码'}
          </button>
        </form>
      </section>
    </main>
  );
}
