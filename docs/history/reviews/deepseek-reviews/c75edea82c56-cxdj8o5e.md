# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`1ed8a2dc02950e1519a927f5f1900758b42eb0c1..c75edea82c56f0635d1a5aae022a6f491cb3d138`
- 完成时间（UTC）：2026-10-31T15:42:36.782890+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/c75edea82c56-cxdj8o5e`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 只读审查报告：人物照片数优先 + 待整理多选合并

## 审查范围与方法

在推送快照（`1ed8a2dc..c75edea8`）内只读阅读了改动文件及其上下文，重点核对：

- 服务端候选/证据排序、游标版本：`photo-person-review.ts`、`photo-person-review-evidence.ts`、`photo-person-review.service.ts`
- 人物目录轻投影：`photo-management.service.ts`
- Web 目录多选、合并目标、缓存投影：`PhotoCollections.tsx`、`PhotoPersonMergeSelection.tsx`、`photo-person-merge-cache.ts`、`PhotoPeopleReview.tsx`、`use-photo-people.ts`、`photo-management-api.ts`
- 相关测试与文档：`PhotoCollections.review.test.tsx`、`PhotoPersonMergeSelection.test.tsx`、`photo-person-merge-cache.test.ts`、`photo-person-ranked.test.mjs`、`docs/people-count-first-2026-10-31.md` 等

未执行任何命令、测试或数据库验证；本文只基于快照静态阅读。测试覆盖率、实库首屏、隔离 DB、镜像启动及生产验收声明无法在本环境复核。

## 发现的问题

### 1. 中：冲突后只刷新目录，未刷新“合并目标”轻 options，清除重选后仍可能用旧版本目标再次 404/409

**位置**
- `apps/web/src/components/photos/PhotoPersonMergeSelection.tsx:44-52`（`people-merge-targets` 查询，`staleTime: 30000`）
- `apps/web/src/components/photos/PhotoPersonMergeSelection.tsx:78-81`（404/409 时只 `setConflicted` + `onConflict()`）
- `apps/web/src/components/photos/PhotoCollections.tsx:218-222`（`onConflict` 只失效 `['eagle', ownerId, 'PHOTO', 'people']`）
- 对照成功路径：`apps/web/src/components/photos/photo-person-merge-cache.ts:49-52` 才会失效 `people-merge-targets`

**触发条件**
用户选中若干待整理分组，从“合并到人物”下拉中选了一个**已命名目标**（或目标在别处被改名/合并/删除），合并返回 409 或 404。按提示点“清除选择”后重新选择分组和目标（30 秒 `staleTime` 内）。

**证据**
`people-merge-targets` 的 query key 是 `['eagle', ownerId, 'PHOTO', 'people-merge-targets', includePrivate, scopeRevision]`，而 `onConflict` 失效的前缀是 `['eagle', ownerId, 'PHOTO', 'people']`；React Query 的前缀匹配按数组元素逐项相等，`'people-merge-targets' !== 'people'`，因此不会命中。清除选择只会让组件以同一 queryKey 重新挂载，数据仍在 30 秒新鲜期内，`enabled` 从 false 变 true 不会重新请求，目标列表里的 `rowVersion` 和已删除条目仍是旧的。

**实际影响**
对“目标版本变化/目标被删除”这一类冲突，“冲突必须重选”的流程无法真正恢复到可合并状态：清除并重选后仍可能用旧 `rowVersion` 提交，再次 409/404，形成重复冲突循环，直到 30 秒新鲜期过去或窗口重新聚焦触发刷新。现有测试 `PhotoPersonMergeSelection.test.tsx:112-123` 只断言冲突提示、`onConflict` 调用和按钮禁用，没有验证“清除后重选可成功”，因此掩盖了该问题。

**修复方向**
在 `onConflict` 中同时失效 `people-merge-targets`（或组件内直接 `targets.refetch()` 并在冲突时清空 `targetId`）；也可对该查询使用更短 `staleTime`/显式版本键。补充一个用例：第一次 409 后目标列表刷新、清除重选后用新版本成功提交一次。

### 2. 中低：移除 `people` 失效后，“不是同一个人”导致的版本递增没有投影回目录/目标缓存

**位置**
- `apps/web/src/components/photos/PhotoCollections.tsx:113-119`（`afterReviewChange` 不再失效 `people`）
- `apps/web/src/components/photos/PhotoPeopleReview.tsx:208-222`（DIFFERENT 分支只 `updatePeople` 写 review 的 edits）
- 服务端版本递增：`apps/api/src/photos/photo-person-review.service.ts:189-196`
- 目录缓存携带 `rowVersion`：`apps/api/src/photos/photo-management.service.ts:210`、`:238`

**触发条件**
在“待确认”中把两个人物标记为“不是同一个人”（首次建立否定关系，服务端会为双方 `rowVersion + 1`）；随后到“待整理分组”把其中任一分组与已命名目标合并，或在私密人物设置中解除该人物私密。

**证据**
否定确认返回了双方新版本，`PhotoPeopleReview` 只写入 `[...queryKey, 'edits']`（review 缓存），没有更新 `people`/`people-merge-targets` 缓存；而本次改动删除了 `afterReviewChange` 里原本唯一的目录失效。于是目录卡片、合并目标 options、隐私设置列表仍持有旧 `rowVersion`。目录合并会因此 409 并需清除重选；`PhotoPrivatePeopleSettings.tsx:19-35` 在隐私写入失败时不会主动 `refetch`，用户可能只看到“人物已变化”而没有恢复入口。

**实际影响**
本来可以顺畅完成的后续合并/隐私操作被强制多走一次冲突重选，且部分页面没有刷新入口。这与 `docs/architecture.md` 中“连续操作更新已知人物和版本”的既有约定不一致；本次要求的“成功局部投影”只覆盖了合并回执，没有覆盖否定回执。

**修复方向**
否定成功后把返回的 `people` 版本投影到 `people` 与 `people-merge-targets` 缓存（或对这两个 key 定向失效），而不是重新拉整页目录；同时让隐私设置写入失败路径具备可恢复的刷新动作。补充“DIFFERENT 后目录/目标版本已更新”的测试。

### 3. 低（需产品确认）：证据“同照片数按相似度”实际使用含 confidence 的综合 rank

**位置**
- `apps/api/src/photos/photo-person-review-evidence.ts:75`（`rank = 0.8*similarity + 0.1*confidence + 0.1*volume`）
- `apps/api/src/photos/photo-person-review-evidence.ts:78-85`（先 `firstCount`、`secondCount`，再 `rank`）

**触发条件**
双方照片数（`firstCount`、`secondCount`）相同，但置信度不同、相似度也不同。例如相似度 0.80/置信度 1.0 的一对会排在相似度 0.85/置信度 0 的一对之前。

**实际影响**
如果“相似度同数次序”要求严格按相似度，那么同数时 confidence 仍可改变顺序，属于规格偏差；若沿用此前“匹配质量”包含 confidence 的口径，则当前实现可接受。现有 `photo-person-review-evidence.test.ts:82-97` 的两个 pair 的 `firstCount` 分别是 1 和 100，实际只覆盖了数量优先，没有覆盖“同数时的相似度次序”，因此无法从测试判断该口径。

**修复方向**
确认口径后，要么在同数时显式比较 `similarity`（confidence 作为更后级 tie-break），要么在文档/测试中明确“匹配质量”含 confidence；补一个同数不同相似度的断言。

### 4. 低（当前被掩盖）：缓存投影把筛选器的 `people/options` 缓存也当成目录，隐私隐藏取错 key 下标

**位置**
- `apps/web/src/components/photos/photo-person-merge-cache.ts:16`（谓词同时匹配 `people` 和 `people-merge-targets`）
- `apps/web/src/components/photos/photo-person-merge-cache.ts:18`（`query.queryKey[4] === false` 判断公共范围）
- `apps/web/src/components/photos/usePhotoFilterOptions.ts:14`（筛选器 key 为 `['eagle', ownerId, 'PHOTO', 'people', 'options', includePrivate]`）

**触发条件**
合并进入一个“合并后变为私密”的目标，且 `usePhotoFilterOptions` 的 `people/options` 缓存存在。该缓存的 key 第 4 位是字符串 `'options'`，不是 `includePrivate` 布尔值，所以 `hiddenTarget` 永远为 false，新私密目标不会被这条投影隐藏。

**实际影响**
目前 `PhotoCollections` 的隐私合并成功路径会通过 `perform` 失效 `['eagle', ownerId, 'PHOTO', 'people']` 前缀，筛选器查询会被重取，掩盖了这个问题；但如果该刷新被跳过、失败，或未来复用 `applyPhotoPersonMerge` 时沿用同一谓词，公开筛选器可能继续展示刚变为私密的人物选项。属于潜在隐私投影不一致，不是当前主路径的确定泄漏。

**修复方向**
谓词中只对 `people` 卡片缓存使用 `queryKey[4]` 布尔判断，对 `people/options` 使用 `queryKey[5]`（或显式排除筛选器 key），避免依赖“后续失效会兜底”。

### 5. 测试缺口

- 没有覆盖“404/409 后合并目标 options 刷新、清除重选后成功”的路径（对应问题 1）。
- 没有覆盖 `directoryScope`（owner/privacy/scopeRevision）变化时清空目录选择（`PhotoCollections.tsx:64-67` 的行为），而需求明确要求“范围变化清空”。
- 没有验证 review 合并成功后**目录页不被重放**（现有测试 `PhotoCollections.review.test.tsx:150` 只断言 `mocks.suggest` 次数，没有断言 `mocks.list`）。
- `photo-person-review.test.ts:12-14` 只断言 SQL 含 `OFFSET`，没有断言候选 `ORDER BY e.photos DESC, ...`；`photo-person-review-evidence.test.ts` 也没有“同照片数、不同相似度”的排序用例，因此“相似度同数次序”缺少直接回归保护。
- `photo-person-ranked.test.mjs` 的 152 对完整遍历仍使用全员 1 张照片；新的候选排序在“照片数不同”的场景下没有完整性遍历断言（仅有首屏断言）。

## 检查过且未发现新问题的地方

- 候选锚点与候选邻居均改为照片数优先、相似度次级；最终输出在服务层按双方照片数重排，符合“照片数第一排序”的主路径。
- review 游标版本升至 v3，Web review query key 追加 `'count-first-v3'`，旧游标/旧排序缓存不会被复用。
- `NAMED`/`options` 轻投影新增 `rowVersion`、`marksAssetsPrivate`，未取 faces/EXIF；仍由认证主体推导 ownerId、跨 owner 404、隐私过滤保留。
- “待整理分组”复用了原 `merge-selected` 原子事务，没有新增端点、迁移、后台队列或用户操作数量上限；目标列表按既有分页加载，未下载人脸/EXIF。
- 成功路径对目录、目标 options、review edits 做局部投影，未重放已加载页；错误保留选择、冲突禁用提交。
- 混合私密合并的 `privacy` 计算新公式比旧公式更符合服务端 `syncAssetPrivacy` 的触发条件，公共缓存隐藏新私密目标的逻辑在目录与 review 中成立。
- i18n 中英文 key 已同步，新增文案均走 `t()`；样式与钩子顺序未发现会阻断渲染的问题。

## 限制

- 未运行 lint/typecheck/unit/build/DB/镜像验证，因此无法独立确认“23 项测试”“新增模块覆盖率”“实库 2066/1529 张”“隔离 DB 预算”“最终镜像启动”等声明。
- 快照只包含改动范围；人物排序历史行为、生产数据与浏览器验收不在可复核范围内。文档中“待验收/待发布后补记”的表述与上下文一致，未发现冒称上线的文案。
- 问题 3 属于口径判断，已标注需产品确认；问题 4 的实际可见影响需要结合隐私合并刷新是否成功才能确定，已按“潜在”处理。

**大白话总结：** 主功能（照片多优先、目录多选合并、一次事务、局部缓存更新）方向是对的，但冲突重选链路里“命名目标的列表不刷新”会让用户反复撞 409/404，另外“不是同一个人”之后目录里的版本号没有跟着更新，也可能制造不必要的冲突；这两处建议在推送前至少补上目标刷新和版本投影，测试缺口也要补上。
