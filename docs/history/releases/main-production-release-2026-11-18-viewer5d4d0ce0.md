# 2026年11月18日大图查看器顶栏状态与加载进度发布（仅网页）

> 状态：历史记录 | 归档日期：2026-11-18 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 范围与版本

- 运行源码：`5d4d0ce0e34efb0a16de271af4c1d9ef3bc64e48`（仅网页代码）。
- Web：`sekereagle/web:viewer5d4d0ce0`（linux/amd64，label revision `5d4d0ce0e34e`）。
- API 保持 `sekereagle/api:share4k-e57b7ab7`；operations／library-reader 保持 `sekereagle/api:refactor-93b5d583`；Mac 业务执行器未变。
- 无数据库迁移、无 schema 变化、无数据写入，未创建新的数据库备份。

本次只调整大图查看器的来源状态呈现：

- 移除照片左上角常驻的黑色状态条，把「预览 / 正在加载原图 / 原图」放进查看器顶栏的元数据行。
- 放大加载原图时，顶栏底部显示 2px 进度条与百分比；未知进度显示循环扫光。
- 原图加载完成后短暂提示再消失；加载失败时在顶栏保留「原图加载失败 · 仍显示预览图」。
- 首次打开有限预览时在底部提示一次「滚轮或双指放大，自动加载原图」，通过 `localStorage` 记忆，约 3.5 秒消失。

## 构建与验收

- 新 web 镜像以现用 `sekereagle/web:share4k-e57b7ab7` 为基础，叠加本地 `apps/web/dist`；构建上下文与证据保存在 NAS 私有 `maintenance/viewer5d4d0ce0/`。
- 镜像架构 amd64、label revision `5d4d0ce0e34e`；镜像内 `index.html`、入口 JS 和查看器 chunk 的 SHA-256 与本地构建一致。
- Compose 展开对比：除 web 镜像外没有任何服务配置变化。
- 发布前完整 `npm run ci:check` 通过；网页 157 个测试文件／1,219 项通过。

## 切换与验证

- 仅执行 `up -d --no-deps web`；api、operations、library-reader、postgres、MinIO、gateway、compute-coordinator、business-worker-relay 容器 ID 全部未变。
- 新 web 容器 `cdb19c53aa3a…` healthy；环境变量哈希、用户、工作目录、命令、入口、健康检查、内存与挂载与切换前一致。
- 公网首页 200、`/api/health` 200、`/api/health/ready` 200、匿名 `/api/eagle/assets` 401。
- 公网 `index.html` SHA-256 `425e1e8c3739a602955d6dd2cc29f89e40fea53d6b96556fdd1f7d4c8a090706`，入口 JS `5d6c54e8becfe507ab36fd8f54adff79bebd625616df0e08e89fa84a87171e9b`，查看器 chunk `7739e2b83227ec22bed32c8a1592d5d32679b6a277e137111f6796088346804f`，均与本地构建一致。
- 切换前后资产计数一致：active 123,602、回收站 12,105、草稿 196。
- 网关仅在 web 容器重建的瞬间出现一次 `web could not be resolved`，之后无 500／502；web 启动日志正常。

## 回退

- Web 回退：`sekereagle/web:share4k-e57b7ab7`（切换前容器 `1342d94b6b89…`）。
- 执行 `up -d --no-deps web` 使用 `maintenance/viewer5d4d0ce0/rollback.json`；不需要回退 API 或数据库。
- 证据目录：NAS 私有 `maintenance/viewer5d4d0ce0/`，含 `before-web.private.json`、`before-others.private.json`、`images.json`、`rollback.json`、`compose-diff.json`、`counts-before.json`、`active.json`、`public-verification.json`。

## 限制

- 登录后的大图查看器未在生产账号上重新走一遍；同一 `dist` 已在固定测试图库用 4096×3072 照片完成打开→放大→加载 25%→完成的真实浏览器验收。
- 桌面查看器的平移／旋转未重复验收（本次只改顶栏状态与加载指示，画布交互未改）；移动端窄屏未单独验收。
