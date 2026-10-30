# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`5ef2f2e842cac80809f45773a372a0c219de399f..2cf0d37789b321073fe8cdac5fe2caade026fbcf`
- 完成时间（UTC）：2026-10-30T05:31:20.709076+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/2cf0d37789b3-kpgrf5lr`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 独立审查报告：5ef2f2e8..2cf0d377（SekerEagle 前端架构修复）

## 0. 审查范围与方法

- 只读取固定快照 `snapshot/`，未运行测试、未构建、未访问原工作区、未修改代码。
- 重点按调用者要求核查四条线：F2 实体引用回收与在途／权限撤销竞态、F3 版本事实回退、F4 部分成功与刷新／重试集合、D2 模式工厂是否遗漏操作或引入跨模式请求。
- 另外核对了 F5 关系刷新接线、F6 详情键迁移、D3 `saved/initiated` 语义，以及新增测试与文档表述。
- 限制：快照内没有 `node_modules`，无法直接阅读 `@tanstack/query-core@5.104.5` 的 `resetQueries` 实现；因此凡是依赖该库“会话/权限重置时是否中止在途请求”的结论，均标注为**待验证**，并给出可执行的验证方式。未运行浏览器／Electron 整机，不评价真实堆内存、FCP/LCP。

---

## 1. 结论摘要

- **F3（版本事实回退）**：在“服务端同一资源的 `updatedAt` 随写入单调递增”的前提下，未发现可证实的回退路径。元数据 `rowVersion`、媒体 `mediaRevision`、同版本处理时间／状态／派生集三层守卫与实现一致，交叉测试也覆盖了主要乱序组合。
- **D2（模式工厂）**：未发现遗漏操作或跨模式请求。六个工厂的返回键集与各自模块级导出一致，所有请求仍经 `libraryApiPath(..., libraryMode)`；工作区工厂按模式组合，无方法名互相覆盖。
- **F4（并发池）**：首错停止领取、等待在途项排空、失败后 `onSettled` 刷新、结构化 `retryItems` 与界面重试集合基本成立；`LibraryUploadQueue` 的 worker 自行捕获错误，因此通用池的“首错停止”未改变上传批次行为。
- **F2（引用回收）**：规范化实体与页面引用的生命周期设计基本自洽，但**在途请求与权限撤销的竞态保护依赖一个未在仓库内验证的库行为**，且新测试未覆盖真实 Query 路径。这是本次最值得补验证的点（见 2.1、2.2）。
- **F5／F6／D3**：主路径实现与需求一致；但 F5 的隐私分支测试被改成 `false` 后失去覆盖，且 SekerEaglePage 到真实关系刷新函数的接线没有集成级验证（见 2.3、2.4）。
- 文档中“代码修复验收版本为 `1a78d1a5`”与本次固定快照 tip `2cf0d377` 不一致，需确认或更新（见 2.5）。

---

## 2. 问题与风险

### 2.1 P2（条件性，待验证）：权限撤销路径用 `resetQueries`，在途列表响应可能绕过 `throwIfAborted` 重新写回实体

**位置**

- `apps/web/src/components/eagle/SekerEaglePage.tsx:587-595`（列表 `queryFn` 的 `signal.throwIfAborted()`）
- `apps/web/src/components/eagle/SekerEaglePage.tsx:641-663`（`resetAssetPrivacyState`：`assetStore.clear()` 后调用 `resetQueries`）
- `apps/web/src/components/eagle/eagle-workspace-cache.ts:145-164`（`retain(true)` 清理走 `removeQueries`）
- `apps/web/src/components/eagle/eagle-workspace-cache.ts:121-142`、`166-186`（引用登记与 `#collect`）

**触发条件**

隐私可见性开关、隐私规则版本或带隐私语义的标签写入触发 `resetAssetPrivacyState`（`onAssetPrivacyChanged` 或 `privacyStateRef` 变化），同时一条列表查询仍在途（例如 PRIVATE 视图的慢请求、或撤销前已发出的请求）。

**证据与机制**

