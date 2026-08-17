import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const baseUrl = process.env.SEKEREAGLE_BASE_URL ?? 'http://localhost:8180';
const adminEmail = process.env.SMOKE_ADMIN_EMAIL ?? '';
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD ?? '';
const origin = new URL(baseUrl).origin;

if (!adminEmail || !adminPassword) throw new Error('缺少 smoke 管理员凭据');
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

async function login(email, password) {
  const result = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  if (!result.response.ok) throw new Error(`${email} 登录失败: ${result.response.status}`);
  return cookiesFrom(result.response);
}

const adminCookie = await login(adminEmail, adminPassword);
const suffix = Date.now().toString(36);
const password = `Eagle-smoke-${suffix}-password`;
const users = [];
for (const prefix of ['owner', 'other']) {
  const email = `${prefix}.${suffix}@smoke.invalid`;
  const created = await api('/api/admin/users', {
    method: 'POST',
    cookie: adminCookie,
    body: { email, password, role: 'USER' },
  });
  if (created.response.status !== 201) throw new Error(`创建 ${prefix} 用户失败`);
  await delay(150);
  users.push({ email, cookie: await login(email, password) });
}

const [owner, other] = users;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWMIqX3xHx9mGBkKAHC/rgFqds3aAAAAAElFTkSuQmCC',
  'base64',
);
const initiated = await api('/api/eagle/uploads', {
  method: 'POST',
  cookie: owner.cookie,
  body: { originalName: 'smoke-eagle.png', mimeType: 'image/png', size: png.byteLength },
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
const uploaded = await fetch(signed.payload.uploadUrl, { method: 'PUT', body: png });
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
if (!original.ok || (await original.arrayBuffer()).byteLength !== png.byteLength) {
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

const tagGroup = await api('/api/eagle/tag-groups', {
  method: 'POST',
  cookie: owner.cookie,
  body: { name: `group-${suffix}`, color: '#547de8', description: 'smoke' },
});
if (tagGroup.response.status !== 201) throw new Error('创建标签组失败');
const groupedTag = await api(`/api/eagle/tags/${tag.payload.id}`, {
  method: 'PATCH',
  cookie: owner.cookie,
  body: { groupId: tagGroup.payload.id, isStarred: true, rowVersion: tag.payload.rowVersion },
});
if (!groupedTag.response.ok || groupedTag.payload?.groupId !== tagGroup.payload.id)
  throw new Error('标签分组或星标更新失败');
const filteredAssets = await api(
  `/api/eagle/assets?formats=png&manualTagIds=${tag.payload.id}&search=smoke`,
  { cookie: owner.cookie },
);
if (
  !filteredAssets.response.ok ||
  !filteredAssets.payload?.items?.some((item) => item.id === assetId)
)
  throw new Error('原版界面的复合筛选接口失败');
const smartFolder = await api('/api/eagle/smart-folders', {
  method: 'POST',
  cookie: owner.cookie,
  body: { name: `smart-${suffix}`, query: { version: 1, filters: { formats: ['png'] } } },
});
if (smartFolder.response.status !== 201)
  throw new Error(
    `创建智能文件夹失败: ${smartFolder.response.status} ${JSON.stringify(smartFolder.payload)}`,
  );
const smartFolderAssets = await api(`/api/eagle/assets?smartFolderId=${smartFolder.payload.id}`, {
  cookie: owner.cookie,
});
if (
  !smartFolderAssets.response.ok ||
  !smartFolderAssets.payload?.items?.some((item) => item.id === assetId)
)
  throw new Error('智能文件夹筛选失败');

const processingSummary = await api('/api/admin/eagle-processing/summary', { cookie: adminCookie });
if (!processingSummary.response.ok || !processingSummary.payload?.settings)
  throw new Error('管理员处理页读取失败');
const processingSettings = await api('/api/admin/eagle-processing/settings', {
  method: 'PATCH',
  cookie: adminCookie,
  body: { mode: 'NIGHT', nightStart: '23:00', nightEnd: '06:00' },
});
if (!processingSettings.response.ok || processingSettings.payload?.timeZone !== 'Asia/Shanghai')
  throw new Error('管理员处理设置保存失败');

const importerPat = await api('/api/tokens', {
  method: 'POST',
  cookie: owner.cookie,
  body: {
    name: 'importer-smoke',
    scopes: ['import:read', 'import:write', 'asset:write'],
    expiresInDays: 1,
  },
});
if (importerPat.response.status !== 201) throw new Error('导入器 PAT 创建失败');
const importerToken = importerPat.payload?.token;
const importSha256 = createHash('sha256').update(png).digest('hex');
const sourceItemId = `source-${suffix}`;
const externalLibraryId = `library-${suffix}`;

async function createImportRun(annotation) {
  const createdRun = await api('/api/eagle/imports', {
    method: 'POST',
    bearer: importerToken,
    body: {
      idempotencyKey: `run-${suffix}-${annotation}`,
      manifestVersion: 2,
      externalLibraryId,
      libraryName: 'Smoke Library',
      sourceModifiedAt: new Date().toISOString(),
      declaredItemCount: 1,
      declaredByteSize: png.byteLength,
    },
  });
  if (createdRun.response.status !== 201) throw new Error('创建导入任务失败');
  const runId = createdRun.payload.id;
  const staged = await api(`/api/eagle/imports/${runId}/manifest/chunks`, {
    method: 'POST',
    bearer: importerToken,
    body: {
      manifestVersion: 2,
      chunkKey: 'items-00001',
      folders: [],
      tags: [],
      tagGroups: [],
      items: [
        {
          sourceItemId,
          name: 'Imported smoke',
          originalFileName: 'imported-smoke.png',
          extension: 'png',
          mimeType: 'image/png',
          size: png.byteLength,
          importedAt: Date.now(),
          modifiedAt: Date.now(),
          star: annotation === 'updated' ? 5 : 3,
          annotation,
          sourceUrl: 'https://example.invalid/smoke',
          tagNames: ['from-eagle'],
          folderIds: [],
          isDeleted: false,
          contentSha256: importSha256,
          sourceFileModifiedAt: Date.now(),
        },
      ],
    },
  });
  if (staged.response.status !== 201) throw new Error('提交导入清单失败');
  const preflight = await api(`/api/eagle/imports/${runId}/preflight`, {
    method: 'POST',
    bearer: importerToken,
  });
  if (preflight.response.status !== 201) throw new Error('导入预检失败');
  return { runId, preflight: preflight.payload };
}

const firstImport = await createImportRun('initial');
if (firstImport.preflight.newItemCount !== 1 || firstImport.preflight.uploadItemCount !== 1) {
  throw new Error('首次导入没有被识别为新增素材');
}
const importItems = await api(`/api/eagle/imports/${firstImport.runId}/items?status=STAGED`, {
  bearer: importerToken,
});
const importItem = importItems.payload?.items?.[0];
if (!importItem) throw new Error('导入任务缺少待上传项');
const importUpload = await api(
  `/api/eagle/imports/${firstImport.runId}/items/${importItem.id}/upload`,
  { method: 'POST', bearer: importerToken },
);
if (importUpload.response.status !== 201) throw new Error('导入项发起上传失败');
const importSigned = await api(`/api/eagle/uploads/${importUpload.payload.id}/parts/1`, {
  method: 'POST',
  bearer: importerToken,
  body: {},
});
const importPart = await fetch(importSigned.payload.uploadUrl, { method: 'PUT', body: png });
const importEtag = importPart.headers.get('etag');
if (!importPart.ok || !importEtag) throw new Error('导入项上传分片失败');
const importCompleted = await api(`/api/eagle/uploads/${importUpload.payload.id}/complete`, {
  method: 'POST',
  bearer: importerToken,
  body: { parts: [{ partNumber: 1, etag: importEtag }] },
});
const importFinished = await api(
  `/api/eagle/imports/${firstImport.runId}/items/${importItem.id}/finish`,
  {
    method: 'POST',
    bearer: importerToken,
    body: { assetId: importCompleted.payload?.assetId },
  },
);
if (!importFinished.response.ok) throw new Error('导入项元数据收敛失败');
const importedAssetId = importCompleted.payload.assetId;

const metadataImport = await createImportRun('updated');
if (
  metadataImport.preflight.metadataUpdateItemCount !== 1 ||
  metadataImport.preflight.uploadItemCount !== 0
) {
  throw new Error('增量导入没有识别仅元数据变化');
}
const importedAsset = await api(`/api/eagle/assets/${importedAssetId}`, { cookie: owner.cookie });
if (
  importedAsset.payload?.rating !== 5 ||
  importedAsset.payload?.annotation?.description !== 'updated' ||
  !importedAsset.payload?.manualTags?.some((item) => item.name === 'from-eagle')
) {
  throw new Error('增量元数据没有正确写入素材');
}
const crossOwnerRun = await api(`/api/eagle/imports/${firstImport.runId}`, {
  cookie: other.cookie,
});
if (crossOwnerRun.response.status !== 404) throw new Error('跨用户读取导入任务没有返回 404');

const readOnlyPat = await api('/api/tokens', {
  method: 'POST',
  cookie: owner.cookie,
  body: { name: 'read-only-smoke', scopes: ['import:read'], expiresInDays: 1 },
});
const rejectedUpload = await api('/api/eagle/uploads', {
  method: 'POST',
  bearer: readOnlyPat.payload?.token,
  body: { originalName: 'blocked.png', mimeType: 'image/png', size: 1 },
});
if (rejectedUpload.response.status !== 403) throw new Error('只读 PAT 错误获得了上传权限');

process.stdout.write(`SekerEagle domain smoke passed: ${assetId}\n`);
