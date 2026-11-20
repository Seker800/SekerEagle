# 2026年11月20日 照片排序与回收站排序发布（2405f5ed）

> 状态：历史记录 | 归档日期：2026-11-20 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 范围与版本

- 运行源码：`2405f5ed`（API／operations／library-reader／web 一致；桌面端源码未变）。
- API／operations／library-reader：`sekereagle/api:main-2405f5ed`（linux/amd64）。
- Web：`sekereagle/web:main-2405f5ed`（linux/amd64）。
- 数据库：101 项迁移，待应用 0；本次应用 `20261120093000_trash_deleted_order_index`，只新增回收站排序的两个部分索引，不改数据。
- 内容：照片模式支持按添加时间排序；回收站按删除时间倒序；安卓目录扫描跳过点开头的隐藏文件与目录（0.9.21，待安装）。

## 构建与切换

- 在群晖以现用 API／web 生产镜像为基座，叠加 HEAD 的 `apps/api/dist`、迁移与 `apps/web/dist` 构建；镜像 label revision 与 `2405f5ed…` 一致。
- API 成品镜像通过 `npm run test:api-image -- sekereagle/api:main-2405f5ed`：隔离启动、迁移、readiness 200、匿名 401、独立执行器无 API secrets 启动并退出 0。
- 线上 `index.html` SHA-256 `2e85f62e483684fb17119e70cdc1e757f0eb2891686adcf7c3c31ed2270e2c59`，与本地构建和镜像内文件一致。
- 切换：先停 operations，应用迁移，再停 gateway／api／library-reader／web，启动四个应用容器；无关容器 ID 未变，网关复用并 reload。

## 数据安全与备份

- 发布前一致性备份：944,962,937 字节，SHA-256 `43b78471db2e6606162600f94bcb13ddfa0a7eb03b3dc38df05c1417585e2acb`，`pg_restore --list` 完整解析。
- 发布前后计数完全相同：MATERIAL 64,850／PHOTO 58,941（合计 123,791）、回收站 13,424、草稿 239。
- schema 前两个回收站排序索引均为 0；应用后均为 1。

## 验证结果

- 公网首页 200、`/api/health/ready` 200、匿名 `/api/eagle/assets` 401；线上首页与本地构建哈希一致。
- api／operations／library-reader／web 四个容器 healthy，切换后日志无 error／fatal／unhandled。
- macOS 客户端：桌面端源码未变，重新构建的 app.asar 与已安装版本完全相同（`ca3a6a38cf35ffa1cdc6e6a2b0ee8a6d81217ee02ac2c5fec285fe7b5635a1df`），因此未替换应用包；已重新启动，进程正常，无 renderer 失败日志。
- 安卓 0.9.21（含目录扫描跳过隐藏项）已构建到 `apps/android/release/SekerEagle-0.9.21-android-debug.apk`；手机未连接，覆盖安装与真机扫描待执行。
- 未做登录后的生产浏览器交互；`/downloads/desktop/` 分发未更新。

## 回退

- API 回退：`sekereagle/api:share4k-e57b7ab7`；operations／library-reader 回退：`sekereagle/api:refactor-93b5d583`；Web 回退：`sekereagle/web:cacheopt-67e99d52`。
- NAS 私有 `maintenance/main-2405f5ed/` 保存发布前服务快照、原 Compose 链、`images.json`、`rollback.json`、`migration-plan.json`、`active.json`、数据库备份与归档索引；回退使用 `release.py` 的回退路径恢复镜像。两个排序索引为附加项，回退应用不需要删除。
