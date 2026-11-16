# 任务中心架构诊断（2026-10-26）

本文只做只读诊断：没有修改实现、配置、数据库、任务状态或部署，也没有连接生产。结论基于当前工作区代码与既有运行记录，引用行号对应 2026-10-26 的 `codex/map-distribution-points`（HEAD `47387f9`）。

## 结论

任务中心"总出问题"，不是因为它是个状态机而状态机写歪了，而是因为**它不是一个状态机**。

它是一份读时投影（read-time projection）：没有任务表，没有状态迁移写入；"这个任务处于什么状态"在每次查询时由 SQL 从 8 张异构事实表推断；"为什么没在跑"由 API 的覆盖链二次解释；卡片状态再由前端从聚合计数三次反推。同一条规则存在三份实现，任意两份漂移就产生一类 bug。

一个状态机要成立需要三个前提，当前一个都不成立：

1. **一个任务一个状态，状态由单一执行器写入** —— 现在是多写者、每张表的状态词表和租约语义都不同。
2. **迁移显式且有守卫** —— 现在只有 `leaseVersion` CAS，没有迁移函数；非法迁移在类型系统和数据库约束上都合法。
3. **"正在运行"是写入的事实** —— 现在是从时间戳猜（`now()-10min`）。

这三条不补，任务中心就会持续以"修一个症状、长出两个特例"的方式演进，而且每轮修复都要重跑整套跨层验证。

## 一、当前形状

任务中心控制器只暴露一个只读 `overview`（[eagle-task-center.controller.ts](../apps/api/src/eagle/eagle-task-center.controller.ts:41)），真正的"状态"由一段 `UNION ALL` 拼出来（[task-center-query.ts](../apps/api/src/eagle/task-center-query.ts:9)）。

| 来源       | 事实表                                              | 状态词表                                                                            | "正在运行"的判定           |
| ---------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------- |
| 媒体任务   | `EagleMediaJob`                                     | `PENDING/PROCESSING/COMPLETED/FAILED` + `dependsOnJobId`、`availableAt`、`lockedAt` | `lockedAt > now() - 10min` |
| 标签索引   | `EagleTagSemanticBuild`                             | `PENDING/PROCESSING/COMPLETED/FAILED` + `availableAt`、`lockedAt`                   | `lockedAt > now() - 10min` |
| 智能文件夹 | `EagleSmartFolderSemanticSnapshot`                  | `PENDING/BUILDING/READY/FAILED` + `availableAt`、`lockedUntil`                      | `lockedUntil > now()`      |
| 照片地图   | `EaglePhotoMapState`                                | `dirtyAt`、`availableAt`、`lastError`                                               | `lockedUntil > now()`      |
| 对象清理   | `EagleObjectDeletion`                               | `status` + `availableAt`、`lockedAt`                                                | `lockedAt > now() - 10min` |
| 上传入库   | `UploadFinalizationJob`                             | `status` + `availableAt`、`lockedAt`                                                | `lockedAt > now() - 10min` |
| 整理审批   | `EaglePhotoAgentSuggestion` + `EaglePhotoAgentTask` | `PENDING/APPLYING/FAILED/...`                                                       | `APPLYING`                 |
| 操作队列   | `EagleAssetOperationItem`                           | `status TEXT` + `leaseUntil`                                                        | `RUNNING`（字符串）        |

同一个概念有四种写法，存在三种不同的租约表达（`lockedAt` + 魔法窗口 / `lockedUntil` / `leaseUntil`）。这不是风格差异：三者的续租方、过期语义和过期后的回收行为都不同。第 8 项的状态列还是 `TEXT`（[schema.prisma](../apps/api/prisma/schema.prisma:209)），连枚举约束都没有。

补充两个后果容易被忽略：

- 查询没有 `LIMIT`，也不过滤 `COMPLETED`，而页面每 10 秒轮询一次（[EagleTaskCenter.tsx](../apps/web/src/components/eagle/EagleTaskCenter.tsx:49)）。已完成行随资源生命周期保留、没有独立保留策略，轮询成本随图库线性增长。这解释了为什么近期多轮提交集中在覆盖索引、联合统计和候选缓存，而不是功能修复。
- `COMPLETED` 数量与"剩余量"混在同一组计数里，而卡片状态又从计数反推，所以"已完成"的语义随数据增长而漂移。

## 二、五类结构性缺陷

### 1. 卡住永远不会变成失败

证据链：

