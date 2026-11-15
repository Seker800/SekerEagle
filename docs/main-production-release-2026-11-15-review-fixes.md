# 2026-11-15 生产发布：审查修复、上传异步终结、地图缩放修复

## 发布范围

- 源码：`82f8fa1a765583b804f8fe787d1b978d24590855`（已推送 `origin/main`）。
  - `e83513e9`：二次审查 15 条修复（上传终结状态机、安卓备份/释放空间、地图位置删除、查看器/编辑器、Synology 导入）。
  - `5fca4c6c`：GitHub issue #114 地图缩放图层重建/滤镜修复与桌面渲染崩溃兜底。
  - `82f8fa1a`：API 镜像内 `migration.sql` 补读权限，修复 fresh DB 迁移 P3015。
- 镜像：
  - API／operations／library-reader：`sekereagle/api:review-fixes-82f8fa1a`。
  - web：`sekereagle/web:review-fixes-82f8fa1a`。
  - Mac 唯一业务执行器保持 `worker-386f31b4b853`，未切换。
- 迁移 90：`20261115150000_photo_map_location_delete_sensitive`。

## issue #114 修复

- `PhotoMapMarkers` 不再依赖 `viewport`，标记层只在 clusters/names 变化时重建。
- 视口只在取整边界或 zoom 真正变化时更新；地图查询使用 3 位小数视口并限制 `gcTime` 60 秒，避免每次 moveend 新 query key/缓存条目。
- 删除整块 canvas 的 `.distributionGlow` CSS `drop-shadow`；精选标记改为 canvas 内静态柔光，避免缩放时整块图层重新光栅化。
- 桌面主进程补 `render-process-gone` / `unresponsive`：写 `userData/renderer-failures.log`，弹窗提供重新加载/退出。主进程改动需要新的 Windows 包；现有 0.1.9 客户端加载新 web 后已获得地图 P0 修复。

## 构建与验收

- API 镜像 `linux/amd64`，revision label 与源码一致；937MB。
- `npm run test:api-image -- sekereagle/api:review-fixes-82f8fa1a --reader-check`：
  - fresh 隔离迁移（90 条）通过；
  - readiness 200、匿名人物 401；
  - 无 API secrets 的独立 executor 正常退出 0；
  - 无 API/存储 secrets 的独立 reader 启动/重启通过。
- Web 镜像 `linux/amd64`，revision 一致；生产 web 资产不含 `distributionGlow`。
- 单测/门禁：API 全量、Web 全量、Desktop、Android JVM、插件、Synology、photo-map 集成、真实 PostgreSQL 队列/批量检查、lint/typecheck/build/format/architecture/OSS 均通过。

## 备份与切换

- 一致性备份：892MB（934,520,865 字节），SHA-256 `7ff38218b7b347d4448825ed7129b62c0dc919139663aae08bcd602903880b7f`，`pg_restore --list` 完整解析。
- NAS 维护目录：`maintenance/review-fixes-82f8fa1a/`，含 `prepare`／`images`／`activate` 日志、`images.json`、`rollback.json`、`active.json`。
- `images` 阶段验证：迁移内容 SHA、候选 90 条与已应用 89 条 checksum 全匹配、compose 除 image/pull_policy 外无差异。
- 切换：drain operations → migrate deploy（90）→ 停 gateway/API/reader/web → 启新 API/operations/reader/web → healthy → 校验 env/资源/挂载/无关容器 → 启 gateway → nginx -t/reload。
- 计数只记录（切换期间用户正常写入）：MATERIAL 64,856；PHOTO 58,312→58,313；回收站 12,015；编辑草稿 159→160。用户任务策略与处理设置逐项一致。
- 未相关容器 ID 未变：postgres、MinIO、gateway、worker、compute-coordinator、business-worker-relay。

## 切换后核验

- 公网：首页 200、`/api/health` 200、匿名 `/api/auth/me` 401、匿名地图 401、匿名批量内容检查 401。
- 容器：API/operations/reader/web 均 healthy、RestartCount 0、镜像 revision `82f8fa1a…`。
- 内存：API 222MiB/2GiB、operations 208MiB/768MiB、reader 441MiB/1GiB、web 6MiB/256MiB。
- 数据库：迁移计数 90；`mark_photo_map_dirty()` 新分支标记位置 327/277；地图状态 `dirtyAt=null`、`builtVersion=requestedVersion`。
- 日志：API/operations 无 error/fatal/unhandled；gateway 无 502/504。

## 回退

- 回退镜像清单：`maintenance/review-fixes-82f8fa1a/rollback.json`（API→`map-delete-snapshot-d5fd0e8f91d2`，web→`viewer-cover-386f31b4b853`）。
- `release.py activate` 失败时会自动回退 API/reader/web 并重启 gateway；迁移 90 只替换触发器函数，旧 API 兼容。
- 数据库备份：`maintenance/review-fixes-82f8fa1a/database-before.dump`。

## 注意事项

- **现网安卓 0.9.19**：`complete` 现在异步返回 202、无 `assetId`；旧客户端会显示“服务器尚未确认原文件入库”并把该文件记为失败。下一轮 `check-content` 会识别已入库并标记成功，不会重复上传或丢数据。含轮询逻辑的新 APK 已构建：`apps/android/app/build/outputs/apk/debug/app-debug.apk`；安装后首次提交即可正常完成。
- **桌面**：web 地图修复对 0.1.9 客户端立即生效；主进程崩溃兜底只在源码中，需要重新构建 Windows portable 才能带 `render-process-gone` 处理。本机无 wine，未构建 Windows 包。
- 未做登录后生产浏览器/手机交互；建议现场缩放地图 40 次并上传一张照片确认。
