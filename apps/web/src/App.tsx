import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

interface User {
  id: string;
  username: string;
  role: 'USER' | 'ADMIN';
}

interface Asset {
  id: string;
  displayName: string;
  originalName: string;
  mimeType: string;
  format: string;
  byteSize: number;
  lifecycleStatus: 'PROCESSING' | 'READY' | 'FAILED';
  rating: number | null;
  rowVersion: number;
  originalUrl: string;
  annotation: { color: string | null; description: string | null; sourceUrl: string | null } | null;
  renditions: Array<{ id: string; kind: string; url: string }>;
  manualTags: Array<{ id: string; name: string; color: string | null }>;
}

interface Tag {
  id: string;
  name: string;
  color: string | null;
  rowVersion: number;
  _count?: { assetLinks: number };
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
      setError(messageOf(cause, '登录失败'));
    }
  }

  async function logout() {
    await request('/api/auth/logout', { method: 'POST', body: '{}' });
    setUser(null);
  }

  if (loading) return <main className="loading-screen">正在连接独立 SekerEagle…</main>;
  if (user) return <Library user={user} onLogout={() => void logout()} />;

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={(event) => void login(event)}>
        <div className="brand-mark">SE</div>
        <div>
          <p className="eyebrow">SekerEagle</p>
          <h1>登录素材库</h1>
          <p className="muted">独立账号、独立数据库、独立对象存储</p>
        </div>
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
        <button className="primary" type="submit">
          登录
        </button>
      </form>
    </main>
  );
}

