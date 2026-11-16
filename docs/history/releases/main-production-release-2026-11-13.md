# 2026年11月13日编辑器上限移除与 RAW 全尺寸成片生产发布

## 范围与版本

用户确认发布上线。运行源码固定为 `ecc32873d5c4098e8701d069935f76c6a0d3e922`，已推送 `origin/main`。本批包含两个提交：

- `cd42ffce`：移除编辑器 4800 万像素与 16384 单边预拒绝，仅保留真实画布分配失败错误。
- `ecc32873`：RAW 预览继续缩水，保存改为提交配方，由服务端从当前版本原 RAW 全尺寸显影并生成成片；编辑显影预算 1.2 亿像素，相同配方重试复用 requestId。

发布范围：

- Web：`sekereagle/web:raw-edit-ecc32873d5c4`（基于 `sekereagle/web:crop-preview-61be63b4766b`，仅替换静态构建与 nginx 配置）
- API／operations／library-reader：保持 `sekereagle/api:editor-fixes-318fcf4e47ec`，未重建
- Mac 唯一业务执行器：`.runtime/business-worker/releases/worker-ecc32873d5c4`（以 `worker-318fcf4e47ec` 为底，覆盖本次 worker 与共享包；原生依赖未重装）
- NAS worker 继续停止；数据库、MinIO、网关、协调器、中继未改变

## 构建与验收

- `lint`、`typecheck`、`build`、web 测试 151 文件／1137 项、worker 245 项、API 632 项、library-core 64 项、media-core 19 项、架构门禁 42 项、RAW Python 11 项通过。
- `cd42ffce` 与 `ecc32873` 的最终源码已通过全仓构建；本次没有 API 镜像变更，未执行 `test:api-image`。
- Web 镜像以 final 生产 web 镜像为基座、`--platform linux/amd64` 构建；镜像 revision label 为 `ecc32873…`，48 个静态文件与本机 `apps/web/dist` 逐文件 SHA256 一致；加载到 NAS 后再次验证架构、label 与内容。
- NAS `release-web.py prepare/images/activate` 通过：追加镜像覆盖后的 Compose 仅 web 的 `image`／`pull_policy` 差异；只重建 web，环境哈希、用户、工作目录、重启策略、挂载、网络、命令、健康检查、内存／CPU 限额与发布前一致；其余 9 个容器 ID 未变；迁移仍 87。
- 公网 `https://yuntai.design:8181/` 200、`/api/health/ready` 200、匿名 `/api/eagle/assets` 401；服务端 `index.html` SHA256 `8ec7dc5232e5398c69f146ad4000f81badf00d1d29cb59425c8d8e3e0c3ac694`、`PhotoEditor-CE_nFcIJ.js` SHA256 `9fcf481dad7f42362134127a9f7c05566c69480fa6a257023007554a2cf31965`（71,689 字节），均与本机构建一致；构建产物中已无 4800 万像素提示，包含 `edit-renders` 成片接口和画布失败提示。
- Mac worker 新进程 PID 81407、worker ID `worker-fab1d68c-add4-433c-88b1-6a4dd9b98249`，生产数据库心跳新鲜；旧 PID 43367 正常退出，`placement-state.json` 已切到新 release。新 release 680 个文件哈希通过；`edited-copy-render` 已使用 `EDIT` 全尺寸显影路径。
- 发布前后资源计数一致：MATERIAL 64,855、PHOTO 58,132（合计 122,987）、回收站 11,912、编辑草稿 84。

## 数据安全与备份

- 本次无数据库、对象存储、上传、后台任务或迁移路径变更，未新建备份；回退基准沿用 2026-11-07 已验证的 929,219,123 字节一致性备份（SHA-256 `d6adb615016f17bd650eb0c1831041b561301862ebaa087080908c0011f76de3`）。
- 未执行恢复、seed、重新导入或数据清理；未重启 API／operations／reader／postgres／MinIO／网关；未修改用户策略、处理暂停／时段与资源数量。

## 回退

- Web：NAS 私有 `maintenance/raw-edit-ecc32873d5c4/` 保存发布前服务快照、原 Compose 链、`images.json`、`rollback.json`、`image-plan.json`、`content-hashes.json` 和 `active.json`。回退时在完整 Compose 链后追加该目录 `rollback.json`，执行 `--profile processing up -d --no-deps web`，再执行 `nginx -t` 与 `nginx -s reload`；不修改链文件。
- Mac worker：停止新进程后恢复 `worker-before.plist`，或按 `placement-state.json` 的 `rollbackRelease` 切回 `worker-318fcf4e47ec`；旧 release 保留。回退后重新确认 heartbeat 与 worker ID。
- 不自动恢复数据库；本次无需恢复数据。

## 限制

- 未做登录后的生产浏览器／桌面交互：本机没有生产账号凭据；已用构建产物逐字节一致、容器健康与公网匿名检查替代。
- 61MP／120MP RAW 全尺寸链路使用合成 CFA DNG 实测（61MP 显影 1.45 秒／峰值 1.06GB；120MP 带降噪成片 14.4 秒／峰值 3.45GB），未用真实相机 RAW 验证色彩配置与压缩差异。
- Windows 桌面端加载服务端网页，需刷新或重新打开后才会使用新构建；本次没有重新打包桌面安装包。
- 现场存在既有 orphan 容器 `sekereagle-nas-staging-worker-details-1`，不属于本次九个服务，未清理，也未影响发布。
