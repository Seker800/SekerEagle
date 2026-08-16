import { useEffect, useState, type FormEvent } from 'react';

interface User {
  id: string;
  username: string;
  role: 'USER' | 'ADMIN';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `请求失败（${response.status}）`);
  }
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
    await request('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }

  if (loading) return <main className="shell">正在连接独立 SekerEagle…</main>;

  if (user) {
    return (
      <main className="shell">
        <section className="card">
          <p className="eyebrow">独立实例已连接</p>
          <h1>你好，{user.username}</h1>
          <p>账号体系、数据库和对象存储均与 SekerChat 隔离。</p>
          <button onClick={() => void logout()}>退出登录</button>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <form className="card" onSubmit={(event) => void login(event)}>
        <p className="eyebrow">SekerEagle</p>
        <h1>登录素材库</h1>
        <label>
          用户名
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
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
        {error ? <p className="error">{error}</p> : null}
        <button type="submit">登录</button>
      </form>
    </main>
  );
}
