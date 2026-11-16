# 2026年11月16日认知成本重构生产发布

> 状态：历史记录 | 归档日期：2026-11-16 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 范围与版本

- 运行源码：`93b5d583d5cf1662efb761e59f5d9281183d59b2`。
- API／operations／library-reader：`sekereagle/api:refactor-93b5d583`
- Web：`sekereagle/web:refactor-93b5d583`
- Mac 唯一业务执行器：`.runtime/business-worker/releases/worker-93b5d583`
- 数据库：100 项迁移，待应用 0。本次应用两项：
  - `20261116120000_retire_ai_tag_reads`：清理智能文件夹中的 AI_TAGS 规则与派生依赖；历史标签行保留。
  - `20261116200000_watermark_preset_library_mode_trigger`：给 `EagleWatermarkPreset` 补 `library_mode_immutable` 触发器。

本批包含接手认知成本重构：文档入口与归档、旧导入栈/死方法/兼容别名清理、reader 与 LOCAL 命名、EagleService/operations/import/worker/页面/桌面主进程拆分、网页 token 与查询键收口，以及审查后发现的桌面媒体控制器、legacy NAS 唤醒和测试契约修复。

## 构建与验收

- API 镜像以现用 `sekereagle/api:upload-parallel-811ead5b` 为基础，叠加本次 `apps/api/dist`、`apps/api/prisma/migrations` 和 `packages/eagle-filter-core/dist`；以 `linux/amd64` 构建，label revision `93b5d583…`。
- API 成品镜像通过 `npm run test:api-image -- sekereagle/api:refactor-93b5d583`：隔离启动、迁移、readiness 200、匿名 401、独立执行器无 API secrets 启动并正常退出 0。
- Web 镜像以现用 `sekereagle/web:upload-clearfix-79800fc0` 为基础叠加新静态产物；镜像内 `index.html` 与本地构建 SHA-256 均为 `e1372e5b2a23444da5da13487ac4f6a172fb4f80f05fec6d48b94f809b6a07f0`。
- Mac worker release 由现用 `worker-b852071b` 克隆，覆盖本次 worker dist 与 `library-core`／`eagle-filter-core` dist；434 个程序文件 SHA-256 清单合并哈希 `d59bb94bb8fce07d29b72153a71884869e40231d97b03cee853d5f64afe1fe55`。

## 数据安全与备份

- 发布前一致性备份：936,861,410 字节，SHA-256 `da13a914c04e6e69a94699f85642a20ed0b14d446a5c3c080a05d66f9f968bc1`，`pg_restore --list` 完整解析。
- 发布前后计数严格相等：MATERIAL 64,862／PHOTO 58,656（合计 123,518）、回收站 12,042、编辑草稿 184；用户任务策略与处理设置逐项一致。
- schema 前：watermark 模式触发器 0；schema 后：操作计数列 7、`cleanupAttempts` 1、item 触发器 3、读取通知触发器 1、水印预设表 1、水印模式触发器 1。
- AI 标签派生依赖 `EagleSmartFolderAiTagDependency` 0 行；`EagleSmartFolder.queryJson` 中不再含 `AI_TAGS`。
- 只替换 API／operations／library-reader／web 四个应用容器；postgres、MinIO、网关、协调器、中继容器身份未变。网关短暂停止以释放 API 上游连接，随后复用并 reload。

## 验证结果

- 公网首页 200、`/api/health` 200、`/api/health/ready` 200；匿名 `/api/eagle/assets` 401。
- 四个应用容器 healthy；API／operations／reader／web 切换后日志无 error／fatal／unhandled。
- 公网 `index.html` 与镜像、本地构建 SHA-256 一致。
- Mac worker 旧 PID 90288 正常停止，12 个在途任务在 shutdown deadline 后释放；新 release 启动为 PID 96688，worker ID `worker-a0bd14b2-014d-41d5-af08-65c171f11156`，心跳新鲜并重新领取 12 个长视频预览任务；启动后无新 error／fatal。
- 未做登录后的生产浏览器交互；长视频预览仍在处理，未宣称该批任务已全部完成。

## 回退

NAS 私有 `maintenance/refactor-93b5d583/` 保存发布前服务快照、原 Compose 链、`images.json`、`rollback.json`、`migration-plan.json`、`active.json`、数据库备份与归档索引。回退时读取 `maintenance/processing-upgrade-20261023/release-compose.json` 的 command，追加本目录 `images.json` 与 `rollback.json`，执行 `--profile processing up -d --no-deps api operations library-reader web`；不修改链文件，回退后重新校验并 reload gateway。

- API／operations／reader 回退镜像：`sekereagle/api:upload-parallel-811ead5b`
- Web 回退镜像：`sekereagle/web:upload-clearfix-79800fc0`
- Mac worker 回退：停止新 launchd，恢复 `.omx/artifacts/release-93b5d583/worker-before.plist` 指向 `worker-b852071b`，核对心跳。旧 release 保留。
- 两项迁移为数据清理／触发器新增，回退应用不自动恢复数据库；需要恢复时使用 `database-before.dump`。
