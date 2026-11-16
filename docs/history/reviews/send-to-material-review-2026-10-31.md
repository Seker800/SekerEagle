# 发送到素材：数量限制、前端卡顿与发送算法复核（2026-10-31）

> 这是只读复核，没有修改任何代码。基线是提交 `af2c7384`（main）；已核对线上 API 镜像源码 `e332c5f4` 与线上 web 源码 `eb242582` 在这些发送／进度文件上与 `af2c7384` 没有差异，所以下面引用的行号对线上同样成立。复核期间 `codex/asset-operation-efficiency` 分支上出现了 `8b66443f`（移除 1000/20 上限、SEND 4 路并发）、`26e6daeb`（独占存储接管）等修复提交；它们不在 main，本文不把它们当基线，只在第 5 节说明。复核期间仓库里另有两个提交：`0c8a1ad7`（RED 测试）和 `8b66443f`（GREEN：移除 1000/20 上限、分批准入、SEND 4 路并发）。本文把“基线现状”“修复提交”“线上是否已部署”分开写，避免混在一起；第 5 节专门评估 `8b66443f`。
> 文中耗时是按代码路径、对象数量和 S3 往返推算的量级，不是生产实测；要精确数字按第 7 节复测。

## 0. 先回答你三个问题

**① 数量限制从哪来？**
网页前端没有限制。你线上镜像对应的代码（`af2c7384` 基线）限制在后端队列：一次最多 **1000 张**，同一图库最多 **20 个未完成操作**。超出 1000 张时返回的错误是「请选择不重复的资源。」——把“超量”写成了“重复”，文案是错的。复核期间提交 `8b66443f` 已移除这两条（见第 5 节），但它是否已构建/部署到你的线上要单独核对；下面先按你实际遇到的基线讲。

**② 为什么后台发送会卡前端？**
三个原因叠加：

- 发送队列跑在 **API 进程里**，和所有网页请求抢同一个 Node 进程、同一个 Prisma 连接池、同一个 S3 客户端；
- 前端每收到一张发布结果，就把**当前列表分页截回第 1 页再整页重拉**，发送期间约每 4 秒一次；
- 操作列表在发送期间每 **1.5 秒**轮询一次，入队事务还可能等 privacy advisory lock 最长 15 秒。

**③ 发送算法有没有问题？**
不是“算错了”，是“按最笨的方式算”：每张照片都要把**整座图片金字塔一个 tile 一个 tile 地复制**，每个 tile 发 3 次 S3 请求（HEAD 源 + COPY + HEAD 目标），照片之间在 HEAD 版本里完全不并行。一张 6100 万像素照片就是 **355 个 tile、约 1065 次 S3 请求**；1200 万像素约 230 次，2400 万约 420 次。再叠加 Prisma 按关系逐条查询、逐标签 N+1、同一份源数据读两遍、每张一个 30 秒发布事务。这就是“半天一个”的来源，不是网络慢。

## 1. 一次多选发送的完整链路

### 1.1 前端提交（无数量上限）

- 右键菜单只在非回收站、所选全是图片时出现，`assetIds={selectedAssetIds}`（`apps/web/src/components/eagle/SekerEaglePage.tsx:2861-2878`）。
- `EagleSendAssetsMenuItem` 把全部选中 ID 一次 POST 到 `/api/{eagle|photos}/operations`，没有 `slice`、没有分批、没有数量校验（`EagleSendAssetsMenuItem.tsx:29-36`、`useAssetOperations.ts:14-24`）。

### 1.2 后端入队（`af2c7384` 基线的两道上限）

`EagleAssetOperationService.enqueue`（`apps/api/src/eagle/eagle-asset-operations.service.ts:167-323`）：

| 检查             | 值       | 结果                                                                                           |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------- |
| 去重后 ID 数     | `> 1000` | 400「请选择不重复的资源。」（`:169-174`，DTO 同名限制在 `eagle-asset-operations.dto.ts:9-14`） |
| 同库未完成操作数 | `>= 20`  | 409「排队操作较多，请稍后再试。」（`:197-204`）                                                |

入队时按“实况照片组”切 item：普通照片一张一个 item，实况的静止图+运动视频合成一个 item（`:263-285`）。所以 1000 张普通照片 = 1000 个 item，之后逐个执行完整发送。`8b66443f` 删除了上面两条检查，改成 512 一片的准入校验，但“一张一个 item、逐张发布”的结构没变。

