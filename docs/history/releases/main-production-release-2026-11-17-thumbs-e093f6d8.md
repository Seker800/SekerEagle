# 2026年11月17日缩略图并发与缓存调优发布（仅网页）

> 状态：历史记录 | 归档日期：2026-11-17 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 范围与版本

- 运行源码：`7faf120c9c5492c1ee2dc375125fa7e20ccf4839`（网页代码 `e093f6d8`）。
- Web：`sekereagle/web:thumbs-e093f6d8`（linux/amd64，label revision `7faf120c…`）。
- API／operations／library-reader 保持 `sekereagle/api:refactor-93b5d583`；无数据库迁移，未改 Postgres、MinIO、网关、worker、计算协调器、中继或 Mac 执行器。

本次只调整客户端内部背压与缓存容量，解决宽屏首屏缩略图按顺序补齐的等待：

- 网页媒体调度普通连接由 3–4 并发、每秒 32 次启动、突发 16 改为 **10 并发、每秒 96 次、突发 48**。
- 省流量／2G 连接保持保守：2 并发、每秒 16 次、突发 8。
- 保留 429／5xx 共享冷却与单图 12 秒超时；到上限时按屏幕顺序排队继续加载，不丢请求、不报错。
- 网页缩略图内存缓存条目由 512 提高到 **2048**，字节上限保持 **128MiB**。
- 桌面主进程上游并发由 6／队列 64 提高到 12／队列 128；该改动在源码中，已安装 0.1.9 客户端需重新打包才生效。

不降低缩略图档位、不减少一屏卡片、不改变布局，也没有新增用户可见的次数限制。

## 构建与切换

- Web 镜像以 `sekereagle/web:refactor-93b5d583` 为基础，复制本地 `apps/web/dist`；构建上下文和证据保存在 NAS 私有 `maintenance/thumbs-e093f6d8/`。
- 切换前保存 web 容器完整 inspect、其他容器 ID、`images.json`、`rollback.json`；Compose 展开对比确认除 web 镜像外没有任何服务配置变化。
- 仅执行 `up -d --no-deps web`；API、operations、library-reader、Postgres、MinIO、gateway、worker、协调器和中继容器 ID 全部未变。

## 验证结果

- 新 web 容器 healthy，容器内 `wget --spider http://127.0.0.1:8080/` 通过；环境变量哈希、挂载、用户、命令、健康检查和内存限制与切换前一致。
- 公网首页 200，`index.html` SHA-256 为 `70fe74fd91ab15c0c34ad024061b8f853d256a33dd2db0ac7cb414b7a48abf95`，与本地构建和镜像内文件一致；线上静态资源 `index-B5Z-G3G0.js` 的 SHA-256 与本地构建一致。
- `/api/health/ready` 200。
- 发布前完整 `ci:check` 通过：网页 157 个测试文件／1,205 项，桌面 33 个文件／202 项；lint、typecheck、build、架构、契约、格式与 OSS 检查均通过。

## 数据安全与备份

本次只替换静态网页，不执行迁移、seed、导入或删除，未改动数据库与对象存储，因此没有创建新的数据库备份；切换失败可直接回退镜像。业务数据路径、owner 隔离、私密规则和缓存分组规则均未改变。

## 回退

- 回退镜像：`sekereagle/web:refactor-93b5d583`（切换前容器 `c20efce425a3…`）。
- 证据目录：NAS 私有 `maintenance/thumbs-e093f6d8/`，含 `before-web.private.json`、`before-others.private.json`、`images.json`、`rollback.json`、`compose-diff.json`、`public-verification.json`、`active.json`。
- 回退执行 `up -d --no-deps web` 使用 `rollback.json`；不需要回退 API 或数据库。

## 本机桌面客户端重打包

- 源码 `7faf120c` 重新构建 macOS arm64 客户端，版本仍为 0.1.9，按 app.asar 哈希区分。
- 新安装包 app.asar SHA-256：`7b27c68fcca3ebb58fc0f6101938f097a3e5d71b425947880f65a10454e5c953`，已确认包含 `MediaRequestLimiter(12, 128)`。
- 已替换 `/Applications/SekerEagle.app`；原客户端完整备份在 `~/SekerEagle-client-backups/SekerEagle-0.1.9-20261117-0907.app`（app.asar `b64eb3e8…`）。
- 启动后进程正常、已建立到服务器的连接、媒体缓存继续读写，未生成 `renderer-failures.log`。
- 只更新本机安装；未上传 `/downloads/desktop/`，未签名分发，Windows 包未重新构建。

## 限制

- 未做登录后的真实浏览器或桌面交互，也未在现网测量首屏回填时间；预期改善来自调度限速的推算。
- 桌面客户端的 12 并发仅存在于源码，需重新打包安装才会生效。
