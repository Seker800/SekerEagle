# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`7177c6951a3caafaf0562f4f54db71f5bf4edc67..df6d3688305a648a66e3bd621f094a8ef452546e`
- 完成时间（UTC）：2026-11-01T09:34:50.994089+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/df6d3688305a-dg7vxuxf`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 独立代码审查报告

审查对象：`7177c6951a3caafaf0562f4f54db71f5bf4edc67..df6d3688305a648a66e3bd621f094a8ef452546e` 的独立快照。只读审查，未修改文件、未运行命令、未连接任何数据库或外部系统。

## 总体结论

未发现高严重度的数据安全、越权、租约或事务正确性缺陷。清空回收站的有界分批、`publishMetadataBatch` 统一发布、集合式转换事件触发器、发送标签映射复用、向量空间发布守卫、统计/人物/智能文件夹读取改动，主路径与现有守卫基本一致；迁移里的 `EXECUTE` 重规划、`ON CONFLICT` 跳过 PROCESSING、`requeued_legacy` 互斥等关键语义在代码层面可对应到已有集成测试和文档中的证据。

发现 1 个与效率目标直接相关的中等风险，以及 3 个低风险/待验证问题。

---

## 问题 1（中）：空间不可用时仍会回退到完整读图与模型推理，随后才失败并重试

**位置**
- `apps/worker/src/embedding-publication.ts:88-90`：`publishStoredEmbedding` 在 `SPACE_INCOMPATIBLE` 时返回 `false`。
- `apps/worker/src/embedding-job.ts:29-32, 61-71`：`activateStored` 的 `false` 被调用方当作“无可用存量向量”。
- `apps/worker/src/main.ts:441-475`：`false` 后继续选择源对象、读取图片、调用 `embeddingProcessor.infer`。
- `apps/worker/src/embedding-publication.ts:40-42`：真正发布时才抛 `EMBEDDING_SPACE_INCOMPATIBLE`。
- `apps/worker/src/main.ts:1128-1155`：该错误是普通 `Error`，`embeddingRetry` 不识别，`permanent=false`，按普通媒体失败重试。

**触发条件与证据**
1. 常驻 worker 已成功执行过一次 `initializeSpace`（`embedding-space.ts:40-56` 对成功初始化永久 memoize）。
2. 之后模型空间被替换/停用（`EAGLE...` 模型切换，或该 space 的 `isCurrent` 变为 false）。
3. 队列里仍有该 worker 身份下待处理的 `GENERATE_EMBEDDING`（例如 SEND 复制出的向量任务）。
4. 每个任务：`activateStored` → 缓存的 `initializeSpace` 直接通过 → `publishStoredEmbedding` 的 `lockPublicationFacts` 返回 `SPACE_INCOMPATIBLE` → 返回 `false` → 任务继续读原图/预览、下载、发模型请求 → `publishEmbedding` 抛错 → 按普通失败重试；下一次重试重复整套读图+推理。

这与文档“不重新下载或推理可复用向量”的取向相违背，也直接消耗模型与 S3 带宽；而该分支下推理结果注定无法发布（同一身份空间已不兼容）。

**实际影响**
- 模型切换后、旧 worker 尚未重启期间，每个积压任务白做一次（重试上限内多次）原图读取和模型推理。
- 日志与任务中心表现为普通失败，排查时容易误判为模型/网络问题。

**修复方向**
- 区分“没有可复用向量”（返回 false，允许推理回退）与“当前身份空间已不可发布”（返回/抛出独立结果，如 `EMBEDDING_SPACE_INCOMPATIBLE`，worker 直接终态失败或等待显式重建，不进入推理路径）。
- 或在 `processJob` 进入 `infer` 前再确认一次空间兼容性，避免先读图后失败。
- 补一个真实的 `processJob` 级反例：空间在 memoize 后退役，断言不发生 S3 GET 与模型请求。

---

## 问题 2（低，待验证）：活动目标列表在首窗口合并后可能仍保持 invalidated，窗口聚焦可能整段重取

**位置**
- `apps/web/src/components/eagle/asset-operation-refresh.ts:87-90`：先对目标查询 `invalidateQueries({refetchType:'none'})`。
- 同文件 `223-288`：只取消、标记 stale、合并首窗口，未显式清除 invalidated 状态。
- `apps/web/src/main.tsx:8`：`new QueryClient()` 使用默认 `refetchOnWindowFocus`；`SekerEaglePage.tsx:597` 只设置了 asset list 的 `staleTime`。
- `asset-operation-refresh.test.ts` 新用例只断言“关闭的目标查询 `isInvalidated === true`”，没有断言“已合并的活动目标查询 `isInvalidated === false`”。

**待验证点**
TanStack Query v5 中 `setQueryData` 是否会把 `isInvalidated` 复位（该行为取决于安装版本）。若不复位，活动目标列表在首窗口合并后仍陈旧，下一次窗口聚焦/重新挂载会触发整个 infinite query 全部分页重取（十二页即十二个 GET），与本轮“保留已加载分页、只补首窗口”的目标相冲突。

**建议**
- 增加断言：对活动目标查询合并后 `getQueryState(key).isInvalidated === false`；对关闭目标保持 true。
- 若确认不会复位，合并首窗口成功后显式清除陈旧标记（或使用可控的 `setQueryData` + 成功状态/`ensureQueryData` 组合），同时保留失败重试意图。

---

## 问题 3（低）：后台宿主的失败日志丢失具体错误，维护成功计数不再记录

**位置**
- `apps/api/src/asset-operation-background.ts:47-49`：`work().catch(() => logger.warn('operations_background_discovery_failed'))`，丢弃错误对象。
- `apps/api/src/eagle/eagle-maintenance.service.ts:17-42`：现在只返回计数；被删除的 `runScheduledMaintenance` 原来会记录 `eagle_maintenance_failed {error}` 和 `eagle_maintenance_pruned {...result}`。

**触发条件与影响**
`runMaintenance`/`expireLibraryTransfers` 抛错（DB/约束错误、坏 plan、S3 outbox 写入失败等）时，日志只有 `operations_background_discovery_failed`，没有错误消息、类型或堆栈；正常清理也不再输出 `completedJobsDeleted/importRunsDeleted/transfersExpired`。这对生产诊断是可见的退步，但不影响数据正确性。

**修复方向**
在 background 的 catch 中记录 `error instanceof Error ? error.message : String(error)`（不输出敏感键），并在 maintenance 返回非零计数时保留结构化 `eagle_maintenance_pruned` 日志。

---

## 问题 4（低）：Web 端旧的清空回收站客户端契约未同步

**位置**
- `apps/web/src/lib/eagle-api.ts:508-512, 719, 757`：`emptyEagleTrash` 仍声明返回 `{affectedAssetCount:number}`，请求 `POST /eagle/trash/empty`。
- `apps/api/src/eagle/eagle.controller.ts:600-606`：该端点现在返回 `202` + `EagleOperationSummary`（`affectedAssetCount` 不存在）。

**触发条件与影响**
生产代码目前没有调用该函数（`SekerEaglePage` 使用 `enqueueOperation('EMPTY_TRASH')`，`grep` 结果只剩该导出和测试 mock），因此暂无运行时影响。但这是本轮 API 契约变化后遗留的类型谎言：一旦被复用，调用方会把 `undefined` 当作清空数量，且不会跟进后台操作，可能表现为“点了没清空”。

**修复方向**
删除未使用的 `emptyEagleTrash`，或改为入队/跟进操作摘要；至少把返回类型改成 operation summary 并补注释说明 202 语义。

---

## 问题 5（低，文档一致性）：旧的数据库批次配置上限说明已与代码不符

**位置**
- `apps/api/src/eagle/eagle-operation-settings.ts:10`：`OPERATION_DB_BATCH_SIZE` 已移除 `maximum`，超大的 `EAGLE_OPERATION_DB_BATCH_SIZE` 不再启动失败，而是在 `databaseBatchSize` 中按语句行宽钳制。
- `docs/asset-operation-efficiency-2026-10-31.md:41`：仍写“启动时拒绝超过32767参数的保守换算预算”。

**影响**
运维若依赖“配置错误启动即失败”的旧行为，可能误以为把批次调大后仍受启动校验保护；实际会静默按 2340 等容量运行。建议同步该文档，或保留显式的启动期上限校验。

---

## 检查范围与限制

- 已逐段核对：`eagle-asset-operations.service.ts` 的 kind 协议/claim/publishMetadataBatch/失败拆分、`eagle-duplicate-cleanup.ts` 的集合清理路径、`eagle.service.ts` 的有界清空 SQL、两个迁移与触发器语义、发送标签映射与叶子复制预算、向量空间发布与建议证据谓词、人物/统计/智能文件夹读取 SQL、前端刷新协调器与确认框交互。
- 未运行任何命令，因此未复跑 `ci:check`/`test:library-integration`，也未验证 TanStack Query 安装版本内部 `setQueryData` 对 `isInvalidated` 的处理；问题 2 已标注“待验证”。
- 未验证生产镜像、迁移执行与 NAS 实际负载；这些属于发布侧核验，报告不作通过/不通过判断。
- 未发现需要阻塞本次推送的高风险正确性问题；上述建议由主代理独立判断是否采纳。