- `STALE_LEASE_MS = 10 * 60 * 1_000`（[job-claim.ts](../apps/worker/src/job-claim.ts:9)）。
- 租约过期的 `PROCESSING` 行被当作普通候选重新领取，并 `attempts++`（[job-claim.ts](../apps/worker/src/job-claim.ts:96)、[job-claim.ts](../apps/worker/src/job-claim.ts:120)）。
- [job-recovery.ts](../apps/worker/src/job-recovery.ts:8) 只做"失败依赖传播"，不回收孤儿 `PROCESSING`。
- `failJob` 只在持有租约的 worker 自己捕获到错误时调用（[main.ts](../apps/worker/src/main.ts:1188)）。

后果：worker 崩溃、被 OOM kill 或断网时，任务停在 `PROCESSING`，10 分钟后界面显示"排队中"，任务被静默重领并消耗重试预算。`attempts` 在领取时自增、在等待模型时回退（[embedding-retry.ts](../apps/worker/src/embedding-retry.ts:6)），所以它既不是执行次数，也不是失败次数。用户永远看不到"这一项丢了"。

这是"状态不对"类反馈的最大单一来源：一处卡住，表现为排队；再卡一批，表现为整卡不动。

### 2. 同一条规则三份实现，漂移是结构性的

| 层                       | 实现位置                                                                                                                                                       | 职责                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 领取（真实决定能不能跑） | `scheduled-media-candidates`、`processing-policy`、[job-claim.ts](../apps/worker/src/job-claim.ts:71)                                                          | 车道、依赖、白名单、时段、公平轮次、租约 CAS |
| 解释（告诉用户为什么）   | [eagle-task-center.service.ts](../apps/api/src/eagle/eagle-task-center.service.ts:176)                                                                         | 一段顺序覆盖链，先命中者赢                   |
| 展示（卡片状态）         | [task-center-labels.ts](../apps/web/src/components/eagle/task-center-labels.ts:171)、[task-scheduling.ts](../packages/library-core/src/task-scheduling.ts:157) | 从聚合计数反推                               |

已发生的故障：10-26"worker 在线掩盖模型断连"——因为 `workerOwned && !workers.length`（[eagle-task-center.service.ts](../apps/api/src/eagle/eagle-task-center.service.ts:191)）排在模型可用性判断（同文件 195 行）之前，worker 在线就永远轮不到模型原因。修复方式只能是在链里再插一个分支。

这类缺陷的特征是：每增加一种等待原因，需要在 4 个地方同步修改（覆盖链、`taskSection`、`taskExecutionLabel`、`taskStatus`），漏一处就出现"明明在等模型却显示未启用"。

### 3. 全局状态位有两个写者

历史故障：10-26 生产采样 50 次 200 / 50 次 503、约 15 秒一个停顿循环，而同一时刻模型健康检查是 READY。触发点已在并发提交 `47387f9` 中拆开——503／429 现在映射为 `HOST_BUSY` 并按有界 `Retry-After` 退避（[embedding-client.ts](../apps/worker/src/embedding-client.ts:131)），不再把整条向量通道置为离线。**这一处已修，下面的结构问题仍在。**

`embeddingReadiness` 仍然是一个进程级单值，由两个写者共同修改：

- 健康检查（[main.ts](../apps/worker/src/main.ts:163)）写入宿主真实状态；
- 任务失败路径（[main.ts](../apps/worker/src/main.ts:1191)）写入由单次请求结果推断出的状态。

而 NAS 通道、向量通道、语义文件夹与标签构建都读这一个值，API 与 UI 也只能拿到这一个全局枚举。于是"某类任务的若干次真实断连"仍然等于"整个进程的向量能力离线"，"某个账号的任务持续失败"也会被写进全进程状态。

彻底修法不是继续细分错误码，而是拆成两个事实：**宿主健康**（只由健康检查写，不由任务错误翻转）与**当前容量／退避**（由任务结果写，带过期时间）。这也是缺陷 5"多写者"在状态位层面的同一形态。

### 4. 状态用聚合数表达，UI 再从数反推

`taskStatus` 的规则是 `running > 0 → RUNNING`，并给 `EMBEDDING` 单独加了 `WAITING` 特判（[task-center-labels.ts](../apps/web/src/components/eagle/task-center-labels.ts:171)）。

后果：

- 一个卡住的 `running` 会按住整张卡片，无法表达"999 项在排队、1 项卡住"。
- 每种新原因都要在展示层加特例。目前特例点已有 4 处，特例数量直接等于用户感受到的"总出问题"。

### 5. 双份状态，且没有单一写入口

- `EagleMediaJob.status` 与 `EagleAsset.lifecycleStatus` 并行维护；重试时还要专门补 `restored` 分支恢复 `lifecycleStatus`（[eagle-task-center.service.ts](../apps/api/src/eagle/eagle-task-center.service.ts:105)）。
- `retry()` 按 family 手写分支，其中 5 类直接 `return 0`（[eagle-task-center.service.ts](../apps/api/src/eagle/eagle-task-center.service.ts:90)）。
- 写点分散在上传、导入、worker、API 和运维脚本；没有迁移函数，也没有迁移级 `CHECK` 约束（现有 `CHECK` 只约束取值域，不约束 状态 A 只能到 状态 B）。

