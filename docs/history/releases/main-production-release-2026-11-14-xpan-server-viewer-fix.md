# 2026年11月14日 XPan 服务端校验与查看器放大体验修复发布

## 范围与版本

用户反馈两件事：XPan 比例保存提示“编辑参数无效或版本不受支持”；放大后加载高清时出现黑屏且没有进度。运行源码固定为 `6f51ae0f3c581b760e3fb5a51cd2b72f5c24da93`（web），服务端与 Mac worker 代码为 `5e65aa37bbb5a2e9f64392da36834712aa7137df`，均已推送 `origin/main`。

- API／operations／library-reader：`sekereagle/api:xpan-5e65aa37`（基于 `editor-fixes-318fcf4e47ec`，仅覆盖新版 `library-core` 参数校验）
- Web：`sekereagle/web:viewer-fix-6f51ae0f3c58`（基于 `viewer-zoom-7879fd865b90`，仅替换静态构建与 nginx 配置）
- Mac 唯一业务执行器：`.runtime/business-worker/releases/worker-5e65aa37bbb5`（基于 `worker-ecc32873d5c4`，覆盖新版 `library-core`）
- NAS worker 继续停止；数据库、MinIO、网关、协调器、中继未改变

本批修复：

- API 和 worker 使用新版 `library-core`，接受 XPan 65:24／24:65 配方；保存草稿、上传成片、批量编辑和 RAW 成片不再因新比例被拒。
- 查看器放大加载高清时保留 1600 预览垫底，不再整屏切黑；金字塔显示真实瓦片进度，没有金字塔的 JPG／PNG／WebP 按下载字节显示百分比，完成后自动替换。

## 构建与验收

- web 测试 151 文件／1143 项、lint、typecheck、build、格式检查通过。
- 最终 API 镜像在 NAS 构建，本地加载同一镜像后执行 `npm run test:api-image -- sekereagle/api:xpan-5e65aa37`：独立启动、迁移、readiness 200、匿名 401、独立执行器正常退出。镜像内 `library-core` 103 个文件与发布上下文逐文件 SHA256 一致；架构 amd64、revision label 固定。
- API／operations／reader 切换后 healthy；环境、挂载、命令、健康检查和资源限额与发布前一致；web、postgres、MinIO、网关、协调器、中继和停止的 worker 身份未变；迁移仍 87。最终运行中的 API 容器实际执行 `readPhotoEditRecipe` 接受 `65:24`。
- Mac worker 新 release 680 个文件哈希通过；现场 PID 96140、worker ID `worker-4b02f993-18c6-4eae-923e-e274bf401e5d`，生产心跳新鲜；新 release 的 `library-core` 接受 65:24。
- Web 镜像 48 个静态文件与本机一致；公网 `https://yuntai.design:8181/` 200、`/api/health/ready` 200、匿名 `/api/eagle/assets` 401；服务端 `index.html` SHA256 `56d3679f3b8d55da4ebb1176e141b7ce9e2b55ab9bc709b832334ed31e1766f4`、`PhotoEditor-CgNfZM7U.js` SHA256 `3405d9a0ae64e51602d4237a13d4ee08a8226c382543465bc7335272515ba504`（73,492 字节），均与本机构建一致；构建包含「预览图 · 放大加载高清」「正在加载高清细节」「正在加载原图」「XPan」「摄影信息条」。
- 核验快照：MATERIAL 64,855、PHOTO 58,141、回收站 11,916、编辑草稿 108；与 API 切换前一致。发布本身没有数据库写入或迁移。

## 数据安全与备份

- 本次无数据库、对象存储、上传、后台任务或迁移路径变更，未新建备份；回退基准沿用 2026-11-07 已验证的 929,219,123 字节一致性备份（SHA-256 `d6adb615016f17bd650eb0c1831041b561301862ebaa087080908c0011f76de3`）。
- 未执行恢复、seed、重新导入或数据清理；未修改用户策略、处理暂停／时段与资源数量。

## 回退

- API／operations／reader：NAS 私有 `maintenance/xpan-server-5e65aa37bbb5/` 保存发布前服务快照、原 Compose 链、`images.json`、`rollback.json`、`image-plan.json`、`library-core-hashes.json` 和 `active.json`。回退时在完整 Compose 链后追加该目录 `rollback.json`，重建 `api`、`operations`、`library-reader`；不自动恢复数据库。
- Mac worker：停止新进程后按 `placement-state.json` 的 `rollbackRelease` 切回 `worker-ecc32873d5c4`；旧 release 保留。
- Web：NAS 私有 `maintenance/viewer-fix-6f51ae0f3c58/rollback.json` 回退到 `sekereagle/web:viewer-zoom-7879fd865b90`；网关 `nginx -t` 与 reload。
- 不自动恢复数据库；本次无需恢复数据。

## 限制

- 未做登录后的生产浏览器／桌面交互：本机没有生产账号凭据；XPan 的保存链路用最终 API 容器实际参数校验和 worker release 校验替代，未在真实账号里点击保存。Windows 实机需刷新后确认 XPan 保存和放大加载观感。
- 查看器保留预览叠层依赖 OpenSeadragon 画布透明；本机没有生产会话做实际视觉验收，若现场仍出现闪黑需要继续调整叠层。
- 32,985 张应有大图高清的素材仍没有 READY 金字塔；放大时按素材类型读取原图或显影副本，都没有时保持预览。
