# 2026年11月17日 4K 分享复制与预览/原图标记发布

> 状态：历史记录 | 归档日期：2026-11-17 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 范围与版本

- 运行源码：`e57b7ab7ece61070906f528f266568fa0b768def`。
- API：`sekereagle/api:share4k-e57b7ab7`（linux/amd64）。
- Web：`sekereagle/web:share4k-e57b7ab7`（linux/amd64）。
- operations／library-reader 保持 `sekereagle/api:refactor-93b5d583`；Mac worker 未变。
- 无数据库迁移、无 schema 变化、无数据写入。

本次发布包含两项用户可见变化：

- 大图查看器左上角常驻来源标记：预览图 → 正在加载原图（真实进度）→ 原图；失败时显示“原图加载失败 · 仍显示预览图”，再次放大可重试。仅当原图大于浏览预览时出现。
- 复制按钮改为按需生成 4K 分享版：长边最多 4096、不放大小图、JPEG、15MB 安全网、超限先降质量再缩尺寸；网页转 PNG 写剪贴板，桌面通过剪贴板桥直接接收 JPEG。小于 4096 的图如实提示“已复制”，不冒充 4K。

## 构建与验收

- 两个镜像均以现用镜像为基础，叠加本次 `apps/api/dist`／`apps/web/dist`，以 `linux/amd64` 构建，label `org.opencontainers.image.revision=e57b7ab7ece6`。
- API 成品镜像通过 `npm run test:api-image -- sekereagle/api:share4k-e57b7ab7ece6`：隔离启动、迁移、readiness 200、匿名 401、独立执行器无 API secrets 启动并正常退出 0。
- 镜像传至 NAS 后：RootFS 层摘要与本地一致；OS／架构／Cmd／Entrypoint／User／WorkingDir 一致。NAS 侧因存储后端转换产生了不同的 image ID，故部署后用真实请求继续验收。
- 迁移校验：镜像内 100 项迁移与库内已应用 checksum 全部一致，待应用 0。
- Compose 对比：除 api／web 镜像外无任何服务配置变化。

## 切换与验证

- 切换顺序：停止网关释放上游连接 → 优雅停止旧 api／web → 用新镜像启动 api／web → 健康检查 → 启动网关并 `nginx -t`／reload。
- 四个相关容器：api／web 使用新镜像且 healthy；operations／library-reader、postgres、MinIO、网关、协调器、中继容器 ID 全部未变。
- 资产计数在切换前后一致；本轮未创建数据库备份（无迁移、DDL、导入、删除或数据写入）。
- 公网：首页 200，`index.html` SHA-256 `2eb854fb657f9fe61db457e5ced00baeee7ec117ab908f4455dcd490bfa88984` 与本地构建一致；`/api/health` 200、`/api/health/ready` 200；匿名 `/api/eagle/assets` 401；匿名 `/api/photos/.../share-image` 401。
- API 启动日志正常，切换后无 error／fatal／unhandled。

## 本机桌面客户端

- 重新构建 macOS arm64 0.1.9，app.asar SHA-256 `ca6263bf5422d6282e58cdc6a18bb3e4c9daa02fa00ad487e30d7b8a65bd850c`，已确认包含 `writeClipboardImageData`。
- 已替换 `/Applications/SekerEagle.app`；原客户端备份在 `~/SekerEagle-client-backups/SekerEagle-0.1.9-20261117-1702-before-share4k.app`（app.asar `7b27c68f…`）。
- 启动后连接生产、素材缩略图正常加载（网关日志有 Electron 0.1.9 请求），未生成 `renderer-failures.log`。
- 真实复制：打开 `IMG_0142`（低于 4096），左上角标记从“预览图”变为“原图”；点击复制返回 200 `image/jpeg`，桌面提示“已复制”，系统剪贴板包含 PNG／TIFF 图片。因原图小于 4096，未显示“已复制 4K”，符合新的如实提示规则。
- 生产 4K 路径用已登录桌面会话直接请求一张 11928×4301 的照片：返回 200、`image/jpeg`、1,177,905 字节，解码为 4096×1477。

## 回退

- Web：`sekereagle/web:thumbs-e093f6d8`。
- API：`sekereagle/api:refactor-93b5d583`；operations／reader 未变。
- 执行 Compose 链 + `maintenance/share4k-e57b7ab7/rollback.json` 的 `up -d --no-deps api web`，并重启网关。
- 证据目录：NAS 私有 `maintenance/share4k-e57b7ab7/`，含切换前服务快照、原 Compose 链、`images.json`、`rollback.json`、`migration-plan.json`、`data-safety.json`、`active.json`。

## 限制

- 未在 NAS 上实测 HEIC／RAW 的 4K 渲染耗时；本机工具链样本为 1.3–1.6 秒，生产以实际为准。
- 桌面端真实复制使用的是低于 4096 的照片，4K 输出由同一会话的真实 HTTP 请求单独验证；未在生产做长时间批量复制压测。