已发生的故障：10-25 导入历史 `RUNNING` 误报，最终处理是把整个 `IMPORTS` 来源**排除出投影**（[background-work.md](background-work.md:50)）。这是绕开而不是修复，同时暴露出投影无法表达"这个来源根本没有实时协议"。

## 三、为什么测试和文档没挡住

当前任务中心相关回归约 62 项（服务 12、组件 22、标签 3、调度纯函数 5、领取 8、候选 12）。这些测试**按实现写**：它们断言当前优先级顺序、当前计数映射，改一个优先级就要改断言，红灯绿灯都只是复述代码。它们不验证跨层不变量，例如"解释层说的原因"与"领取层实际拒绝的原因"是否一致。

文档反而已经写下了正确的不变量：[architecture.md](architecture.md:42) 明确"不以队列存在推断正在处理"。但这条规则只存在于文字里，没有落到类型、唯一函数或数据库约束上——所以实现每天都在违反它，而没有任何检查会失败。

## 四、不要做什么

- **不要新建统一任务表或复制队列。** 那会形成第 9 份事实，直接违反"不复制任务队列或业务执行器"的既有边界，并且需要 8 个来源的写入方全部改道。
- **不要整体重写。** 风险远大于收益：上传、导入、worker、API、运维脚本都是既有写点。
- **不要继续靠加索引解决。** 那是投影架构的税，轮询频率和已完成历史不变，索引只会越加越多。

## 五、建议顺序（若将来实施）

| 步骤 | 内容                                                                                                                                                    | 能消灭哪类缺陷                    | 风险                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------- |
| 1    | 在 `library-core` 抽一个纯函数 `evaluate(task, context) → { state, reason, nextAt }`；worker 领取前的最终判定与 API 解释共用；先只接媒体 + 向量两个来源 | 缺陷 2（规则漂移）、缺陷 4 的一半 | 低，可并行双跑对比   |
| 2    | 让"运行中"成为写入事实：领取时写 `lockedUntil = now + lease`，心跳续租；过期由回收器写显式 `LOST`/`FAILED` 迁移并留痕，不再静默重领                     | 缺陷 1、缺陷 5 的回收部分         | 中，需要新增回收路径 |
| 3    | 每个来源一个适配器，统一 `TaskView` 契约；`reason` 由适配器给出（它才知道自己的前置），取消 API 覆盖链；UI 只消费 `state`                               | 缺陷 2、4、5                      | 中，需同步改前端     |
| 4    | 拆分全局位：宿主健康只由健康检查写，容量／退避由任务结果写且带过期；`READY/OFFLINE/DRIFTED` 之外补 `BUSY` 语义到 API 与 UI                              | 缺陷 3                            | 低，独立可做         |
| 5    | append-only 迁移记录 + 完成记录保留策略，轮询改为增量或分页                                                                                             | 缺陷 1 的可观测部分、轮询成本     | 中，需要迁移         |

步骤 1 和 4 相互独立，可以先做其中任意一个；步骤 2 依赖步骤 1 的 `evaluate` 语义稳定。

## 六、收敛的验收标准

将来实施时，用这 5 条判断是否真的收敛，而不是看又修了几个症状：

1. 同一 fixture 下，解释层与领取层对 `claimable`／`reason` 的结论完全一致（跨层 property test）。
2. 任何 `PROCESSING` 行在租约过期后，必须产生一次显式迁移记录，不允许无痕重领。
3. 卡片状态只由 `state` 决定，不再从计数反推。
4. 模型"繁忙／离线／配置漂移"三态互不覆盖，且单任务错误不写全局状态位。
5. 任务中心查询成本不随已完成历史线性增长（有保留策略或增量读取）。

## 七、复现方式

统计近期该链路的提交构成（只读 `git log`，未连接生产）：

```bash
git log --oneline --since="2026-09-20" -- \
  apps/api/src/eagle/eagle-task-center.service.ts \
  apps/api/src/eagle/task-center-query.ts \
  apps/web/src/components/eagle/EagleTaskCenter.tsx \
  apps/web/src/components/eagle/task-center-labels.ts \
  apps/worker/src/job-claim.ts \
  apps/worker/src/scheduled-media-candidates.ts \
  packages/library-core/src/task-scheduling.ts
```

结果：28 次提交中 16 次为"修复"。集中度说明这是结构性返工，不是零散 bug。