入队事务第一步就是 `lockOwnerPrivacyProjection`（`:175-178`），超时 15 秒（`:312`）。后台 worker 也在用同一把锁做隐私投影，所以点击“发送”后先卡几秒是可能的。

### 1.3 领取：`af2c7384` 下一张一张跑（`8b66443f` 改为 4 路）

```ts
// eagle-asset-operations.service.ts:408-420（HEAD）
const candidates =
  lane === 'SEND' || first.operation.kind === 'EMPTY_TRASH'
    ? [first]
    : await tx.eagleAssetOperationItem.findMany({ ..., take: METADATA_BATCH_SIZE });
```

- SEND 固定只领 1 个 item；METADATA 才领 32 个（`:408-420`）。
- 进入领取事务时只要该通道已有 `RUNNING` 就直接返回空（`:387-396`）。
- 领完一张后用 `setTimeout(..., 0)` 再 tick（`:544-556`），所以是“连续但串行”。

## 2. 发送算法复核：时间到底花在哪

### 2.1 每张照片复制的对象数量

`send` 的复制循环（`eagle-library-transfer.service.ts:246-266`）：

1. 原图 + 所有 READY 预览（通常是 thumbnail 256、thumbnail 512、preview 三条），每个对象 `copyObject` 后再 `headObject` 校验长度；
2. 整座图片金字塔（源照片有 READY 金字塔时）：每个 tile 先 `headObject(源)`、再 `copyObject`、再 `headObject(目标)`（`eagle-transfer-pyramid.ts:97-109`）；
3. `runTransferWork` 只在一个 item 内部开 4 路（`eagle-transfer-work.ts:8-12`），照片与照片之间不并行。

按 512px tile 实算：

| 照片尺寸                    | 金字塔 tile 数 | 金字塔 S3 请求 | 加上原图/预览 |
| --------------------------- | -------------: | -------------: | ------------: |
| 4032×3024（1200 万）        |             74 |            222 |          ≈230 |
| 6000×4000（2400 万）        |            138 |            414 |          ≈422 |
| 9504×6336（6100 万）        |            355 |           1065 |         ≈1073 |
| 20000×15000（3 亿像素扫描） |           1618 |           4854 |         ≈4862 |

单张 6100 万像素照片，仅复制就要约 1000 次 S3 往返。按每次 20ms、4 路并发算，约 **5.3 秒/张**；按 50ms 算，约 **13 秒/张**。这已经能解释“半天一个”，而且还没算发布事务。

### 2.2 每张照片的 SQL 数量

- `send` 在发布事务里用 `transferFactIncludes` 重新读整张照片（`eagle-transfer-facts.ts:13-27`）。这个 include 有 11 组关系，其中 `manualTagLinks → tag → group / groupMemberships → group`、`aiTagLinks → aiTag + analysisRun`、`colorAnalyses → swatches` 都是嵌套。Prisma 6.19 没有设置 `relationLoadStrategy: 'join'`，默认按关系逐条查询，一次 include 就是约 **18 条 SQL**，只为了读“这一张照片”的附属数据。
- `copyTags` 对每个标签 `findUnique` 一次，必要时还要 upsert 标签组；每个 AI 标签还要 `create` 分析运行 + `upsert` 标签 + `create` 关联（`eagle-transfer-facts.ts:67-232`）。标签多的照片，单张发布就是 **几十到上百条 SQL**。
- 发布事务里还有：锁两个模式的 privacy projection、锁资源行、`create` 目标 asset、`createMany` renditions、`create` 金字塔、`copyTransferFacts`、`createMany` 处理 job、retire 源、写删除 outbox、更新 transfer。每张照片一个 30 秒事务（`eagle-library-transfer.service.ts:269-505`）。

也就是说，一张照片的成本 ≈ **20～100 条 SQL + 200～1000 次 S3 请求**，而且照片之间串行。这不是“算错”，是固定开销乘以照片数，没有任何批量摊销。

### 2.3 同一份源数据读了两遍

`send` 先 `components` 带 `renditions + imagePyramids` 读一次（`:157-180`），发布事务里又用 `transferFactIncludes` 读一次（`:283-296`）。第一遍只为了生成计划，第二遍才是发布；两遍都是逐关系查询。

