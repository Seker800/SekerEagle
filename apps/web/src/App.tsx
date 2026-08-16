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

  return (
    <div className="standalone-eagle-shell">
      <SekerEaglePage ownerId={user.id} canManageProcessing={user.role === 'ADMIN'} onLogout={() => void logout()} />
    </div>
  );
}
