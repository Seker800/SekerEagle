const baseUrl = process.env.SEKEREAGLE_BASE_URL ?? 'http://localhost:8180';
const adminUsername = process.env.SMOKE_ADMIN_USERNAME ?? '';
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD ?? '';
const origin = new URL(baseUrl).origin;

if (!adminUsername || !adminPassword) {
  throw new Error('SMOKE_ADMIN_USERNAME and SMOKE_ADMIN_PASSWORD are required');
}
if (origin !== 'http://localhost:8180') {
  throw new Error(`拒绝对非本机独立实例运行 smoke: ${origin}`);
}

function cookiesFrom(response) {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];
  return values
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

const adminLogin = await api('/api/auth/login', {
  method: 'POST',
  body: { username: adminUsername, password: adminPassword },
});
if (!adminLogin.response.ok) throw new Error(`管理员登录失败: ${adminLogin.response.status}`);
const adminCookie = cookiesFrom(adminLogin.response);

const suffix = Date.now().toString(36);
const username = `smoke_${suffix}`;
const oldPassword = `Old-smoke-${suffix}-password`;
const newPassword = `New-smoke-${suffix}-password`;
const created = await api('/api/admin/users', {
  method: 'POST',
  cookie: adminCookie,
  body: { username, password: oldPassword, role: 'USER' },
});
if (created.response.status !== 201)
  throw new Error(`创建测试用户失败: ${created.response.status}`);
const userId = created.payload?.user?.id;
if (typeof userId !== 'string') throw new Error('创建用户响应缺少 user.id');

const userLogin = await api('/api/auth/login', {
  method: 'POST',
  body: { username, password: oldPassword },
});
if (!userLogin.response.ok) throw new Error(`测试用户登录失败: ${userLogin.response.status}`);
const userCookie = cookiesFrom(userLogin.response);

const refreshAttempts = await Promise.all([
  api('/api/auth/refresh', { method: 'POST', cookie: userCookie }),
  api('/api/auth/refresh', { method: 'POST', cookie: userCookie }),
]);
const refreshStatuses = refreshAttempts.map(({ response }) => response.status).sort();
if (refreshStatuses.join(',') !== '201,401') {
  throw new Error(`并发刷新没有做到单次轮换: ${refreshStatuses.join(',')}`);
}

const createdPat = await api('/api/tokens', {
  method: 'POST',
  cookie: userCookie,
  body: { name: 'smoke', scopes: ['import:read'], expiresInDays: 1 },
});
const pat = createdPat.payload?.token;
if (createdPat.response.status !== 201 || typeof pat !== 'string') throw new Error('PAT 创建失败');

const patMe = await api('/api/auth/me', { bearer: pat });
if (!patMe.response.ok) throw new Error('PAT 认证失败');
const patEscalation = await api('/api/tokens', { bearer: pat });
if (patEscalation.response.status !== 403) throw new Error('PAT 错误地获得了浏览器管理权限');

const reset = await api(`/api/admin/users/${userId}/password`, {
  method: 'PATCH',
  cookie: adminCookie,
  body: { newPassword },
});
if (!reset.response.ok) throw new Error(`重置密码失败: ${reset.response.status}`);
const revokedPat = await api('/api/auth/me', { bearer: pat });
if (revokedPat.response.status !== 401) throw new Error('重置密码后 PAT 未失效');
const revokedSession = await api('/api/auth/me', { cookie: userCookie });
if (revokedSession.response.status !== 401) throw new Error('重置密码后旧会话未失效');

const relogin = await api('/api/auth/login', {
  method: 'POST',
  body: { username, password: newPassword },
});
if (!relogin.response.ok) throw new Error('新密码登录失败');

const disabled = await api(`/api/admin/users/${userId}/disabled`, {
  method: 'PATCH',
  cookie: adminCookie,
  body: { disabled: true },
});
if (!disabled.response.ok) throw new Error(`停用用户失败: ${disabled.response.status}`);
const disabledLogin = await api('/api/auth/login', {
  method: 'POST',
  body: { username, password: newPassword },
});
if (disabledLogin.response.status !== 403) throw new Error('停用用户仍可登录');

const rejectedOrigin = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { origin: 'http://untrusted.invalid', 'content-type': 'application/json' },
  body: JSON.stringify({ username: adminUsername, password: adminPassword }),
});
if (rejectedOrigin.status !== 403) throw new Error('跨站 Origin 未被拒绝');

const bruteForceStatuses = [];
for (let attempt = 0; attempt < 8; attempt += 1) {
  const result = await api('/api/auth/login', {
    method: 'POST',
    body: { username: `missing-${suffix}`, password: 'never-a-real-password' },
  });
  bruteForceStatuses.push(result.response.status);
}
if (!bruteForceStatuses.includes(429)) throw new Error('登录暴力尝试未触发限流');

process.stdout.write('SekerEagle auth smoke passed\n');