### 2.4 大选择会放大失败面

入队时把每张照片的 `mediaRevision`/`rowVersion` 冻结成快照（`:277-285`）。发送队列可能跑几十分钟到几小时；这期间 worker 的人脸分析可能把某张照片改成私密/公开，`syncAssetPrivacy` 会 `rowVersion + 1`（`packages/library-persistence/src/index.ts:58-82`、`apps/worker/src/photo-faces.ts:148`）。一旦版本变了，排队中的这一项就抛「资源已变化」（`eagle-library-transfer.service.ts:224-243`、`eagle-asset-operations.service.ts:489-504`）。

所以大选择不仅慢，还会出现“前面成功、后面一批失败”，体感更像“算法有问题”。

## 3. 为什么后台发送会卡住前端

### 3.1 服务端：队列跑在 API 进程

`EagleAssetOperationService` 由 `EagleModule` 和 `PhotoLibraryModule` 各提供一份（`eagle.module.ts:44`、`photo-library.module.ts:107`），都跑在同一个 API Nest 进程里。也就是说：

- 发送的 S3 复制、Prisma 大对象反序列化、每张一个事务，和网页请求共享同一个事件循环；
- 共享同一个 Prisma 连接池（默认约 `CPU×2+1` 条连接），4 路并发发送会占住多条连接和长时间事务；
- 共享同一个 S3 客户端/连接池（`S3_MAX_SOCKETS` 默认 64），缩略图、预览和发送从同一个池子取连接。

发送本身没有“后台进程”隔离，API 一忙，网页的列表、缩略图、操作轮询就会一起变慢。

### 3.2 前端：每发布一张就把列表退回第 1 页

`useAssetOperationProgress` 只要 `completed` 比上次大，就 schedule 一次刷新（`useAssetOperations.ts:78-93`）。`AssetOperationRefresher.refresh`：

1. 先等该模式所有在途列表请求结束（`asset-operation-refresh.ts:70-90`）——如果用户正在滚动加载，会一直等；
2. 把该模式所有列表缓存的页数截成第 1 页（`:93-97`）；
3. `invalidateQueries` + `refetchQueries`（`:116-128`）。

发送期间每约 4 秒重复一次。用户看到的就是：列表反复跳回顶部、已加载的多页内容反复丢失、照片一张一张消失/出现。这不是“发送占带宽”，是**前端主动把已加载的数据丢掉再重拉**。

### 3.3 前端：1.5 秒轮询 + 入队锁等待

- 有未完成操作时，操作列表每 1.5 秒轮询（`useAssetOperations.ts:38-45`）。
- 入队事务要拿 privacy advisory lock，最长 15 秒（`eagle-asset-operations.service.ts:175-178,312`）。点“发送”后按钮停在“提交中…”，用户看到的就是卡住。

## 4. 其他类似的“自设限制”

### 4.1 安全/资源边界（建议保留）

| 位置                                              | 限制                                   | 理由                 |
| ------------------------------------------------- | -------------------------------------- | -------------------- |
| `packages/library-core/src/media-formats.ts:2-11` | 图片 500MB/1.2 亿像素；视频 5GB/4 小时 | 解码内存与恶意输入   |
| `eagle-upload.dto.ts:90-93`                       | 分片 10000                             | 分片上传协议         |
| `photo-render-core/src/photo-editor-limits.ts`    | 编辑器 4800 万像素/16384 边            | 浏览器画布           |
| `photo-agent.dto.ts:26-31`                        | 单个整理任务 200 张                    | 任务快照与审批规模   |
| `eagle-filter-core/src/index.ts:2-4`              | 智能文件夹 31 条件/30 规则             | 旧查询格式与最坏 SQL |
| `photo-statistics.dto.ts:63-94`                   | 统计 50 个相机/镜头                    | SQL 参数             |
| `eagle-import.dto.ts:71-92`                       | 每 chunk 500 items/2000 folders        | 导入分块协议         |

### 4.2 协议分页（不是限制）

列表 `limit` 最大 100、网页每页 40（`eagle.dto.ts:99-104`）；标签页 120；人物每页 200；Agent 列表每页 100。

### 4.3 任意上限（可以按自用场景放开）

