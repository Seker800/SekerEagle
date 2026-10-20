# SekerEagle 安全加固待办

> 2026-10-20 本地实施补充：以下原审计记录保留为历史依据。当前只修改仓库并在新建临时测试实例验证，未操作现有开发／生产服务。勾选表示本地代码完成，不表示已经部署。具体验证与本轮 review 结果见 [项目待办](todo.md)。永久 PAT、MFA 恢复、配额、备份密钥及旧令牌迁移属于需要产品／运维策略的剩余项。

记录日期：2026-10-20
来源：本轮安全审查 + 公网 HTTPS／端口访问讨论
状态：本地代码部分完成，现有服务未部署，按 P0 → P1 → P2 执行
约束：不要连接、迁移或修改 SekerChat 的数据库／MinIO；不要提交 `.env`、PAT、私钥或备份密码；改认证、上传、对象存储或 API 时必须补安全测试。

> 结论摘要：没有发现“已经被入侵”的硬证据，也没有未认证即可直接拿权的代码漏洞；但有 4 个 High 风险需要先处理：明文 HTTP、明文备份含全部密钥、媒体解析依赖漏洞、主机端口暴露。另有 7 个 Medium 和若干 Low/加固项。

## 优先级总览

| ID     | 优先级 | 任务                                                   | 预计    | 依赖                 |
| ------ | ------ | ------------------------------------------------------ | ------- | -------------------- |
| SEC-01 | P0     | 轮换审计中回显过的 S3 凭据                             | 15 分钟 | 无                   |
| SEC-02 | P0     | 公网入口收口到 HTTPS（一个高端口 + 反代 + 通配符证书） | 半天    | 域名、DNS API        |
| SEC-03 | P0     | 开防火墙、收敛监听端口                                 | 30 分钟 | 确认哪些服务需要公网 |
| SEC-04 | P0     | 备份加密，移除备份中的完整 `.env`                      | 半天    | NAS 访问             |
| SEC-05 | P0     | 升级关键运行时依赖                                     | 半天    | 可回滚的部署         |
| SEC-06 | P1     | 清理测试账号与测试 PAT                                 | 1 小时  | 无                   |
| SEC-07 | P1     | PAT 过期与轮换                                         | 1 天    | 无                   |
| SEC-08 | P1     | 认证审计、登录退避、管理员 MFA                         | 2–3 天  | 无                   |
| SEC-09 | P1     | 安全响应头与 CSP                                       | 半天    | 无                   |
| SEC-10 | P1     | 清理遗留 SVG，媒体改为安全 disposition                 | 半天    | 无                   |
| SEC-11 | P1     | 上传/导入配额与过期行清理                              | 1–2 天  | 无                   |
| SEC-12 | P1     | 媒体子进程环境最小化 + HEIC 回退白名单                 | 1 天    | 无                   |
| SEC-13 | P1     | 容器最小权限与网络分段                                 | 1–2 天  | 可停机窗口           |
| SEC-14 | P2     | 修复改密与 refresh 的竞态                              | 1 天    | 无                   |
| SEC-15 | P2     | bcrypt 72 字节上限                                     | 2 小时  | 无                   |
| SEC-16 | P2     | JWT `alg/iss/aud` 与独立隐私授权 key                   | 半天    | 无                   |
| SEC-17 | P2     | Cookie Path、`no-store`、refresh 表清理                | 半天    | 无                   |
| SEC-18 | P2     | 拒绝 `.env.example` 占位符密钥                         | 2 小时  | 无                   |
| SEC-19 | P2     | CI 依赖审计与认证回归测试                              | 1–2 天  | 无                   |
| SEC-20 | P2     | 桌面端签名/公证与 MCP PAT 存放                         | 1–2 天  | 证书/签名账号        |

---

## P0：先止血

### SEC-01 轮换 S3 凭据

审计过程中一条 `docker inspect` 输出未完全脱敏，`S3_SECRET_ACCESS_KEY` 在会话中出现过一次。按“已泄漏”处理。

- [ ] 在 MinIO 中为应用用户生成新的 secret（不要复用 root 凭据）。
- [ ] 更新部署配置中的 `S3_SECRET_ACCESS_KEY`。
- [ ] 重建/重启 API 与 worker。
- [ ] 确认旧 secret 已失效，上传、缩略图、备份导出均正常。
- [ ] 检查本机 Docker 权限，避免普通本机用户可随意 `docker inspect` 读取全部密钥。

