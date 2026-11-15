# 2026年11月16日水印分组、分模板记忆与 HEIF 编辑生产发布

## 范围与版本

- 运行源码：`b852071bfdf20518d794452b155be361b831e2c5`。其后仅有测试契约与格式修复 `a7a19344`、`93754ab3`、`473adba9`，不改变运行时。
- API／operations／library-reader：`sekereagle/api:watermark-memory-b852071b`
- Web：`sekereagle/web:watermark-memory-b852071b`
- Mac 唯一业务执行器：`.runtime/business-worker/releases/worker-b852071b`
- 数据库仍为 97 项迁移，本次无新增迁移、无 schema 变更；对象存储、网关、协调器、中继、媒体节点未改。

本批包含：HEIC／HEIF 照片进入编辑器并由服务端从原片生成全尺寸 PNG；纵向参数栏的相机／时间角标、背景、参数/网址排版；所有水印模板的左右分组（左侧切换、右侧开关、编辑文字前分隔）与单按钮循环；每种水印独立保存底色、对齐、角标颜色、显示开关、自定义文字和网址，切换模板时恢复各自上次状态，首次使用取默认值；切换模板与显示设置保存进现有编辑草稿和成片配方。

## 构建与验收

- API 镜像从 `b852071b` 以 `linux/amd64` 构建，label revision 为 `b852071b…`；成品镜像通过 `npm run test:api-image -- sekereagle/api:watermark-memory-b852071b`（隔离启动、迁移、readiness 200、匿名 401、独立依赖检查）。
- Web 镜像从同一源码以 `linux/amd64` 构建；线上 `index.html`（`640c7129…`）、`PhotoEditor-DTpmKIAk.js`（`5eb83ef0…`）、`SekerEaglePage-fXP_DhVh.js`（`b91645eb…`）与本机构建 SHA256 一致；镜像内 85 个静态文件与本地 84 个构建文件一致（额外为 nginx 默认 `50x.html`）。
- Mac worker release 由现用 `worker-1f5cbb727f0a` 克隆，覆盖本次 worker dist 与 `library-core` dist/src；684 个程序文件哈希记录在私有 `.omx/artifacts/release-b852071b/worker-program.sha256`。release 内 `readPhotoEditRecipe` 实际接受带 `watermarkVariants` 的配方，`edited-copy-render` 模块可加载；现场 PID 90288，worker ID `worker-1bf14bec-3895-4d22-8906-b60bfcc0e875`，心跳新鲜、`activeJobCount=0`。
- 生产 API 容器内再次用真实发布镜像验证带 `watermarkVariants` 的配方可读，返回 `black`，不是只验证本地源码。
- Web 全量 1162 项、library-core 67 项、API 编辑相关 20 项通过；架构门禁 42 项、脚本契约 74 项通过（1 项跳过、0 失败）、lint、typecheck、Prettier、contracts、backup 测试通过。最终全量 `npm test` 整链退出 0。首轮曾暴露两项过期契约（媒体拖动测试仍匹配旧 `onDragStart` 写法、上传网关测试误取第一条 `location ~`），已修复并复跑；随后完整重跑通过，未把首轮失败当通过。

## 数据安全与备份

- 发布前一致性备份：934,621,091 字节，SHA-256 `6d440edd2c8fed36234f227022b1faec73f2505786edc2f8064135e5339b80b4`，`pg_restore --list` 完整解析。
- 迁移账本 97 项，待应用 0；schema 前后一致（操作计数列 7、`cleanupAttempts` 1、item 触发器 3、读取通知触发器 1）。
- 用户任务策略与处理设置逐项一致；发布前后计数严格相等：MATERIAL 64,856／PHOTO 58,308（合计 123,164）、回收站 12,030、编辑草稿 169。没有恢复、seed 或重新导入。
- API、operations、library-reader、web 四个容器均 healthy、0 重启、镜像 revision 一致；gateway 容器复用，切换时短暂停止以释放 API 上游连接，随后 `nginx -t` 与 reload。postgres、MinIO、协调器、中继容器 ID 未变；Mac worker 切换使用 LaunchAgent 正常停止旧进程，旧 plist 已备份。

## 验证结果

- 公网首页 200、`/api/health` 200、`/api/health/ready` 200；匿名 `/api/eagle/assets`、`/api/photos/assets` 均 401。
- API／operations／reader／web 日志切换后无 error／fatal／unhandled；网关日志无错误。
- 新 web 资源与本地生产构建逐文件一致，未用旧缓存冒充新 UI。
- Mac worker 新 release 已写入新鲜心跳；任务队列当前无积压，实际领取量以实时检查点为准。

## 回退

NAS 私有 `maintenance/watermark-memory-b852071b/` 保存发布前服务快照、原 Compose 链、`images.json`、`rollback.json`、`migration-plan.json`、`active.json`、数据库备份与归档索引。回退时从 `maintenance/processing-upgrade-20261023/release-compose.json` 读取 command，在末尾追加本目录的 `images.json` 与 `rollback.json`，执行 `--profile processing up -d --no-deps api operations library-reader web`；不修改链文件，回退后重新校验并 reload gateway。Mac worker 回退使用 `.omx/artifacts/release-b852071b/worker-before.plist`，先正常停止新进程，再恢复旧 plist 指向 `worker-1f5cbb727f0a` 并核对心跳。

本次无数据库迁移，回退不自动恢复数据库。旧镜像为 `sekereagle/api:people-ux-1f5cbb727f0a`／`sekereagle/web:people-ux-1f5cbb727f0a`。

## 限制

- 未做登录后的生产浏览器交互（无生产账号凭据）；水印分组、循环和分模板记忆用开发页真实浏览器截图与组件/配方测试验证，生产只核验静态资源、API 镜像配方读取、容器健康与匿名鉴权。
- 分模板记忆从本版本开始写入配方；已有历史草稿没有该字段时按空记录读取，首次切换后开始记录。已保存 PNG 成片不因新排版自动变化。
- HEIC／HEIF 编辑仍依赖服务端原片解码；动态 HEIF 只编辑静态主图，多图 HEIF 继续按入库 primary 规则。