| 位置                                                  | 限制                      | 触发表现                 | 评价                                                          |
| ----------------------------------------------------- | ------------------------- | ------------------------ | ------------------------------------------------------------- |
| `eagle-asset-operations.dto.ts:11`（`af2c7384`）      | 发送 1000 张/次           | 「请选择不重复的资源。」 | `8b66443f` 已移除；但受 100KB body 限制，约 2600 张以上会 413 |
| `eagle-asset-operations.service.ts:204`（`af2c7384`） | 同库 20 个未完成操作      | 「排队操作较多」         | `8b66443f` 已移除；准入控制也随之消失                         |
| `eagle-asset-operations.service.ts:408-420`           | SEND 并发 1               | 逐张                     | 体感像限流                                                    |
| `eagle-transfer-work.ts:9`                            | 单 item 复制 4 路         | 每张内部 4 路            | 可提高或跨 item 并行                                          |
| `eagle-library-transfer.service.ts:105`               | 旧直发接口 100 张         | 仅旧客户端               | 与 1000 不一致                                                |
| `eagle.dto.ts:263-270`                                | 回收/恢复旧接口 100 张    | 旧接口                   | 网页已走队列                                                  |
| `photo-agent.dto.ts` ManualPhotoActionDto             | 审批手动操作 100 项/请求  | 网页按 100 分段          | 服务端同步执行 100 张复制，很慢                               |
| `PhotoAgentReview.tsx:313`                            | 审批通过每 5 条一个请求   | 40 次往返                | 纯前端自设（手动操作是 100 条/请求，`:274`）                  |
| `photo-management.controller.ts:82`                   | 相册/人物组一次 500 成员  | 400                      | 可放宽                                                        |
| `eagle-vector.dto.ts:78`                              | 向量建议批量审核 100      | 400                      | 可放宽                                                        |
| `EagleRuleBuilder.tsx:48,171`                         | 31 条件/30 规则后静默无效 | 点了没反应               | 至少应提示                                                    |

## 5. 复核期间分支上的修复提交 `8b66443f` 的评估

提交 `8b66443f`（`codex/asset-operation-efficiency` 分支，07:40，不是我改的）已经：

- 删掉 `ArrayMaxSize(1000)` 和 `ids.length > 1000`；
- 删掉 `active >= 20` 的入队上限；
- 入队改为 512 一片的 `resolveEagleTrashTargets`/`findMany`，并用 Map 去掉逐项 `find`/`filter`；
- 新增 `SEND_CONCURRENCY = 4`，SEND 一次领 4 个 item，`Promise.allSettled` 并发执行；
- 顺带删掉相机/镜头选项的 `take: 500`。

这个提交解决的是“数量上限”，不是“慢”。方向对，但只解决了一部分：

1. **HTTP body 上限没改**。普通 JSON 仍走 Nest 默认的 100KB（`eagle-edit-request-body.ts:3` 的注释明确说 “ordinary JSON retains its existing small limit”；只有 `/api/photos/agent/requests` 和编辑渲染单独放宽）。5001 个 UUID 约 195KB，DTO 单元测试能过，但真实 HTTP 会在 body-parser 直接 413。也就是说，1000 的上限只是换成了约 2600 的隐性上限，而且错误更不友好。
2. **没有准入控制了**。删掉 20 个操作上限后，客户端可以无限排队；`list()` 又删掉了 `take: 20`，活动操作全量返回，1.5 秒轮询会对所有活动操作的所有 item 做 `groupBy`。操作一多，轮询本身会变成新的慢点。
3. **单张成本没变**。金字塔仍然逐 tile 3 次 S3、Prisma include 仍然逐关系、标签仍然 N+1、发布仍然一张一个事务。并发 4 只能把串行等待压缩约 4 倍，6100 万像素照片仍然要秒级。
4. **前端刷新没变**。仍然是每发布一张截断分页 + 整页重拉。发送变快后，每次刷新会同时“消失”更多照片，跳变更明显；刷新频率本身仍受 4 秒下限约束。
5. **4 路并发仍在 API 进程里**。对“不要卡前端”这个目标，方向是反的：除非把队列移出 API 进程或限制并发，否则前台请求会和 4 路发送抢事件循环、连接池和 S3 socket。
6. **失败面没变**。快照仍在入队时冻结，长队列遇到 worker 更新 `rowVersion` 仍会 `ASSET_CHANGED`。