- `resetAssetPrivacyState` 先同步 `assetStore.clear()`，再 `void queryClient.resetQueries({ queryKey: queryKeys.root })`。
- 列表 `queryFn` 唯一的在途写回保护是 `signal.throwIfAborted()`；只有查询信号被中止时它才会阻止 `assetStore.normalizePage(page)`。
- `retain(true)` 的硬清理路径使用 `client.removeQueries(...)`（`eagle-workspace-cache.ts:154`），该路径会销毁查询并中止请求，因此是安全的；**隐私重置路径使用的是 `resetQueries`**。
- 本快照无法确认 `@tanstack/query-core@5.104.5` 的 `resetQueries` 是否对在途 retryer 调用 abort。若它只是重新 dispatch 初始状态（`Query.reset` 的常见行为）而不取消在途请求，则：响应通过 `throwIfAborted` → `normalizePage` 在 `clear()` 之后把实体重新写回 → 该查询的 success 事件又会把实体 ID 重新登记进 `#entityReferences`，`retainOnly` 会继续保留这些实体；查询缓存也会保留撤销前的页面。
- 即使 `resetQueries` 会触发后续 refetch，`#entityReferences` 也不会在 `clear()` 时清空，需要等该查询下一次 success 才被替换；这本身不致命，但会在竞态下放大上述问题。

**影响**

若确认 `resetQueries` 不中止在途请求，则“隐私撤销后共享实体仓库/查询缓存立即清理”的保证在慢请求下不成立；这是隐私边界问题，且与 F2 的引用回收不变量叠加。目前证据不足以断言一定发生，因此标为待验证，但应优先补测试。

**修复方向（建议）**

1. 在 `resetAssetPrivacyState` 中显式先 `await queryClient.cancelQueries({ queryKey: queryKeys.root })`（或在隐私硬清理时用 `removeQueries`），再清空实体并 `resetQueries`；或者给 `EagleAssetEntityStore` 增加 generation/epoch，`normalizePage` 与 queryFn 携带生成号，过期写入直接丢弃。
2. 在硬清理时同时清空工作区缓存的 `#entityReferences`，避免旧引用残留。
3. 增加回归测试：用 deferred 的 `listEagleAssets` 模拟在途页面，触发隐私撤销后 resolve 旧请求，断言 `assetStore.size` 不增加、对应查询数据不复活；并先确认 pinned 版本 `resetQueries` 的实际中止语义。

---

### 2.2 P3：F2 的“独立详情引用”在生产路径中没有被真正使用，新增测试不能证明该保证

**位置**

- `apps/web/src/components/eagle/eagle-workspace-cache.ts:189-215`（`queryAssetReferences` 的 `asset-detail` 分支）
- `apps/web/src/components/eagle/eagle-asset-entity-store.ts:64-68`（`normalizePage` 是唯一的生产写入入口）
- `apps/web/src/components/eagle/SekerEaglePage.tsx:785-793`（详情查询直接返回给组件，没有 `upsertMany`）
- `apps/web/src/components/eagle/eagle-workspace-cache.test.ts:194-210`

**证据**

- 生产代码中向 `EagleAssetEntityStore` 写入的只有 `normalizePage`（列表页）和 `mergeProcessingUpdates`（仅更新已存在实体）；详情查询 `selectedAssetQuery` 的 `EagleAsset` 从不进入实体仓库。
- 新测试先手动 `cache.store.upsertMany([detail])`，再走详情查询引用，因此“详情引用保护实体”的断言是测试自己构造的状态，不是生产路径。
- 真正有意义的是 `#collect` 中“详情查询有数据则不销毁工作区”的守卫（`eagle-workspace-cache.ts:170-176`）；`queryAssetReferences` 的详情分支在当前代码下只会保留一个没有 UI 读取者的实体。
- 新测试都通过 `normalizePage` / `setQueryData` 直接构造数据，没有用真实 `useInfiniteQuery` 验证“0ms 收集定时器与查询 Promise 发布”的时序；`signal.throwIfAborted()` 与收集定时器的竞态也没有回归测试。

**影响**

当前没有发现功能错误，但测试可能“通过”而生产保证并不成立；后续重构列表/详情写入路径时，容易误以为详情引用已被验证。

**修复方向**

- 若详情确实不需要进入实体仓库：在文档/注释中明确“详情只保护工作区生命周期，不参与实体引用”，并考虑删除冗余的详情引用分支；若要保留，就补一个真实 Query + deferred 响应 + 删除查询后收集的测试。
- 补一条真实 `useInfiniteQuery` 的时序测试：页面 normalize 后、success 发布前触发一次收集，断言实体不被误回收。

---

### 2.3 P3：F5 的 `privacyChanged: true` 分支测试被改成 `false`，该隐私路径失去覆盖

**位置**