验收：旧 secret 调用对象存储返回拒绝；新 secret 下 `npm run smoke:eagle`（或等效上传冒烟）通过。

### SEC-02 公网入口收口到 HTTPS

现状：gateway 绑定 LAN IP，`CANONICAL_ORIGIN` 为 `http://localhost:8180`，refresh cookie 30 天且非 Secure；配置还显式允许不安全的公网 HTTP origin。目标：一个公网 IP 只暴露一个高端口，由统一反向代理按域名分发，所有站点共用一张通配符证书。

**方案决策**

- [ ] 确认所有需要公网访问的应用都能放到同一个主域名的子域下（例如 `*.yuntai.design`）。
- [ ] 确认没有 80/443 也能签发：使用 DNS-01，不用 HTTP-01。
- [ ] 决定 TLS 终止点：优先群晖反向代理；应用多时改用 Caddy / Nginx Proxy Manager / Traefik 容器。
- [ ] 选择一个高端口作为唯一公网入口，例如 `8443`，不要继续每个应用一个公网端口。

**实施步骤**

- [ ] DNS 增加 `*.yuntai.design → 公网 IP`（或逐个子域 A 记录）。
- [ ] 用 `acme.sh` + DNS API、Caddy DNS 插件或 NPM DNS Challenge 申请 `*.yuntai.design` 通配符证书；无需 80 端口。
- [ ] 在群晖（或独立反代）上监听 `8443`，配置 SNI/Host 路由到内网 `IP:端口`。
- [ ] 路由器只转发 `8443` 到反代；关闭其他公网端口映射。
- [ ] 在 DSM 证书页面把通配符证书分配给所有反代域名；确认自动续约后反代自动使用新证书。
- [ ] 应用侧配置：
  - [ ] `CANONICAL_ORIGIN=https://<主域名>:8443`
  - [ ] `S3_PUBLIC_ENDPOINT=https://<主域名>:8443`
  - [ ] 删除 `SEKEREAGLE_ALLOW_INSECURE_PUBLIC_HTTP`
  - [ ] 把 compose 中硬编码的 `CANONICAL_ORIGIN` / `S3_PUBLIC_ENDPOINT` 改为 `${...:?}`
  - [ ] 确认 cookie 变为 `Secure`，启用 HSTS
- [ ] 验证证书链、SAN、有效期和自动续约。
- [ ] 确认反向代理正确传递 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto`，并支持 WebSocket 与大文件上传。

**关键认知（避免踩坑）**

- 证书认域名，不认端口；同一张证书可用于该域名的任何端口。
- 通配符只覆盖一级子域：`*.yuntai.design` 不含 `a.b.yuntai.design`，也不含其他主域名。
- 不同主域名需要各自证书；一个反代可以同时持有多个证书。
- 不要把证书私钥复制到每台机器；让一个反代统一终止 TLS，续约只维护一处。
- Cookie 不区分端口：同一主机不同端口的应用会共享 Cookie，容易冲突；用子域隔离。
- 端口隐蔽不是安全措施，扫描器会全端口扫描；只开一个反代端口并保持更新。
- SekerEagle 是私人照片库，能走 VPN/Tailscale 就不要直接公网暴露；必须公网时至少上 HTTPS + 强密码 + MFA。

**如果没有公网 IP 或端口被封**

- [ ] 评估 Cloudflare Tunnel、Tailscale Funnel 或 frp；这些方案不需要开入站端口，但仍需在应用侧做认证和更新。

验收：

```bash
curl -I https://photos.yuntai.design:8443
openssl s_client -connect photos.yuntai.design:8443 \
  -servername photos.yuntai.design </dev/null 2>/dev/null \
  | openssl x509 -noout -dates -subject -ext subjectAltName
