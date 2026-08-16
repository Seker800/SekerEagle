import { useEffect, useState, type FormEvent } from 'react';
import { SekerEaglePage } from './components/eagle/SekerEaglePage';

interface User { id: string; username: string; role: 'USER' | 'ADMIN' }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body.message.join('；') : body?.message;
    throw new Error(message ?? `请求失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
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
    try {
      const result = await request<{ user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setUser(result.user);
      setShowAccount(false);
      setPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败');
    }
  }

  async function logout() {
    await request('/api/auth/logout', { method: 'POST', body: '{}' });
    setUser(null);
  }

  if (loading) return <main className="auth-loading">正在连接 SekerEagle…</main>;
  if (!user) {
    return (
      <main className="auth-shell">
        <form className="auth-card" onSubmit={(event) => void login(event)}>
          <p className="auth-eyebrow">SekerEagle</p>
          <h1>登录素材库</h1>
          <label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus /></label>
          <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button type="submit">登录</button>
        </form>
      </main>
    );
  }

  if (showAccount) {
    return <AccountHome user={user} onEnterLibrary={() => setShowAccount(false)} onLogout={() => void logout()} />;
  }

  return (
    <div className="standalone-eagle-shell">
      <SekerEaglePage ownerId={user.id} canManageProcessing={user.role === 'ADMIN'} onLogout={() => setShowAccount(true)} />
    </div>
  );
}

function AccountHome({ user, onEnterLibrary, onLogout }: { user: User; onEnterLibrary: () => void; onLogout: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  async function createImporterToken() {
    setCreating(true);
    setError('');
    try {
      const result = await request<{ token: string }>('/api/tokens', {
        method: 'POST',
        body: JSON.stringify({ name: `Eagle 导入器 ${new Date().toLocaleDateString('zh-CN')}`, scopes: ['import:read', 'import:write', 'asset:write'], expiresInDays: 30 }),
      });
      setToken(result.token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建导入令牌失败');
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="account-shell">
      <section className="account-card">
        <p className="auth-eyebrow">SekerEagle · {user.username}</p>
        <h1>独立账号</h1>
        <p>素材库界面和你的原设置保持不变；这里仅承载独立账号与 Eagle 导入器连接。</p>
        <div className="account-actions">
          <button className="primary-action" type="button" onClick={onEnterLibrary}>进入素材库</button>
          <button type="button" onClick={() => void createImporterToken()} disabled={creating}>{creating ? '正在创建…' : '创建 30 天导入令牌'}</button>
          <button type="button" onClick={onLogout}>退出登录</button>
        </div>
        {token ? <label className="token-result">令牌只显示一次<textarea readOnly value={token} onFocus={(event) => event.currentTarget.select()} /></label> : null}
        {error ? <p className="auth-error">{error}</p> : null}
      </section>
    </main>
  );
}
