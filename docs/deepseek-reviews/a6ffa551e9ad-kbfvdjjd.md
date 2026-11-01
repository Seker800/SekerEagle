# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`9e6bf367af898dab863ae1c975614872f208af34..a6ffa551e9ada50792709e301f50cf244a90838f`
- 完成时间（UTC）：2026-10-31T14:54:26.642566+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/a6ffa551e9ad-kbfvdjjd`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 只读代码审查报告

## 审查范围与限制

- 审查对象：固定提交范围 `9e6bf367..a6ffa551` 的独立快照，重点为 diff 中的查重版本化/刷新、人物九宫格与多选合并、待整理分页、候选查询与覆盖索引、对应测试和文档。
- 只做了静态阅读；未运行 CI、数据库、浏览器或镜像，未读取原工作区，也未核验生产数据。调用者所述“CI 已通过、镜像/readiness/对象存储验证通过”未独立验证。
- React Query 行为按 v5 语义判断，并用仓库内 `asset-operation-refresh.ts` 的 `refreshFirstPages`/`refreshMetadata` 规避整页重放的既有写法交叉印证；如需 100% 确认仍应在目标版本上跑一次多页刷新实验。
- 未审查 worker/operations 镜像的实际发布顺序与生产浏览器验收（文档已注明未完成）。

---

## 问题 1（高）：多页已加载时，“刷新结果”和扫描完成后的自动刷新会 409 且重试无法恢复

**文件与行号**

- `apps/web/src/components/eagle/EagleDuplicates.tsx:100-109`（无限查询，页码参数带 revision）
- `apps/web/src/components/eagle/EagleDuplicates.tsx:279-284`（新增“刷新结果”按钮调用的 `results.refetch()`）
- `apps/web/src/components/eagle/EagleDuplicates.tsx:144-152`、`176`（扫描终态/无新任务时触发整查询失效与 refetch）
- `apps/web/src/components/eagle/asset-operation-refresh.ts:117-120`（扫描终态同样 invalidate 整个 duplicates 查询）
- `apps/api/src/eagle/eagle-duplicates.service.ts:60-61`（续页携带旧 revision 时抛 409）

**触发条件**

1. 用户已加载查重结果第 1 页，并点过“加载更多组”使 `pages.length >= 2`；或浏览器缓存中已有多页；
2. 期间 revision 发生变化。revision 包含分组签名（含成员 `rowVersion`/`mediaRevision`），因此**扫描重建、甚至素材改名（rowVersion 变化）**都会让它变化；
3. 用户点击新增的“刷新结果”，或扫描完成后自动 invalidate/refetch，或“检查新内容”返回 `operationId:null` 后触发 `results.refetch()`。

**证据与机制**

- `getNextPageParam` 把 `{ cursor, revision: last.revision }` 存进第 2 页起的 `pageParams`（`EagleDuplicates.tsx:105-106`）。
- React Query v5 的 `refetch`/`invalidateQueries` 对已加载的 infinite query 会按已存在的 `pageParams` 逐页重放；第 1 页因 `pageParam` 为 `undefined` 不带 revision，会成功并返回新 revision，但第 2 页仍带旧 revision。
- 服务端只要请求带 revision 且与当前 revision 不同就直接 409（`eagle-duplicates.service.ts:60-61`），因此第 2 页失败，整个查询进入错误态；`results.error` 的“重试”按钮再次调用同一个 `refresh()`，`pageParams` 仍未改变，形成稳定失败循环。该列表页无法通过按钮恢复，只能靠浏览器整页刷新、改用未缓存的筛选，或等缓存被回收。
- 仓库内 `asset-operation-refresh.ts:172-235` 专门用 `refreshFirstPages` 只抓首屏再局部合并，正是为了绕开这种整页重放和游标失效，说明该模式在本仓库是被明确规避的。

**实际影响**

- 用户原始诉求“照片查重不可用、没办法刷新”在常见的多页场景下仍然成立：新加的刷新按钮在结果真正变化（最需要刷新时）反而报“图库已变化，请刷新查重结果。”且原地重试无法恢复；扫描完成后的自动更新也会把界面打成错误态。
- 不涉及数据删除错误（清理仍会被 revision 守卫挡住），属功能与需求未达成，拖住发布验收。

**修复方向**

- 刷新/自动失效时**重置**该 infinite query（`resetQueries` 丢弃 pages/pageParams，从第 1 页重新开始），或在客户端只 fetch 第 1 页并用 `setQueryData` 把 `pages` 重置为单页；不要对多页结果直接 `refetch()`。
- 或者不把 revision 绑进续页游标（服务端对每组的成员/版本已有逐项校验，清理入口会再做 revision 校验），续页只用 cursor。
- 无论选哪种，都应补一个“已加载 2 页 → revision 变化 → 刷新/扫描终态失效”的前端回归；现有新增测试只覆盖单页（`EagleDuplicates.test.tsx:492-520`）。

---

## 问题 2（低-中，条件性，需数据核验）：同框候选数组把 NULL 带入 `ANY`，可能让该锚点的全部候选被静默过滤

**文件与行号**

- `apps/api/src/photos/photo-person-review.ts:84-95`
- 对照：`apps/api/prisma/schema.prisma:1413`（`EaglePhotoFace.personId` 可空）

**触发条件**

`visible_faces` 中某张共享照片上存在 `personId IS NULL` 的当前人脸（当前 worker `apps/worker/src/photo-faces.ts` 总是写入 personId，因此需要检查历史/异常数据是否实际存在）。

**证据与机制**

- 原实现是逐行 `NOT EXISTS(... c.candidate = e.id)`，NULL 候选行只会让该行不匹配，不影响其他候选。
- 新实现 `array_agg(DISTINCT f2."personId")` 会把 NULL 收进数组；PostgreSQL 中 `e.id = ANY(ARRAY[..., NULL])` 在 e.id 不在数组内时返回 `NULL`，随后 `NOT(NULL)` 在 WHERE 中不成立，所有候选行被过滤。

**实际影响**

- 对受影响的锚点，相似人物候选会全部消失且没有任何报错；审核界面表现为“没有候选”。由于当前写入路径恒有 personId，实际影响取决于是否存在历史/手工异常行，故标记为待数据核验。

**修复方向**

`array_agg(DISTINCT f2."personId") FILTER (WHERE f2."personId" IS NOT NULL)`（或在 join 条件加 `f2."personId" IS NOT NULL`），并补一个含 NULL personId 人脸的回归用例。

---

## 问题 3（低）：自动重建失败/被取消后，界面长期声称“正在更新”且没有原地重试

**文件与行号**

- `apps/web/src/components/eagle/EagleDuplicates.tsx:179-191`（每个挂载周期只尝试一次 `attemptedUpgrade`）
- `apps/web/src/components/eagle/EagleDuplicates.tsx:391-393`（只要 `outdatedGroups > 0` 就固定显示“旧版近似结果已停用，正在按同格式、同尺寸规则更新。”）

**触发条件**

自动入队的重建扫描失败、被用户取消、执行器暂停/未运行，或 API/worker 版本不一致导致扫描完成但仍写入 `legacy` 分组。

**证据与影响**

- 状态文案与实际扫描状态无关联：没有运行中的扫描时仍显示“正在更新”；`attemptedUpgrade` 阻止同一挂载内再次自动尝试，界面上也没有针对重建失败的显式错误/重试入口（只有“检查新内容”手动按钮）。用户会误以为后台正在处理，旧结果也持续不可见。
- 与本次文档宣称的“后台完成自动同步/读取失败可原地重试”不完全一致。

**修复方向**

把该提示与扫描操作状态绑定：扫描失败/取消时显示失败与“重新检查”，或在终态非成功后允许再次自动入队一次并给出明确文案。

---

## 次要观察（不构成阻塞）

1. **旧合并接口的行为收紧**：新的 `mergeSelectedPeople` 对每个被合并人物要求存在 `assetRevision = mediaRevision` 的当前人脸（`apps/api/src/photos/photo-person-merge.ts:22-26`），而旧的 `mergePeople` 走 `visiblePhotoPeople`（无 revision 校验）。目前网页不再调用旧的 `POST people/:id/merge`，但若桌面/旧客户端仍调用，对“当前人脸版本滞后”的人物会由可合并变为 404。建议确认外部调用方；若只是对齐目录语义，应在文档中写明。
2. **`carryPersonSeparations` 成为死代码**：`apps/api/src/photos/photo-person-review.ts:102-120` 只被定义，没有调用方；合并逻辑已复制到 `photo-person-merge.ts`。不影响运行，但后续修改容易两处漂移，建议删除或复用。
3. **新索引与旧索引并存**：`20261031160000_photo_person_review_covering` 的复合/覆盖索引与已有 `EaglePhotoFace_ownerId_libraryMode_personId_idx` 并存；不构成正确性问题，但会增加人脸写入成本，后续可评估是否保留旧索引。

---

## 测试与验证缺口

- **多页刷新/revision 交互没有测试**：新增的“刷新结果”测试（`EagleDuplicates.test.tsx:492-497`）只加载 1 页；缺少“2 页缓存 + revision 变化 + 刷新/扫描终态失效”的用例，这正是问题 1 未被 CI 捕获的原因。
- **NULL personId 的同框回归缺失**：数据库专项测试全部使用非空 personId 人脸，无法覆盖问题 2。
- **时间断言易抖**：`scripts/testing/photo-person-review.test.mjs:361-365` 的 `elapsed < 2500` 是墙钟断言，文档自己也记录了生产样本 8723ms 的首轮长尾；在负载较高的 CI 上属于潜在 flaky。计划形状断言（`cooccurring` loops ≤ 8）更稳定，时间可作为日志而非硬断言，或放宽并注明非生产承诺。
- **新 UNNAMED 分支的单元测试覆盖偏弱**：`photo-people-pagination.test.ts` 的 `$transaction` mock 只走到“无效游标”早退路径，真实 SQL 只由 `photo-person-ranked.test.mjs` 的数据库专项覆盖；可接受，但建议补一条带 tx `$queryRaw` 的游标/排序单测。

---

## 已核对且未发现可证实问题的部分

- 新 `POST people/merge-selected` 的认证/来源守卫、ownerId 由 principal 推导、跨 owner 404、DTO 不接受 ownerId；合并前先做可见性与版本校验，写入在同一事务内完成，失败整体回滚。
- 多源合并的否定事实继承（排序键、去重、与 target 自身相遇跳过、源删除级联）与旧单源逻辑一致；隐私规则取 OR 并在需要时执行 `syncAssetPrivacy`，未发现越权或私密标记丢失路径。
- 待整理目录按可见照片数去重计数、稳定 `(photos,id)` 游标分页、私密过滤与 summary 语义一致；返回顺序按分页顺序保持。
- 查重读取按 `algorithmVersion` 过滤旧投影、`outdatedGroups` 计数范围、清理/忽略均无法读取旧组；旧组保留但不再展示，符合文档描述。
- 分组/精确重复的规范格式（jpg/jpeg、tif/tiff、heif/heic）在 SQL 与 `library-core` 中一致；编辑副本与跨格式从近似分组排除。
- 扫描终态跳过成员回执、仅失效查重投影的实现与“不重放六万项回执”的目标一致；扫描失败的提示仍可由 operation summary 展示。
- 覆盖索引三张与 review/candidate 查询的谓词基本匹配；`jit` 仅对候选事务关闭，未改全局设置。

---

**一句话总结**：人物九宫格多选合并、待整理按数量分页、查重版本化与旧投影停读这些主干实现基本站得住；但新加的“刷新结果”和扫描完成自动刷新在多页缓存场景下会被旧 revision 打死并原地重试无效，这正好对应“查重没法刷新”的原始诉求，建议在推送前修掉并补多页回归。