```

浏览器无证书警告；HTTP 入口已关闭或 301 到 HTTPS；cookie 带 `Secure; HttpOnly; SameSite=Strict`。

### SEC-03 开防火墙、收敛监听端口

- [ ] 开启 macOS 防火墙（当前关闭）。
- [ ] 只允许可信设备访问反代端口；不要放行整个 LAN。
- [ ] 把 Ollama `11434` 改为只监听 `127.0.0.1`，或仅允许 Docker 后端网段。
- [ ] 把 MLX `11435` 改为只监听 `127.0.0.1`，或限制来源并保留 token。
- [ ] 把 SekerChat 开发栈的 Postgres `5432`、MinIO `9000/9001`、Vite `5173` 改为只监听 loopback 或内网隔离网段。**先确认用途，不要直接改 SekerChat 数据或容器。**
- [ ] 不用 AirPlay 时关闭 AirPlay Receiver 的 `5000/7000`。
- [ ] 关闭所有不需要的公网端口映射，只保留反代高端口。

验收：

```bash
lsof -nP -iTCP -sTCP:LISTEN
```

从另一台设备扫描公网 IP，只应看到反代端口；本机不应再有 `*:5432`、`*:9000`、`*:9001`、`*:5173`、`*:11434`。

### SEC-04 备份加密，移除完整 `.env`

现状：备份脚本把仓库根 `.env` 复制成 `deployment.env` 并打进明文 tar；备份里还有 `pg_dump`、`globals.sql`（口令哈希）和全部照片。NAS 或备份副本一旦泄漏，等于同时交出 JWT 签名密钥、数据库、MinIO/S3 凭据和全部媒体。

- [ ] 用 age 或 restic 对每个备份 generation 加密；密钥放 Keychain/独立介质，不进备份。
- [ ] 从备份中移除 `deployment.env`；备份只需要导出对象所需的 S3 凭据。
- [ ] 为备份创建独立的最小权限账号，不与生产管理员共用。
- [ ] 确认 NAS 目录权限、共享 ACL、快照/Hyper Backup 的可见范围。
- [ ] 做一次恢复演练；恢复时使用占位密钥，不用生产密钥。
- [ ] 如果 NAS 或备份曾经外泄，轮换 JWT、DB、MinIO、S3 全部密钥。

验收：没有密钥无法读取备份；备份 tar 中不存在 `deployment.env`；恢复演练通过；`npm run backup:test` 通过。

### SEC-05 升级关键运行时依赖

原审计的依赖计数属于历史快照。本轮定向升级后，`npm audit --omit=dev` 为 0 项；包含 dev 的全量审计为 8 项中危、0 高危、0 严重（桌面打包链上游仍待修复）。

- [x] `sharp` ≥ 0.35.5（HEIC/RAW 解析，API/worker 都会用）。
- [x] `@nestjs/platform-express` ≥ 11.2.7，确保 `multer` ≥ 2.4.0。
- [x] `proxy-addr` ≥ 2.0.8（与 `trust proxy 1` 相关）。
- [x] `qs` ≥ 6.16.0。
- [x] `fast-uri` ≥ 3.1.8。
- [x] 桌面端 `electron` ≥ 43.5.0。
- [x] 使用定向升级 + `overrides`；不要直接 `npm audit fix --force`。
- [x] 本地重建 API/worker/web，运行 lint、typecheck、unit test、build 与隔离数据库／HTTP 回归。
- [ ] 后续在具备专用 HEIF 检查工具的独立镜像中完成 HEIC 真文件上传验收；当前本机缺少 heif-info，已验证缺失时拒绝无检查回退。

验收：`npm audit --omit=dev` 中运行时 Critical/High 清零或逐条记录接受理由；CI 通过；HEIC/AVIF/视频/RAW 上传与缩略图正常。

---

## P1：这周/两周内

### SEC-06 清理测试账号与测试 PAT

现状：28 个账号里 27 个是测试/smoke 账号，23 个仍启用，其中 1 个是 ADMIN；8 个有效 PAT 属于测试账号。旧 smoke 测试密码采用可推导模式，具体派生规则不写入仓库。

- [ ] 列出所有 `@smoke.invalid`、`owner_*`、`other_*`、`smoke_*` 账号。
- [ ] 禁用或删除这些账号；保留真实管理员和一个最小测试账号（如确需）。
- [ ] 撤销这些账号的全部 PAT。
- [ ] 处理其名下 12 个测试素材，避免孤儿数据。
- [ ] 确认没有活跃 refresh session / PAT 指向这些账号。

验收：账号表只剩真实用户；`@smoke.invalid`/`owner_`/`other_` 为 0；有效 PAT 只属于真实账号；登录与图库功能正常。

### SEC-07 PAT 过期与轮换

- [ ] `PersonalAccessToken` 增加 `expiresAt` 默认值和最大有效期（例如 90 天）。
- [ ] 创建 PAT 时要求近期重新认证（密码或 MFA）。
- [ ] 列表展示 `lastUsedAt`，长期未用告警。
- [ ] 提供轮换流程：新 token 生效后再撤销旧 token。
- [ ] 过期/撤销后立即拒绝，并补测试。

验收：新 PAT 有过期时间；过期 token 返回 401；轮换不中断导入/采集。

### SEC-08 认证审计、登录退避、管理员 MFA

- [ ] 记录结构化审计事件：登录成功/失败、refresh 重放、PAT 创建/使用/撤销、管理员改密/停用/建号。
- [ ] 审计日志不包含密码、token、cookie、完整邮箱（按需脱敏）。
- [ ] 按归一化邮箱做失败计数 + 指数退避/临时锁定，独立于 IP。
- [ ] 为管理员加 TOTP MFA；高风险操作要求二次认证。
- [x] 登录/刷新/`auth/me` 响应加 `Cache-Control: no-store`。

验收：失败登录可在日志中检索；锁定生效；管理员 MFA 可注册/验证/恢复；无 secret 写入日志。

### SEC-09 安全响应头与 CSP

- [x] gateway/web 增加 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`。
- [x] 增加兼容桌面媒体、blob worker 的 CSP Report-Only；后续观察与强制执行仍待部署验收。
- [x] 关闭 `server_tokens`，移除 `X-Powered-By`。
- [ ] HTTPS 落地后增加 HSTS。
- [ ] 确认 CSP 不破坏图片、worker、blob、`sekereagle-media:` 等现有能力。

