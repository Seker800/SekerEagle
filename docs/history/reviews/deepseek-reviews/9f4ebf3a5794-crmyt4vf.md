# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`b0423ca614f334c95e48c65dd8d052acbdce6f55..9f4ebf3a579498dab34ed35472a5e8ead9bbeb3b`
- 完成时间（UTC）：2026-11-02T06:30:39.677296+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/9f4ebf3a5794-crmyt4vf`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 代码审查意见

## 结论先行

在给定的 4 文件推送范围内，**未发现会破坏正确性、权限隔离或完整分页的确定性缺陷**：日期排序两条 SQL 的 `ORDER BY`/`LIMIT` 位置、游标同分顺序、owner／模式／私密／回收／eligibility／媒体版本守卫均与旧实现等价；相关度搜索"按页取候选 + 续页哨兵"的补齐循环也不会漏页、死循环或错误终止。以下 1 条中等风险、1 条待验证回归风险和 1 条测试隔离问题，都是性能／验证层面的建议，不是阻塞项。

---

## 问题 1（中｜性能/可用性，可证实的退化路径）

**位置**：`apps/api/src/eagle/eagle.service.ts:539-567`（重点 `:542` `candidateBatchSize`、`:555` `exhausted`、`:567` `after`）

**触发条件**：分页请求执行期间，有后台批量操作（删除、恢复、私密同步、评级／标签批改）分批提交，导致"排名 SQL 仍看到、随后补详情时已不匹配"的候选连续出现，且当前页已接近填满。

**证据与推理**：
- 现在每轮只取 `query.limit + 1 - ranked.length` 个候选。页面填满到 `limit` 后，缺口恒为 1，于是每丢掉一个候选就再发一轮"排名 SQL + 补详情 SQL"。
- 旧的固定 250 批量会把 250 个失效候选摊到一轮；新写法在同一场景下最多多做约 250 倍轮次。
- 相关度路径的排名 SQL（`eagle-image-search.service.ts:186-202`）每轮都要重建 `candidates`（含语义 `UNION ALL`）再 `GROUP BY`/排序，不是廉价查询；`take=1` 不会让它变便宜。
- 补齐循环本身是安全的：`after` 严格前移（`(tier,similarity,libraryAddedAt,assetId)` 与 `(date,id)` 都是全序），`exhausted = candidateIds.length < candidateBatchSize` 只在确实没有更多候选时为真，`nextCursor` 取 `page.at(-1).position`（不是哨兵行），因此**不会漏页、重复或死循环**，只在极端并发下把一次列表请求放大成大量重查询；若累计超过网关 15 秒读超时（`apps/api/src/proxy-trust.test.ts:17`），用户看到的是整页失败而不是一页结果。

**实际影响**：不是数据／权限问题，是并发批量改动期间的延迟与 504 风险；单 owner 场景下"后台正在批量删除／转私密，同时前台翻搜索页"是可发生组合。

**修复方向**：补偿轮次不要收缩到缺口大小，至少保持一个摊销下限（例如沿用上一次成功批大小，或 `max(deficit, 小常量)`），仍然只把 `limit + 1` 之内用于组装返回页；或对连续丢弃做自适应放大。不要用"截断页"解决。

---

## 问题 2（低｜潜在性能回归，待验证）

**位置**：`apps/api/src/eagle/eagle-image-search.service.ts:174-202`（`sort && UNAVAILABLE` 分支）

**触发条件**：没有可用向量空间（模型离线／空间版本不符）时，做**宽匹配**的名称／标签搜索并显式按日期排序（如搜 `IMG`、`2025` 命中数万项）。

**证据与推理**：旧实现走"按日期索引顺序逐窗口取 64–1000 行、命中满页即停"，宽匹配时基本一次窗口就够。新实现改为先用名称／标签谓词构造 `candidates`→`ranked`（`GROUP BY assetId`）→回连 `EagleAsset`→按日期排序→`LIMIT`；排序与聚合的工作量随匹配总数增长，而非随页大小。是否真的退化取决于优化器能否把 `ranked` 内联成以日期索引为外层的计划，我无法在只读审查中运行 `EXPLAIN`，**这一点明确标注待验证**。

**实际影响**：稀疏／空结果（本轮要解决的"最容易卡"场景）明显受益；宽匹配的日期排序可能从 O(页) 变为 O(匹配数)。生产已就绪向量时该分支不常走，但不能据此认定无影响。

**修复方向**：用一条 SQL 保留索引顺序语义（例如把命中条件放进单条 `ORDER BY date DESC,id DESC LIMIT` 的查询，用 `EXISTS` 表达标签命中），或至少用宽匹配样本做前后 `EXPLAIN (ANALYZE)` 对照后再决定是否接受该权衡。

**相关测试缺口**：新增的六万项空结果回归（`scripts/testing/read-path-performance.test.mjs:75-100`）使用的是 `UNAVAILABLE` 上下文，只验证了上述词法分支；`READY` 日期分支的单语句成本／SQL 条数没有对应的六万项断言。正确性方面 `READY` 分支已有覆盖（`scripts/testing/search-query.test.mjs:452-474` 等价集、`scripts/testing/library-service-isolation.test.mjs:1014-1077` 逐页游标顺序），所以这只是成本回归的缺口，不是正确性缺口。

---

## 问题 3（低｜测试隔离，非产品缺陷）

**位置**：`scripts/testing/read-path-performance.test.mjs:54-65`、`:320-343`、`:420-444`

**证据**：同文件靠前的"稀疏智能文件夹"用例在无当前空间时会 `findFirst(isCurrent) ?? create` 创建并**不清理**一个 `isCurrent: true` 的空间；随后 `prepareRelevanceFixture` 的 `findFirst({ where: { isCurrent: true } })`（无 `orderBy`，也不校验维度／instruction 版本）必然复用该空间，因此新加的 `eagleEmbeddingSpace.deleteMany({ id: { in: searchSpaces } })` 在整套串行运行中通常不会删除任何行，`sekereagle_test` 里会残留一个当前空间。

**实际影响**：不影响本次被测代码；属于测试库残留与跨文件 `findFirst` 选择不确定（目前所有候选空间都是 1024 维，所以尚未失败）。**是否影响完整 CI 顺序需按实际套件顺序核实**。

**修复方向**：让该用例使用自己创建的空间（或在文件级 `after` 里清理由本文件创建／复用的空间），并显式校验维度与 `instructionVersion`。

---

## 已检查且未发现问题

- **SQL 排序／LIMIT 位置**：`READY` 日期分支 `WHERE`（含 seek 游标）→ `ORDER BY date DESC, id DESC` → `LIMIT`（`eagle-image-search.service.ts:147-151`）；词法分支 `ranked` → `JOIN` → `WHERE` 游标 → `ORDER BY` → `LIMIT`（`:198-201`）。位置正确，`LIMIT` 在过滤之后。
- **同分与游标**：两条日期分支都用 `(date, id)` 全序 + 严格 `<` 元组游标；相关度分支 `(tier, similarity, libraryAddedAt, assetId)` 全序，未引入不可比的并列。日期列 `chronologicalAt` / `libraryAddedAt` 在 schema 中非空且有默认值（`apps/api/src/prisma/schema.prisma` 对应模型），不存在 NULL 破坏元组比较的问题。
- **守卫完整性**：`visible` 覆盖 owner、libraryMode、`deletedAt`/`purgeAfter`、`isPrivate`、`eligibility`；语义探针保留 `spaceId`、`status='READY'`、`isCurrent`、`assetRevision=mediaRevision`、`embedding IS NOT NULL`，仍是精确距离，未改成近似召回或固定 top-K（`:112-152`）。
- **权限／私密／回收边界**：新增的六万项稀疏分页测试覆盖了跨 owner、错模式、私密与回收（`:101-204`）。
- **补齐循环终止性**：`after` 每轮至少前移一个候选，`exhausted` 语义正确，`page` 只取前 `limit` 个、游标取页内最后一行的 position，不会因哨兵被丢弃而跳项。
- **照片堆叠**：`readPhotoStacks` 的代表图与成员判定仍走同一 `where`，`matchIds` 只是成员过滤，`limit = ids.length` 与新的按页语义兼容。
- **游标前向兼容**：版本 4 游标、`searchKey` 字段、`position.libraryAddedAt` 在日期排序下仍存放排序日期列，部署前签发的旧游标语义不变。
- **架构一致性**：只取"当页候选 + 一续页哨兵、并发失效再补"与 `docs/architecture.md:34`（"候选 ID 仅按页返回…并发变更导致候选失效时才继续补齐"）及 `docs/read-path-efficiency-2026-11-01.md` 的既有约定一致，没有新增缓存、协议、后台、依赖、schema 或迁移。

## 审查范围与限制

只读审查了快照中的 4 个改动文件与相关上下文（`eagle-search-predicate.ts`、`eagle-search-cursor.ts`、`eagle-asset-search.ts`、`eagle-search-preview.ts`、prisma schema、`eagle-smart-folder-page.ts`、仓库文档与既有集成测试）。未运行任何测试、`EXPLAIN` 或性能测量，未访问真实 NAS／生产数据；"最终整套 test:library-integration 仍在执行"的结论我无法核实，故本文不对其通过状态作任何确认。问题 2 与问题 3 的影响均标注为待验证。

**大白话**：这次改动本身逻辑是对的，SQL 排序、分页游标和权限守卫都没查出错；唯一值得动手的是并发批量操作时"缺口为 1 就一轮一轮取 1 个"的补齐方式，极端情况下会把一次翻页放大成很多次重查询，建议给补偿轮次留个批量下限；另外宽匹配＋日期排序在无向量时的成本变化和测试库残留空间值得再量一次、清一下。
