# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`8fcd2265abfcbe0a0c94d078017e8bf747cf2a7f..d8a4d8cf6866c62e5fcc8d1049cb61807af060ba`
- 完成时间（UTC）：2026-10-30T16:58:07.405972+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/d8a4d8cf6866-_els8b5b`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 独立审查报告

审查对象：`8fcd2265abfcbe0a0c94d078017e8bf747cf2a7f..d8a4d8cf6866c62e5fcc8d1049cb61807af060ba`（只读快照，未修改文件、未运行命令）。
需求背景：2B 向量搜索严重卡顿、旧安卓端只能报错，需确认新版安卓客户端是否真的可用；本次改动为原生取消列表 HTTP、UNAVAILABLE 降级提示、API 日期搜索有界窗口、私密拍摄日期索引。

## 结论摘要

核心 SQL 的**结果集语义**（owner/模式/私密/回收站/当前媒体版本/space 校验、名称/人工标签/向量三路 tier 与 similarity、日期+id 游标）我逐项对照后未发现确定性错误；安卓侧的取消令牌绑定、代际校验、`onCleared` 断开也是完整的。

但"新版安卓是否真的可用"这个总目标，我认为**当前证据不足以给出肯定结论**：日期窗口对稀疏/零命中搜索仍要扫完整个可见集，而生产网关对 `/api/` 是 15 秒读超时、客户端没有服务端中止或语句期限；文档自己记录的 16.007 秒首轮样本在用户路径上会直接变成 504 错误（即原始症状），而不是"慢"。此外降级提示在安卓上放在网格末尾、且没有 live region，长结果下用户/读屏很可能看不到。

## 发现一（高，需求风险，实际耗时待实测）：稀疏/零命中搜索仍可能全库扫描并被网关 15s 截成 504

**位置**
- `apps/api/src/eagle/eagle-image-search.service.ts:103-171`（`windowSize` 在 123，窗口循环 125-170；只在 `page.length >= limit` 或 `rows.length < windowSize` 时返回）
- `apps/api/src/eagle/eagle.service.ts:559-586`（`candidateBatchSize = 250`，`exhausted = candidateIds.length < 250`，`ranked.length <= query.limit` 循环）
- `deploy/gateway/nginx.conf:72-83`（`/api/` 的 `proxy_read_timeout 15s`，第 80 行）
- `apps/android/app/src/main/kotlin/com/sekereagle/android/NativeSession.kt:324-327`（列表读超时 30s，实际先被网关 15s 截断）
- 文档证据：`docs/android-search-verification-2026-10-31.md:9`（"网关近期搜索日志尾部可见504"）、`:18`（"切换后首轮……16007ms"）

**触发条件**：6.4 万级图库中，关键词命中少于 250 项——包括零命中、仅命中较旧照片、以及筛选后命中稀疏。这是最常见的"搜了个不存在的词""描述只对上一两张旧图"场景。

**证据/推理**：`rankPage` 收到 `limit=250`，必须凑满 250 个命中或扫到可见集末尾才返回；API 侧为了 60 项结果也要等这个 250。日期窗口每轮 1000 行、逐行做人工标签 LATERAL + 当前向量 LATERAL，64k 库最坏要 64 个串行窗口。代码里没有总窗口数/时间预算，也没有对客户端断开的服务端中止（列表控制器直接返回 promise；只有媒体读取有 `AbortController`，见 `apps/api/src/eagle/eagle.controller.ts:657-666`），`PrismaService` 也没有全局 `statement_timeout`（仓库内未配置）。因此网关在 15s 返回 504 后，被测查询仍会继续占数据库；用户重试会叠加。

**实际影响**：这不是"慢"，而是错误。安卓 `NativeSession.Failure(504)` 会走 `load` 的 catch，显示"服务器暂时无法处理请求（504）"+重试，正好复现"只会报错"。文档记录的 16.007 秒样本在这种配置下要么被截成 504，要么说明该测量未经过网关——两种情况下都不能作为"客户端可用"的证据。文档只写了"可能更慢"，没有把这个长尾与网关 15s 的硬截止对上。

**修复方向**：给日期窗口循环加服务端时间/窗口预算（`statement_timeout` 或 deadline），超限时返回已匹配结果并明确标注不完整/可继续；把首屏的候选批次从 250 降到 `query.limit + 1` 或让服务按用户页大小提前返回；列表请求在连接关闭时中止查询；对零命中/稀疏命中在 6.4 万库上补测，并核实 16.007s 样本是否经过生产网关。

## 发现二（中，性能风险，需实测）：带结构化筛选的搜索会把整份合格 ID 列表在每个日期窗口重复绑定

**位置**
- `apps/api/src/eagle/eagle.service.ts:545-555`（`hasStructuredFilters` 时把全部合格资产 id 拉成数组）、`:569`（传入 `rankPage`）
- `apps/api/src/eagle/eagle-image-search.service.ts:94-96,137`（`visible` 里的 `asset.id = ANY($n::text[])`，被每个窗口查询使用）

**触发条件**：任一结构化筛选（`formats`、`rating`、`rules`、`createdFrom/createdTo`、`manualTagIds`、`smartFolderId` 等）与关键词同时存在，且关键词命中稀疏。安卓的空筛选不会发参数（`NativeLibraryControls.kt:32-58`），所以这是"用户确实加了筛选"时的路径。

**证据/影响**：`eligibleAssetIds` 可能达到数万条（例如只筛 `formats=jpeg`，几乎覆盖全库）。改动前日期搜索是一次查询、绑定一次该数组；改动后同样的数组会在每个日期窗口查询里作为 `$n` 重新编组、规划、逐行求值，最坏每个 `rankPage` 调用重复数十次，外层还可能有多次 `rankPage`。这是既有"先取全量 ID"设计的放大，不是本 diff 引入取 ID 逻辑，但会显著放大发现一的长尾。

**修复方向**：日期路径不要再把合格集物化成 JS 数组传入每个窗口，改为把结构化条件下推成 SQL / 一次性物化到临时表或 CTE；或至少限制窗口数与单次参数体积，并补测"筛选 + 稀疏关键词"的耗时。

## 发现三（中，需求呈现 + 可访问性）：降级提示放在网格末尾，长结果下不可见、读屏不播报

**位置**
- `apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryScreen.kt:363-366`（作为 `item(...)` 追加在 `state.items` 和 loading item 之后）
- 对比同文件 `:244-264` 已有顶部搜索条件行；网页对照 `apps/web/src/components/eagle/SekerEaglePage.tsx:2092-2097`（顶部 `statusBar` + `role="status"`）

**触发条件**：服务端返回 `UNAVAILABLE`，且结果超过一屏（或用户继续加载更多，提示被推得更远）。

**证据/影响**：`LazyVerticalGrid` 只组合视口附近项，提示在最后一项，用户初始看不到；文本 `Text` 没有 `liveRegion`/`role`，TalkBack 不会主动播报。网页端把同一提示放在网格上方并用 `role="status"`，安卓与之不一致。需求明确要求"呈现向量 UNAVAILABLE 时的名称/人工标签降级"，放在末尾等于大概率没有呈现。

**修复方向**：把提示移到顶部搜索条件行附近（或固定顶部），并加 `Modifier.semantics { liveRegion = LiveRegionMode.Polite }`（或等价 role），使读屏能播报。

## 发现四（低，测试缺口/注释准确性）

- **UNAVAILABLE 日期路径的名称/人工标签回退没有结果级测试**：`apps/api/src/eagle/eagle-image-search.service.test.ts:112-143` 对 UNAVAILABLE + 日期只断言 SQL 字符串，mock 返回 `[]`；`scripts/testing/library-service-isolation.test.mjs:976-1041` 的日期分页对照用的是 READY 上下文（语义命中），没有覆盖"向量不可用、仅名称/标签命中"的日期结果；现有 UNAVAILABLE 回退结果测试只在相关度路径（同文件 1115-1133）。若日期路径回退丢结果，现有测试抓不到，而安卓提示恰恰承诺了这一点。
- **安卓测试名不副实**：`apps/android/app/src/androidTest/kotlin/com/sekereagle/android/NativeSearchTest.kt:680-696` 的 mock 对任何查询都返回同一资产，`items.size == 1` 只能证明"客户端保留了服务端返回项"，不能证明"名称命中未被丢弃"。
- **索引只验证存在、未验证被使用**：`scripts/testing/library-service-isolation.test.mjs:2872-2879` 只查 `pg_indexes`；迁移注释 `apps/api/prisma/migrations/20261030160000_private_photo_search_order/migration.sql:3` 写"without heap visits"，但 `ordered` CTE 读取了 `normalizedDisplayName`/`originalName`/`mediaRevision`（不在该索引内），窗口行仍需回表；索引避免的是排序/全表扫描，不是堆访问。建议补 EXPLAIN 断言或修正注释。

**修复方向**：补"离线/不兼容向量 + 仅名称或人工标签命中"在两种模式、两种排序下的结果断言；让安卓 mock 按查询返回；迁移注释改为"避免全堆扫描/排序"，必要时用 EXPLAIN 验证。

## 已核查、未发现确定性问题的部分

- 日期路径与相关度路径的**结果集等价性**：per-asset `max` 相似度再与阈值比较、名称 tier 3 / 人工标签 4-5 / 语义 1、`similarity` 取值与相关度路径一致；owner/模式/`deletedAt`/`purgeAfter`/`includePrivate`/`eligibleAssetIds`/当前 `spaceId`/`isCurrent`/`assetRevision=mediaRevision` 守卫齐全；`date`/`orderDate` 与游标 `< (date,id)` 一致，`timestamp(3)` 毫秒精度下不会因截断漏/重。
- **游标**：`searchKey` 含 `searchFilters`（含 sort）、`context.status`、`spaceId`、trash、includePrivate、阈值；`decodeImageSearchCursor` 校验 owner/mode/version/position，跨排序/跨用户复用在测试中已拒绝。
- **SQL 注入/越权**：`normalized`、`spaceId`、`vector`、`windowSize`、`assetId`、`eligibleAssetIds` 均参数化；`date` 来自固定字面量；owner/mode 来自认证主体和模块注入，未接受 DTO。
- **索引/迁移**：新索引列顺序 `(ownerId, libraryMode, isPrivate, deletedAt, chronologicalAt, id)` 与公开+非回收+非私密的等值前缀完全匹配；schema `map` 同名；迁移排序在 `20261029130000` 之后，共 63 个迁移，与文档一致。
- **安卓取消**：`NativeTransferCancellation.bind/cancel` 会断开阻塞中的 `HttpURLConnection`；`page` 的令牌真正传到 `session.json`；`load/refresh/loadPrevious/sort/switchMode/logout/expire/onCleared` 均接入 `cancelOperation`，代际校验防止旧结果发布；未改动超时/响应预算/签名限制。
- **架构/边界**：两种模式仍共用 `EagleImageSearchService` 与 `EagleService`（`eagle.module.ts` / `photo-library.module.ts` 注入 `LIBRARY_MODE`），没有新增照片专用 provider、队列或模型/worker 改动；与 North star 新增段落一致。
- 版本号 0.9.12/29 与文档、APK 名一致；未发现遗留 0.9.11 活动引用。

## 检查范围与限制

- 只做静态只读审查，未运行测试、构建、EXPLAIN 或任何查询；上述"耗时/是否 504"为基于代码结构与仓库内 `deploy/gateway/nginx.conf`、`deploy/mac/docker-compose.yml:187-201` 的推断，**实际生产网关容器配置与 16.007s 样本的测量路径待核实**。
- 无法在快照中核验：APK 字节数/SHA256、APK 运行代码"对应 e459、后续只改 API/测试/文档"的提交映射、80 项 JVM/18 项设备/覆盖率等自述数据。
- 未连接实体手机，旧端具体报错原文确实缺失（文档已如实标注），因此"旧错误根因"与"真机可用性"均未确认；当前只有模拟器 + 生产普通登录的证据。
- 若主代理能补一次"零命中/稀疏命中经生产网关"的实测，并核对 16s 样本路径，发现一的严重程度即可从"高（待验证）"落定为确定问题或排除。

**一句话大白话**：核心 SQL 和安卓取消逻辑本身是对的，但搜不到东西或只搜到少数旧图时，新版本仍可能把 64k 库扫一遍，超过网关 15 秒就还是弹 504 报错；另外"向量不可用"的提示藏在列表最底下、读屏也不念，长结果下等于没提示。建议先补一个经网关的稀疏/零命中实测，把提示挪到顶部，再决定是否算"新版真的可用"。