验收：`curl -I` 可见安全头；CSP 无阻断报告；页面功能正常。

### SEC-10 清理遗留 SVG，媒体改为安全 disposition

现状：数据库有 7 个旧 `image/svg+xml` 资产，媒体接口固定 `Content-Disposition: inline`；当前上传白名单已拒绝 SVG，但旧资产直接打开仍可能执行脚本。

- [ ] 找出所有 `image/svg+xml` 资产，确认来源（均为旧 smoke 测试）。
- [ ] 删除或转换为安全的位图/预览。
- [x] 对 RAW、SVG、HTML 和未知原片类型使用 `attachment`；安全位图和 MP4 可内联，以保留播放副本。
- [x] 所有媒体响应加 `nosniff`；`Content-Type` 做服务端 allowlist，不完全信任 S3 元数据。
- [x] 加浏览器／Agent 共用媒体策略回归测试。

验收：数据库中无 `image/svg+xml`；媒体响应带 `nosniff`；下载/预览/编辑功能正常。

### SEC-11 上传/导入配额与过期行清理

现状：上传与导入入口跳过限流，无 owner 配额；24 小时未完成的 UploadSession 只置 ABORTED，不删除行；没有 RefreshToken 清理任务。

- [ ] 增加 owner 级并发上传会话上限。
- [ ] 增加每日/每月上传字节配额和请求速率限制。
- [ ] 定期删除/归档 ABORTED/FAILED 的 UploadSession 与过期 EagleBrowserCapture。
- [ ] 增加 RefreshToken 过期/撤销行清理任务。
- [ ] 对 `POST /eagle/uploads` 做资源耗尽回归测试。

验收：超配额返回 429/403；过期行可被清理；正常上传不受影响。

### SEC-12 媒体子进程环境最小化与 HEIC 回退白名单

- [x] ffmpeg、ffprobe、heif-info、heif-convert、LibRaw 子进程只传 `PATH`、临时目录、必要的模型/解码变量。
- [x] 不把 `DATABASE_URL`、`S3_*`、`JWT_ACCESS_SECRET` 传给媒体子进程。
- [x] 删除 HEIC 的无检查 ffmpeg 回退；专用 HEIF 解码器预检查累计像素，缺失工具时拒绝。相机视频仍使用既有协议／容器白名单与输出预算。
- [x] 缺少 heif 工具时优先拒绝处理，而不是无约束回退。
- [x] 加子进程环境与缺少 HEIF 工具的拒绝路径测试。