> 该分支随后还有 `26e6daeb`（发送改为独占存储接管，不再整图复制）和配套迁移。若这些提交合入，本文第 2 节“整座金字塔复制”的成本模型必须重新实测；本文不评价该方案的正确性，按 `docs/library-sharing-gate.md` 独立验收。

## 6. 建议（按“先解决什么”排序，不是排期）

> 本文的取舍规则与预算已沉淀为 [`docs/product-frame.md`](product-frame.md) 和 [`docs/performance-budget.md`](performance-budget.md)。

### 6.1 先让前端不被发送拖住

1. **把发送队列移出 API 进程**：API 只负责入队，复制/发布由 worker 或独立进程执行。这样网页请求和发送不共享事件循环、连接池、S3 socket。
2. **前端只在整批结束（或每 15～30 秒）刷新**，不要在每张发布时截断分页；发送中的源项用本地状态移除，目标项等结束再拉。
3. **不要为了进度牺牲滚动**：`AssetOperationRefresher` 不应该在用户正在翻页时把 pages 截成 1；至少不要在 `fetchStatus !== 'idle'` 时反复等待/截断。
4. 操作轮询从 1.5 秒降到 5～10 秒；入队锁等待给出明确进度，而不是让按钮静默卡 15 秒。

### 6.2 再解决发送算法

1. **去掉每个 tile 的两次 HEAD**：源大小用已有元数据/一次前缀列举，目标只做 COPY 后一次校验；每 tile 从 3 次请求降到 1～2 次。
2. **提高复制并发并跨照片流水**：当前 4 路只在一个 item 内；把 tile 复制提到 8～16 路，并让多张照片的复制阶段重叠（发布仍各自原子）。
3. **批量发布**：同一 operation 的 N 张合成一个事务，`createMany` 写 asset/rendition/pyramid/job/tag link；隐私锁从 N 次降到 1 次。
4. **消除 Prisma N+1**：源事实一次读全；标签/标签组/AI 标签按批 `findMany` + `createMany`，不要逐标签 `findUnique`/`upsert`。
5. **金字塔是否必须整座复制**：如果目标端最终要独立对象，至少可以改成“复制原图 + 目标端按需重建金字塔”，把同步请求量从 O(tiles) 降下来，交给后台处理。
6. **大选择分片入队**：前端或 API 按 200～500 张一个 operation 拆分，避免一个 operation 排几小时、快照大面积过期。

### 6.3 最后处理上限与文案

- 1000 改成明确文案「一次最多 N 张，可分 N 次发送」；如果保留 body 限制，就把 N 设在 body 限制以内。
- 20 个操作上限要么保留一个宽松值（如 200），要么按“排队总张数”而不是“操作数”限制。
- 旧直发接口的 100 张与队列的 1000 张统一，或者下线旧接口。
- 智能文件夹 31/30 达到上限时给提示，不要静默禁用。

## 7. 怎么验证（不用改代码）

1. **确认单张成本**：发 1 张 6100 万像素照片，在 MinIO 侧统计 `CopyObject`/`HeadObject` 请求数，应接近 `tileCount × 3 + 8`；`SELECT "tileCount" FROM "EagleImagePyramid" WHERE ...` 可直接核对。
2. **确认串行**：发 100 张期间查 `SELECT count(*) FROM "EagleAssetOperationItem" WHERE status='RUNNING'`，HEAD 应恒为 1；观察 `completed` 每次 +1。
3. **确认前端刷新**：Network 面板看发送期间每约 4 秒一次 assets 列表请求，且缓存 pages 被截成 1；每 1.5 秒一次 operations 请求。
4. **确认锁等待**：发送时 `pg_stat_activity` 看 `wait_event='advisory'` 和 15 秒事务。
5. **确认 body 上限**：直接用 2600/5000 个 UUID 调 `/operations`，看是 400 还是 413。

## 8. 一句话

不是网络慢，也不是算错：发送把“一张照片”当成“一次完整的对象复制 + 一次独立发布事务”，每张要发几百到上千次 S3 请求，照片之间还串行；前端又在每张发布后把列表退回第一页重拉。所以体感就是“后台在发、前台被拖、半天一个”。真正要治的是**把队列移出 API 进程、批量发布、去掉逐 tile 的冗余 HEAD、前端只在整批结束时刷新**，而不是继续调大超时或加机器。