- `apps/web/src/components/eagle/EagleVectorWorkspace.test.tsx:309-346`
- `apps/web/src/components/eagle/EagleVectorWorkspace.tsx:338-359`（`if (result.items.some(({ privacyChanged }) => privacyChanged)) onAssetPrivacyChanged?.()`）

**证据**

- 唯一覆盖确认建议的测试把 `privacyChanged: true` 改成 `false`，并断言 `onAssetPrivacyChanged` 未被调用；全仓没有再断言 `privacyChanged: true` 时调用 `onAssetPrivacyChanged` 的测试。
- 这与需求“普通 ACCEPT 不伪造隐私事件”不矛盾，但把“真正的隐私变化必须触发重置”本身也从测试集中移除了。

**影响**

若未来把 `onAssetPrivacyChanged` 的调用条件删掉或调换顺序（例如先关系刷新后隐私重置），测试不会发现；F5 明确区分普通确认与隐私变化，这条分支值得单独保护。

**修复方向**

- 增加一条 `privacyChanged: true` 的用例，断言 `onAssetPrivacyChanged` 与必填的 `onAssetRelationsChanged` 都被调用（必要时断言先重置后刷新）。

---

### 2.4 P3：F5 的实际接线没有集成级测试

**位置**

- `apps/web/src/components/eagle/SekerEaglePage.tsx:1962-1965`（把 `onAssetRelationsChanged` 接到 `refreshEagleAssetRelations`）
- `apps/web/src/components/eagle/SekerEaglePage.test.tsx:198-213`（`EagleVectorWorkspace` 被 mock，只保留 `view`/`onTrashAssets`）
- `apps/web/src/components/eagle/EagleVectorWorkspace.test.tsx`（所有用例的 `onAssetRelationsChanged` 都是 `desktopCache.invalidateDesktopAssets`）

**证据**

- 组件测试验证“确认后调用回调”，刷新单元测试验证“回调里的 invalidate 范围”，但没有任何测试把 `SekerEaglePage` 的真实回调（`refreshEagleAssetRelations`）接到向量工作区的 ACCEPT 上。
- 目前 correctness 依赖代码阅读与类型检查（必填 prop 能防止漏传，但不能防止传错函数或传错 `queryKeys`）。

**影响**

如上接线被误改（例如改成只 invalidate 向量摘要、或用了错误作用域），现有测试仍然全绿；这是 F5 的核心声明，验证强度偏低。

**修复方向**

- 增加一个 SekerEaglePage 集成用例：mock `EagleVectorWorkspace` 为“可触发 `onAssetRelationsChanged(['asset-1'])`”的桩，断言列表/详情/标签/智能文件夹/向量摘要对应查询被 invalidate；或在向量工作区测试里传入真实 `refreshEagleAssetRelations` 与 QueryClient。

---

### 2.5 P3（待验证）：处置文档的“代码修复验收版本”与本次固定快照 tip 不一致

**位置**

- `docs/frontend-architecture-remediation-2026-10-30.md:3`：“代码修复验收版本为 `1a78d1a5`”

**证据**

- 本次调用者给出的固定提交范围 tip 是 `2cf0d377`，且范围说明中包含“最后必填回调与两条边界补测后再跑完整网页……”之后的提交。
- 本快照无 git 历史可比对，无法确认 `1a78d1a5` 是否就是所有代码修复所在的提交、后续提交是否只含测试/文档。若 `1a78d1a5` 早于必填回调等行为改动，则该句会让审计追溯误以为验收版本等于最终版本。

**影响**

仅影响审计可追溯性，不影响运行时代码。

**修复方向**

- 将“验收版本”指向最终包含行为改动与完整验证的提交，或明确写成“代码修复起始提交 `1a78d1a5`，最终验收 tip `2cf0d377`”，并保留对应测试日志引用。

---

## 3. 已核查、未发现可证实问题的部分

### 3.1 F3 版本事实

- `eagle-asset-facts.ts:6-21`：`mediaRevision` 不同则按大小，同版本按独立媒体时间，同一时间再用 READY/FAILED/PROCESSING 排序与派生集增量兜底，可避免同毫秒 READY 被迟到 PROCESSING 覆盖。
- `eagle-asset-facts.ts:40-73`：元数据按 `rowVersion` + 独立时间水位选择，媒体事实单独选择，最终 `updatedAt` 取两者最大值；列表、处理轮询、详情写回共用同一规则。
- `eagle-asset-entity-store.ts:37-94`：`upsertMany` 与 `mergeProcessingUpdates` 分别维护 `#metadataUpdatedAt` / `#mediaUpdatedAt`；旧列表、旧处理行、新元数据/旧媒体、新媒体/旧元数据、同版本处理等组合与新增测试一致。
- `useEagleMutations.ts:104-149`：评分/元数据写回走详情前缀并调用 `mergeEagleAssetFacts`，不会建立无人读取的短键，也不会用旧媒体覆盖较新媒体（有测试覆盖）。
- 条件：上述结论依赖服务端同一资源 `updatedAt` 随写入单调递增；代码本身没有、也无法独立证明该前提，但当前测试数据与 API 序列化方式符合该前提。未发现可复现的回退路径。