验收：子进程环境不含密钥；恶意/异常 HEIC 被拒绝；正常 HEIC 仍可出图。

### SEC-13 容器最小权限与网络分段

- [ ] `cap_drop: [ALL]`、`security_opt: [no-new-privileges:true]`。
- [ ] `read_only: true` + `tmpfs: [/tmp]`（按服务调整）。
- [ ] web/gateway 使用非 root nginx 或 `USER nginx`；minio 使用非 root 用户。
- [ ] 数据层使用 `internal: true` 网络，gateway/web 只接前端网络。
- [ ] 基础镜像固定 `@sha256`，由 Dependabot/Renovate 更新。
- [ ] API/worker 运行时镜像 prune devDependencies。

验收：容器正常启动、媒体处理/上传/备份通过；`docker inspect` 显示最小权限；网络分段后 API 仍可访问 DB/S3。

---

## P2：有空再做

### SEC-14 修复改密与 refresh 的竞态

- [x] `RefreshToken` 增加创建时的 `authVersion`，refresh 时比对。已有记录回填版本并全部撤销，防止历史竞态旧会话被重新合法化；未来首次部署后须重新登录，仅在临时库执行。
- [x] 采用账号行锁方案：签发／刷新在事务内先锁 User FOR SHARE 并比较版本，再取 family/token 锁；改密／停用先更新同一用户行。旧账号快照直接拒绝，不写入死会话。
- [x] 补改密后旧账号快照恢复创建会话的交错回归、真实数据库凭据失效与正常刷新测试。

### SEC-15 bcrypt 72 字节上限

- [x] 新密码 DTO 和服务均按 UTF-8 字节限制 ≤72，旧长密码登录保持兼容。
- [x] 更新密码策略测试，覆盖 ASCII、中文与 emoji 边界。

### SEC-16 JWT `alg/iss/aud` 与独立隐私授权 key

已完成本地 HS256 算法固定与反例测试；iss/aud、独立 key、kid 涉及旧令牌兼容／迁移策略，保留后续实施。

- [ ] 验证时固定 `algorithms: ['HS256']`，增加 `iss`/`aud`。
- [ ] 隐私授权使用独立 key 或至少独立 `typ`。
- [ ] 预留 `kid` 轮换。

### SEC-17 Cookie Path、`no-store`、refresh 表清理

- [ ] access cookie `Path=/api`，评估 `__Host-` 前缀。
- [x] 认证／令牌／管理响应 `Cache-Control: no-store`，失败响应也覆盖。
- [ ] 定期清理过期/撤销 RefreshToken。

### SEC-18 拒绝 `.env.example` 占位符密钥

已完成 production JWT 的占位符／明显重复值拒绝、至少 32 字节 base64／hex 格式检查及回归；随机性不能仅靠字符串验证证明。S3／数据库密钥轮换与统一策略仍待实施。

- [ ] 生产环境拒绝 `replace-with-*`、`change-me` 等已知占位符和低熵值。
- [ ] 要求 base64/hex 32 字节以上随机值。
- [ ] 补配置校验测试。

### SEC-19 CI 依赖审计与认证回归测试

- [x] CI 同时运行 production 审计与包含 dev 的全量高危门禁，覆盖 Electron 和测试工具链；中危继续报告。
- [x] CI 设置 `SCARF_ANALYTICS=false`。
- [ ] 补 auth controller e2e、Cookie 属性断言、access token 吊销/失效测试。
- [ ] 把 `smoke:auth` 纳入 CI（仅 localhost）。

### SEC-20 桌面端签名/公证与 MCP PAT 存放

- [ ] macOS Developer ID 签名 + 公证；Windows Authenticode。
- [ ] Release 附 SHA-256 清单。
- [x] MCP 实现并文档化从当前用户拥有的 0600 文件读取 PAT，拒绝共享权限／符号链接，客户端 JSON 仅放路径；旧环境变量兼容。
- [ ] 将来加自动更新时必须校验签名。

---

## HTTPS / 端口方案备忘

