# 2026年11月14日 大图分层加载与照片组 JPEG 封面发布

## 范围与版本

用户确认发布上线。运行源码固定为 `386f31b4b8538003007abd03c7c841367126fafa`，已推送 `origin/main`。本批包含三个提交：

- `44811100`：大图查看器高清改为叠加图层。预览始终留在 OpenSeadragon 底层，高清用 `addTiledImage` 叠在同坐标的上层，就绪后再移除预览层；删除固定在视口的整图垫底层。修复放大时“看到两张图”和之后每个缩放层级都重新弹加载进度的问题。
- `62e507a8`：照片组封面改为手动选择优先、READY 非 RAW 优先、同类内再按锐度；图库读取增加同样兜底；新增数据迁移 `20261114193000_photo_group_non_raw_cover` 回填已有自动组。
- `386f31b4`：本机集成测试在未配置时自动使用 worker 的 `.runtime` 媒体工具，修复 `test:library-integration` 末段缺 `ffprobe` 的既有中断；CI 仍走 PATH。

发布范围：

- API／operations／library-reader：`sekereagle/api:viewer-cover-386f31b4b853`（以 `sekereagle/api:xpan-5e65aa37` 为基座，覆盖本次 API、worker 与全部共享包构建产物，并包含新迁移）
- Web：`sekereagle/web:viewer-cover-386f31b4b853`（以 `sekereagle/web:viewer-fix-6f51ae0f3c58` 为基座，仅替换静态构建与 nginx 配置）
- Mac 唯一业务执行器：`.runtime/business-worker/releases/worker-386f31b4b853`（以 `worker-5e65aa37bbb5` 为底，覆盖 worker 与新版 `library-core`）
- NAS worker 继续停止；数据库 schema、MinIO、协调器、中继未改变；网关容器复用，仅在切换期间短暂停止以释放上游连接

## 构建与验收

- 构建：`library-core`、`photo-render-core`、`library-persistence`、`media-core`、`config`、`eagle-filter-core`、`vector-core`、`api`、`worker`、`web` 全部重新构建。
- API 镜像在 NAS 以 `--platform linux/amd64` 构建；镜像内 `release-hashes.json` 1,834 个文件与本机逐文件一致；架构 amd64、revision label 固定。镜像内迁移 checksum：线上已应用 87 条全部匹配，待应用 1 条即 `20261114193000_photo_group_non_raw_cover`。
- 同一 API 镜像拉回本机执行 `npm run test:api-image -- sekereagle/api:viewer-cover-386f31b4b853`：独立启动、完整迁移、readiness 200、匿名 401、独立执行器正常退出。
- Web 镜像 48 个静态文件与 `apps/web/dist` 逐文件 SHA256 一致；公网 `index.html`（SHA-256 `1278a3f1…`）、`SekerEaglePage-BJq8BhVT.js`（`4750cec0…`）、`openseadragon-B1gJIiyy.js`（`e5cec8e2…`）均与本机构建一致。
- 切换后四个应用服务 healthy；环境哈希、用户、工作目录、重启策略、挂载、网络、命令、健康检查与资源限额与发布前逐项一致；postgres、MinIO、协调器、中继容器 ID 未变；网关容器 ID 未变（切换期间停止后复用同一容器启动）。
- Mac worker 新 release 680 个文件哈希通过；现场 PID 65703、worker ID `worker-407e7a12-2eb0-4d1c-b98b-e30d32ce7deb`，生产数据库心跳新鲜，旧进程正常退出。
- 公网 `https://yuntai.design:8181/` 200、`/api/health/ready` 200、匿名 `/api/eagle/assets` 401。

## 迁移与封面结果

- 迁移 `20261114193000_photo_group_non_raw_cover` 成功应用，线上共 88 项迁移。
- 发布前：5,295 个照片组，838 个 RAW 封面，其中 529 个组有 READY 非 RAW 同组成员，0 个用户手动选择的 RAW 封面。
- 发布后：照片组仍 5,295 个；RAW 封面降至 309 个（这些组没有可用非 RAW 成员）；“RAW 封面且有 READY 非 RAW 同组”降至 0；用户手动封面保持 0。
- 迁移只更新自动组的 `bestAssetId`，不改变组成员、不改变 schema；旧版 API 也能读取迁移后的数据。

## 数据安全与备份

- 发布前一致性 PostgreSQL 备份 `database-before.dump`，930,956,181 字节，SHA-256 `f200f00e2eced7f1c5734b122ec624192fcc962845894c28eac9d0b572cce31c`，已用 `pg_restore --list` 完整解析；没有在现用库执行恢复、seed 或重导入。
- 发布前后资源计数一致：MATERIAL 64,855、PHOTO 58,155（合计 123,010）、回收站 11,916、编辑草稿 136；用户处理设置与任务策略逐项一致。
- 未重建或恢复 PostgreSQL／MinIO 卷，未重写原片或派生对象；网关只做配置校验与 reload。

## 切换过程说明

- 第一次激活：迁移成功应用；停止应用容器时 API 因网关上游 keep-alive 连接未在 90 秒内退出，被 Docker 强制终止（退出码 137），触发自动回滚到旧镜像，四个服务恢复健康。
- 第二次激活：发布脚本字段名错误，在停止网关前退出并自动回滚，未改变服务。
- 第三次激活：切换流程先短暂停止网关释放上游连接，应用容器全部优雅退出，再启动新镜像、恢复同一网关容器并 reload；迁移已是 88 项，按计划完成切换。
- 强制终止风险仅限第一次尝试的 API；后台操作执行器（operations）在每次切换前都以退出码 0 完成排空，DB 写入均为事务，迁移已提交。此后建议为 API 增加 `closeIdleConnections` 或等价优雅退出处理，避免依赖网关停机。

## 回退

- NAS 私有 `maintenance/viewer-cover-386f31b4b853/` 保存发布前四服务快照、原 Compose 链、`images.json`、`rollback.json`、迁移计划、`active.json`、数据库备份与归档索引、镜像构建日志和网关配置快照。
- API／operations／reader 回退到 `sekereagle/api:xpan-5e65aa37`，web 回退到 `sekereagle/web:viewer-fix-6f51ae0f3c58`：在完整 Compose 链后追加 `rollback.json` 执行 `--no-deps up -d`，再 `nginx -t` 与 reload。迁移保持已应用（数据型，旧代码兼容）。
- Mac worker：按 `placement-state.json` 的 `rollbackRelease` 切回 `worker-5e65aa37bbb5`；旧 release 保留。
- 不自动恢复数据库。

## 限制

- 未做登录后的生产浏览器／桌面交互：本机没有生产账号凭据。查看器分层加载已在固定测试图库用真实浏览器验证（加载中只有一张图、提示“正在加载原图…”，完成后继续缩放不再弹加载）；封面规则由数据库统计、单元与集成测试验证。
- Windows 桌面端加载服务端网页，需刷新或重新打开后才会使用新构建；本次没有重新打包桌面安装包。
- 真实相机 RAW 与 JPEG 同组的观感仍需现场抽查；迁移只处理“封面是 RAW 且存在 READY 非 RAW 同组成员”的自动组，未手动选择封面的组。