### 3.2 D2 模式工厂与跨模式请求

- `library-workspace.tsx:10-19`：六工厂统一按 `mode` 组合，`useMemo` 仅在 `ownerId/libraryMode` 变化时重建；`useLibraryWorkspace` 缺失上下文立即抛错。
- 六个工厂的返回键集与各自模块级导出完全一致（逐一比对 `eagle-api`、`eagle-vector-api`、`eagle-processing-admin-api`、`eagle-privacy-api`、`privacy-visibility-api`、`eagle-task-center-api`），无遗漏方法，也没有跨模块同名方法互相覆盖。
- 所有工厂请求都经 `libraryApiPath(..., libraryMode)`；`eagle-vector-api` 的 rendition URL 在 MATERIAL 下仍使用默认 MATERIAL 实现，PHOTO 下使用 PHOTO 工厂。
- `library-workspace.test.tsx` 覆盖了“缺失 Provider 抛错”和“两模式键集相同”，`library-sharing-contract.test.ts` 覆盖了每个操作的 mode 路径一致性；未发现工厂遗漏或跨模式请求。

### 3.3 F4 并发池与部分成功

- `async-pool.ts:12-50`：首错后置 `failed`，其他 worker 在 `while (!failed ...)` 处不再领取；`Promise.all` 等待在途项；`committed` 与 `retryItems` 互补，且按输入顺序组装，语义正确。
- `useEagleMutations.ts:188-206`：`updateTagsMutation`/`deleteTagsMutation` 改为 `onSettled` 刷新，失败也会刷新已提交结果；`tagBatchFailure` 只暴露未完成项，重试时优先读 `manualTags` 最新缓存。
- `EagleTagPage.tsx:544-562`：完成数、未完成名称和重试按钮与 `tagBatchFailure` 对应，`busy` 期间禁用；新增的单测与池单测相互印证。
- `LibraryUploadQueue` 的 worker 在内部 `try/catch`，不会向并发池抛错，因此“首错停止领取”不会误伤上传批次。

### 3.4 F6 详情键

- `eagle-query-keys.ts:11-13`：`assetDetailPrefix` 与 `assetDetail(assetId, view)` 明确区分；`SekerEaglePage.tsx:786` 是唯一消费者且显式传 `libraryView`；`useEagleMutations.ts:107-110/145-148` 使用前缀写回，`eagle-write-refresh.ts:17` 用父键统一失效；未发现遗留的一参 `assetDetail` 调用。

### 3.5 D3 下载回执

- `original-file-export.ts:38-43`：浏览器回退返回 `{ saved: false, initiated: true }`，原生桥路径原样返回；两模式测试均断言 `initiated`。现有调用方只利用 resolve/reject，没有把 `saved` 当成必需字段，未发现行为回归。

---

## 4. 验证限制

- 未运行 lint/typecheck/unit/build，也未运行 `architecture:check`、`contracts:check`；以上均为静态阅读与测试内容比对。
- 未在真实浏览器或打包 Electron 中点击验证，不评价长期 heap、FCP/LCP、吞吐或生产端到端延迟。
- 未访问生产数据库、对象存储、SekerChat；未修改任何文件或提交。
- 2.1 的关键结论取决于 `@tanstack/query-core@5.104.5` 的 `resetQueries` 是否中止在途请求，需在可运行环境或源码中确认；确认前不应把该竞态当作已解决，也不应把当前测试当作覆盖了它。

**一句话总结**：这轮改动的主路径（F3 合并、F4 池/重试、F6 键、D2 工厂、D3 回执）看起来自洽，没有找到明确的回归；真正要补的是两件事——确认并测试隐私撤销时 `resetQueries` 是否真会中止在途列表请求并清掉重新写回的实体（2.1），以及把 F5 的隐私分支和 SekerEaglePage 的真实关系刷新接线补上测试（2.2–2.4）。