- 一个公网 IP + 一个高端口（如 `8443`）+ 一个反向代理，可以服务多个站点；不是每个站都需要独立 IP 或 443。
- 证书按域名签发，不按端口；同一张证书可用于该域名的任何端口。
- 最省事：所有应用放 `*.yuntai.design` 子域，申请一张通配符证书，群晖/统一反代终止 TLS。
- 没有 80/443：用 DNS-01 签证书，不需要 80；群晖自带 Let's Encrypt 若只支持 HTTP-01，使用 `acme.sh` + DNS API 或改用 Caddy/NPM。
- 通配符只覆盖一级子域和一个主域名；其他主域名需要单独证书。
- 不要让每个应用各自持有一份证书私钥；集中终止 TLS，续约只维护一处。
- Cookie 不区分端口；同主机不同端口会共享 Cookie。用子域隔离应用。
- 端口隐蔽不是安全措施；只开一个反代端口，后端端口不要公网暴露。
- 没有公网 IP/端口被封：Cloudflare Tunnel、Tailscale Funnel、frp。
- SekerEagle 优先走 VPN/Tailscale；必须公网时至少 HTTPS + 强密码 + MFA + 及时更新。

## 回来后的执行顺序

1. SEC-01 换 S3 secret。
2. SEC-03 开防火墙、关多余端口。
3. SEC-02 把公网入口收口到一个 HTTPS 高端口。
4. SEC-06 清测试账号/PAT。
5. SEC-04 备份加密。
6. SEC-05 升级依赖。
7. 其余按 P1/P2 排期。

## 验证命令备忘

```bash
# 依赖
npm audit --omit=dev

# 构建与测试
npm run ci:check

# 备份
npm run backup:test

# 本机监听端口
lsof -nP -iTCP -sTCP:LISTEN

# TLS 证书
curl -I https://photos.yuntai.design:8443
openssl s_client -connect photos.yuntai.design:8443 \
  -servername photos.yuntai.design </dev/null 2>/dev/null \
  | openssl x509 -noout -dates -subject -ext subjectAltName

# 容器配置
docker compose --env-file .env.example -f deploy/mac/docker-compose.yml config --quiet
```

## 备注

- 审计为只读，未修改生产配置；本文件只记录待办，不代表已修复。
- 4 个 High：明文 HTTP、明文备份、媒体解析依赖、主机端口暴露。
- 7 个 Medium：安全头/CSP、遗留 SVG、测试账号/PAT、认证审计/锁定/MFA、上传配额、媒体子进程环境、容器加固。
- 如果曾在不可信 Wi-Fi 或公网 HTTP 下使用过：改管理员密码（吊销全部 refresh token）、撤销所有 PAT、轮换 JWT/S3。

## 本轮 review 与后续部署约束

DeepSeek Harness 已对本轮代码做只读审查。已独立复现并修复排序变化、多页轮询放大、旧快照签发死会话、桌面依赖审计遗漏、Agent 预览策略分叉与 API 元数据缓存覆盖；补齐真实 Nest HTTP、历史 refresh 回填／撤销与新会话刷新验证。所谓“TanStack refetch 沿用所有旧 cursor 导致漏行”的推断未采纳：[官方说明](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)明确从第一页依序重新计算；仍将分页改成创建时间＋ID，以保留原有顺序并让新增人物追加。

生产 JWT 校验现在要求随机生成、解码后至少 32 字节的 base64／hex，并拒绝占位符和明显重复值；不能把“32 字符”当成“32 字节随机数”。未来部署前须离线验证目标配置并安排不合格旧密钥的轮换，换签名密钥会使旧访问令牌及隐私授权失效，需要重新登录。此任务未读取、改写或轮换现有密钥。refresh 新字段与索引 migration 仅在临时库验证；未来部署按既有停写、迁移、一次性切换流程执行，不支持新旧 API 实例混跑。首次应用此 migration 会撤销全部旧 refresh 会话，避免无法证明签发版本的历史令牌续期；不是静默保留旧会话。

本轮没有恢复或修改现有备份、账号、存储、容器和网络。剩余 8 项中危位于 electron-builder／@electron/get／global-agent／roarr／sprintf-js 等打包链；不强制覆盖不兼容的传递依赖大版本，保留待上游修复与桌面签名发布验收。