function Library({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [search, setSearch] = useState('');
  const [trash, setTrash] = useState(false);
  const [busy, setBusy] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ limit: '100' });
      if (search.trim()) query.set('search', search.trim());
      const [assetPage, tagList] = await Promise.all([
        request<{ items: Asset[] }>(`/api/eagle/${trash ? 'trash' : 'assets'}?${query}`),
        request<Tag[]>('/api/eagle/tags'),
      ]);
      setAssets(assetPage.items);
      setTags(tagList);
      setSelected((current) => assetPage.items.find((asset) => asset.id === current?.id) ?? null);
      setError('');
    } catch (cause) {
      setError(messageOf(cause, '素材加载失败'));
    } finally {
      setBusy(false);
    }
  }, [search, trash]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!assets.some((asset) => asset.lifecycleStatus === 'PROCESSING')) return;
    const timer = window.setInterval(() => void load(), 2_500);
    return () => window.clearInterval(timer);
  }, [assets, load]);

  async function upload(file: File) {
    setUploadProgress(`准备上传 ${file.name}`);
    setError('');
    try {
      const session = await request<{ id: string; partSize: number }>('/api/eagle/uploads', {
        method: 'POST',
        body: JSON.stringify({
          originalName: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
        }),
      });
      const parts: Array<{ partNumber: number; etag: string }> = [];
      const partCount = Math.ceil(file.size / session.partSize);
      for (let index = 0; index < partCount; index += 1) {
        const partNumber = index + 1;
        setUploadProgress(`上传 ${file.name} · ${partNumber}/${partCount}`);
        const signed = await request<{ uploadUrl: string }>(
          `/api/eagle/uploads/${session.id}/parts/${partNumber}`,
          { method: 'POST', body: '{}' },
        );
        const response = await fetch(signed.uploadUrl, {
          method: 'PUT',
          body: file.slice(
            index * session.partSize,
            Math.min(file.size, (index + 1) * session.partSize),
          ),
        });
        if (!response.ok) throw new Error(`第 ${partNumber} 个分片上传失败`);
        const etag = response.headers.get('etag');
        if (!etag) throw new Error('对象存储没有返回 ETag');
        parts.push({ partNumber, etag });
      }
      setUploadProgress(`正在生成 ${file.name} 的预览`);
      await request(`/api/eagle/uploads/${session.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ parts }),
      });
      await load();
    } catch (cause) {
      setError(messageOf(cause, '上传失败'));
    } finally {
      setUploadProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function moveAsset(asset: Asset, restore: boolean) {
    await request(`/api/eagle/${restore ? 'trash/restore' : 'assets/trash'}`, {
      method: 'POST',
      body: JSON.stringify({ assetIds: [asset.id] }),
    });
    setSelected(null);
    await load();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark small">SE</span>
          <strong>SekerEagle</strong>
        </div>
        <nav>
          <button
            className={!trash ? 'nav-item active' : 'nav-item'}
            onClick={() => setTrash(false)}
          >
            <span>▦</span>全部素材<em>{!trash ? assets.length : ''}</em>
          </button>
          <button className={trash ? 'nav-item active' : 'nav-item'} onClick={() => setTrash(true)}>
            <span>♲</span>回收站
          </button>
        </nav>
        <div className="sidebar-section">
          <p>标签</p>
          {tags.length ? (
            tags.map((tag) => (
              <div className="tag-row" key={tag.id}>
                <i style={{ background: tag.color ?? '#73809a' }} />
                {tag.name}
                <em>{tag._count?.assetLinks ?? 0}</em>
              </div>
            ))
          ) : (
            <span className="empty-note">还没有标签</span>
          )}
        </div>
        <div className="account">
          <span>{user.username.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.username}</strong>
            <small>独立账号</small>
          </div>
          <button onClick={onLogout} title="退出登录">
            ↪
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <div>
            <p className="eyebrow">素材空间</p>
            <h1>{trash ? '回收站' : '全部素材'}</h1>
          </div>
          <div className="toolbar-actions">
            <input
              className="search"
              placeholder="搜索名称…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {!trash ? (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
                <button
                  className="primary"
                  onClick={() => fileInput.current?.click()}
                  disabled={Boolean(uploadProgress)}
                >
                  ＋ 导入素材
                </button>
              </>
            ) : null}
          </div>
        </header>
        {uploadProgress ? <div className="notice">{uploadProgress}</div> : null}
        {error ? (
          <div className="notice danger">
            {error}
            <button onClick={() => void load()}>重试</button>
          </div>
        ) : null}
        <div className={selected ? 'content with-inspector' : 'content'}>
          <section className="asset-area">
            {busy ? (
              <div className="empty-state">正在加载素材…</div>
            ) : assets.length ? (
              <div className="asset-grid">
                {assets.map((asset) => (
                  <AssetCard
                    asset={asset}
                    active={selected?.id === asset.id}
                    key={asset.id}
                    onClick={() => setSelected(asset)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span>◇</span>
                <h2>{trash ? '回收站是空的' : '这里还没有素材'}</h2>
                <p>
                  {trash
                    ? '删除的素材会暂存在这里。'
                    : '导入一张图片，worker 会自动生成缩略图和预览。'}
                </p>
              </div>
            )}
          </section>
          {selected ? (
            <Inspector
              asset={selected}
              trash={trash}
              onClose={() => setSelected(null)}
              onMove={() => void moveAsset(selected, trash)}
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}

function AssetCard({
  asset,
  active,
  onClick,
}: {
  asset: Asset;
  active: boolean;
  onClick: () => void;
}) {
  const thumbnail = asset.renditions.find((rendition) => rendition.kind === 'THUMBNAIL')?.url;
  return (
    <button className={active ? 'asset-card selected' : 'asset-card'} onClick={onClick}>
      <div className="asset-preview">
        {thumbnail ? (
          <img src={thumbnail} alt="" loading="lazy" />
        ) : (
          <div className="file-placeholder">
            <span>
              {asset.lifecycleStatus === 'PROCESSING'
                ? '◌'
                : asset.lifecycleStatus === 'FAILED'
                  ? '!'
                  : asset.format.toUpperCase()}
            </span>
          </div>
        )}
        <small className={`status ${asset.lifecycleStatus.toLowerCase()}`}>
          {asset.lifecycleStatus === 'PROCESSING'
            ? '处理中'
            : asset.lifecycleStatus === 'FAILED'
              ? '失败'
              : asset.format.toUpperCase()}
        </small>
      </div>
      <strong title={asset.displayName}>{asset.displayName}</strong>
      <span>{formatBytes(asset.byteSize)}</span>
    </button>
  );
}

function Inspector({
  asset,
  trash,
  onClose,
  onMove,
}: {
  asset: Asset;
  trash: boolean;
  onClose: () => void;
  onMove: () => void;
}) {
  return (
    <aside className="inspector">
      <header>
        <strong>素材详情</strong>
        <button onClick={onClose}>×</button>
      </header>
      <div className="inspector-preview">
        {asset.renditions.find((item) => item.kind === 'PREVIEW') ? (
          <img
            src={asset.renditions.find((item) => item.kind === 'PREVIEW')?.url}
            alt={asset.displayName}
          />
        ) : (
          <span>{asset.format.toUpperCase()}</span>
        )}
      </div>
      <h2>{asset.displayName}</h2>
      <dl>
        <div>
          <dt>文件名</dt>
          <dd>{asset.originalName}</dd>
        </div>
        <div>
          <dt>类型</dt>
          <dd>{asset.mimeType}</dd>
        </div>
        <div>
          <dt>大小</dt>
          <dd>{formatBytes(asset.byteSize)}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{asset.lifecycleStatus}</dd>
        </div>
      </dl>
      {asset.manualTags.length ? (
        <div className="tag-list">
          {asset.manualTags.map((tag) => (
            <span key={tag.id}>{tag.name}</span>
          ))}
        </div>
      ) : null}
      <a className="secondary action" href={asset.originalUrl} target="_blank" rel="noreferrer">
        查看原文件
      </a>
      <button className="danger-button" onClick={onMove}>
        {trash ? '恢复素材' : '移到回收站'}
      </button>
    </aside>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
