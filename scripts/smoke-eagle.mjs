const baseUrl = process.env.SEKEREAGLE_BASE_URL ?? 'http://localhost:8180';
const adminUsername = process.env.SMOKE_ADMIN_USERNAME ?? '';
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD ?? '';
const origin = new URL(baseUrl).origin;

if (!adminUsername || !adminPassword) throw new Error('缺少 smoke 管理员凭据');
if (origin !== 'http://localhost:8180') throw new Error(`拒绝测试非本机实例: ${origin}`);

function cookiesFrom(response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
}

async function api(path, { method = 'GET', cookie = '', bearer = '', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function login(username, password) {
  const result = await api('/api/auth/login', { method: 'POST', body: { username, password } });
  if (!result.response.ok) throw new Error(`${username} 登录失败: ${result.response.status}`);
  return cookiesFrom(result.response);
}

const adminCookie = await login(adminUsername, adminPassword);
const suffix = Date.now().toString(36);
const password = `Eagle-smoke-${suffix}-password`;
const users = [];
for (const prefix of ['owner', 'other']) {
  const username = `${prefix}_${suffix}`;
  const created = await api('/api/admin/users', {
    method: 'POST',
    cookie: adminCookie,
    body: { username, password, role: 'USER' },
  });
  if (created.response.status !== 201) throw new Error(`创建 ${prefix} 用户失败`);
  users.push({ username, cookie: await login(username, password) });
}

const [owner, other] = users;
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#547de8"/><circle cx="320" cy="200" r="110" fill="#fff"/><text x="320" y="220" text-anchor="middle" font-family="sans-serif" font-size="54" fill="#253453">SE</text></svg>',
);
const initiated = await api('/api/eagle/uploads', {
  method: 'POST',
  cookie: owner.cookie,
  body: { originalName: 'smoke-eagle.svg', mimeType: 'image/svg+xml', size: svg.byteLength },
});
if (initiated.response.status !== 201) {
  throw new Error(
    `发起上传失败: ${initiated.response.status} ${JSON.stringify(initiated.payload)}`,
  );
}
const uploadId = initiated.payload?.id;
const signed = await api(`/api/eagle/uploads/${uploadId}/parts/1`, {
  method: 'POST',
  cookie: owner.cookie,
  body: {},
});
if (signed.response.status !== 201 || typeof signed.payload?.uploadUrl !== 'string') {
  throw new Error(`获取上传地址失败: ${signed.response.status}`);
}
const uploaded = await fetch(signed.payload.uploadUrl, { method: 'PUT', body: svg });
const etag = uploaded.headers.get('etag');
if (!uploaded.ok || !etag) throw new Error(`上传分片失败: ${uploaded.status}`);
const completed = await api(`/api/eagle/uploads/${uploadId}/complete`, {
  method: 'POST',
  cookie: owner.cookie,
  body: { parts: [{ partNumber: 1, etag }] },
});
if (completed.response.status !== 201) {
  throw new Error(
    `完成上传失败: ${completed.response.status} ${JSON.stringify(completed.payload)}`,
  );
}
const assetId = completed.payload?.assetId;
if (typeof assetId !== 'string') throw new Error('完成上传响应缺少 assetId');

let asset;
for (let attempt = 0; attempt < 20; attempt += 1) {
  const result = await api(`/api/eagle/assets/${assetId}`, { cookie: owner.cookie });
  if (!result.response.ok) throw new Error(`读取素材失败: ${result.response.status}`);
  asset = result.payload;
  if (asset.lifecycleStatus !== 'PROCESSING') break;
  await delay(500);
}
if (asset?.lifecycleStatus !== 'READY') {
  throw new Error(`worker 未完成素材处理: ${asset?.lifecycleStatus}`);
}
if (!asset.renditions?.some((rendition) => rendition.kind === 'THUMBNAIL')) {
  throw new Error('worker 没有生成缩略图');
}

const original = await fetch(`${baseUrl}${asset.originalUrl}`, {
  headers: { cookie: owner.cookie },
});
if (!original.ok || (await original.arrayBuffer()).byteLength !== svg.byteLength) {
  throw new Error('原文件鉴权读取失败');
}
const crossOwnerAsset = await api(`/api/eagle/assets/${assetId}`, { cookie: other.cookie });
if (crossOwnerAsset.response.status !== 404) throw new Error('跨用户读取素材没有返回 404');
const crossOwnerMedia = await fetch(`${baseUrl}${asset.originalUrl}`, {
  headers: { cookie: other.cookie },
});
if (crossOwnerMedia.status !== 404) throw new Error('跨用户读取原文件没有返回 404');

const tag = await api('/api/eagle/tags', {
  method: 'POST',
  cookie: owner.cookie,
  body: { name: `smoke-${suffix}`, color: '#547de8' },
});
if (tag.response.status !== 201) throw new Error('创建标签失败');
const tagged = await api(`/api/eagle/assets/${assetId}/tags`, {
  method: 'PUT',
  cookie: owner.cookie,
  body: { tagIds: [tag.payload.id] },
});
if (!tagged.response.ok || tagged.payload?.manualTags?.length !== 1)
  throw new Error('素材标签关联失败');

const readOnlyPat = await api('/api/tokens', {
  method: 'POST',
  cookie: owner.cookie,
  body: { name: 'read-only-smoke', scopes: ['import:read'], expiresInDays: 1 },
});
const rejectedUpload = await api('/api/eagle/uploads', {
  method: 'POST',
  bearer: readOnlyPat.payload?.token,
  body: { originalName: 'blocked.svg', mimeType: 'image/svg+xml', size: 1 },
});
if (rejectedUpload.response.status !== 403) throw new Error('只读 PAT 错误获得了上传权限');

process.stdout.write(`SekerEagle domain smoke passed: ${assetId}\n`);
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
