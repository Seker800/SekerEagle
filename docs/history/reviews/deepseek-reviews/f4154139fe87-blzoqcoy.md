# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`f536cef612d2d8138add6e4ef3f28f5ccff28d8f..f4154139fe876e68f44284ff9ed032b3e5752cae`
- 完成时间（UTC）：2026-10-31T08:22:55.691979+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/f4154139fe87-blzoqcoy`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 独立审查报告（只读，建议性质）

审查范围：快照 `f536cef..f415413` 中列出的 9 个改动文件；为核对上下文，另读取了 `eagle-query-keys.ts`、`eagle-asset-viewport.ts`、`usePhotoFilterOptions.ts`、`App.tsx`、`useEagleProcessingUpdates.ts`、`packages/library-core/src/asset-operations.ts`、`package-lock.json` 及被架构文档链接的旧成本记录。未运行测试、未做浏览器验证、未读取原工作区。

总体判断：自动重取、活动/非活动区分、owner/mode 谓词隔离、保留旧页这些方向是对的；但“最后一次完成不能丢”还有结构性缺口，另外有一处首次终态漏刷新和两处文档/成本口径问题。

---

## 1. [高] 并发在途读会让最后一次发布被跳过或取消，且不会再补读

**位置**
- `apps/web/src/components/eagle/asset-operation-refresh.ts:20-38`（`invalidateQueries(..., {cancelRefetch:false})` 和仅在 `pending` 有值时重跑）
- `apps/web/src/components/eagle/SekerEaglePage.tsx:1074-1098`（`fetchNextPage()` 既未检查 `assetsQuery.isFetching`，也未传 `cancelRefetch:false`）
- `apps/web/src/components/eagle/useAssetOperations.ts:72-108`（终态事件只消费一次，之后轮询不再产生发布）
- 对照：`SekerEaglePage.tsx:910-926` 的上一页加载先检查 `assetsQuery.isFetching` 并显式传 `cancelRefetch:false`
- 文档声明：`docs/performance-budget.md:61`（“在途读取不取消……保证最终事实不漏”）

**触发条件与证据**

按仓库锁定的 `@tanstack/query-core@5.104.5`（`package-lock.json:5135-5151`）语义，这里有两类丢发布路径：

1. **刷新被“吞掉”**：用户正在滚动触发 `fetchNextPage()`，或筛选输入正在执行新 key 的列表读取时，后台进度恰好发布最后一批。`AssetOperationRefresher.refresh` 调用 `invalidateQueries(..., {refetchType:'active'}, {cancelRefetch:false})`。对于已经处于 fetching 的查询，`query.fetch` 会直接返回在途 Promise，**不会发起新的全量读取**；`invalidateQueries` 仍然会解析。刷新器随后 `pending` 为空，不重跑。该次发布落在已加载页上，旧卡片（含已删除项）继续显示。
2. **刷新被取消**：刷新器的整表重读在途时，底部分页哨兵触发 `assetsQuery.fetchNextPage()`。该调用没有传 `cancelRefetch:false`，按 v5 默认会取消在途查询；被取消的整表重读不会自动重排，而 `fetchNextPage` 是基于**旧 pages** 追加下一页，已删除项仍留在旧页。

证据链：`useAssetOperations.ts:90-96` 只在数据变化时检测 `final`；操作进入 STOPPED 后，`useAssetOperationList` 的轮询间隔变为 60s，后续快照不再有 `completed` 增长，因此不会再调度。`useAssetOperations.ts:83-89` 的 `finished` 只在观察到过发布增长时成立。原来的人工“加载更新”入口已删除（`SekerEaglePage.tsx:2152` 区域），所以被吞掉的最后发布没有本地恢复入口；只能等窗口聚焦/重新挂载等外部触发。

**实际影响**

正是本轮要修的症状：后台删除完成后，已删除卡片仍留在已加载页，列表不自动反映服务端结果；如果列表读取被取消，可能还伴随一次无意义的重读。触发窗口虽与用户滚动/输入重叠，但在 6 万项、多页列表、每 10 秒重读一轮的场景下并非罕见。当前两个新增测试都覆盖不到：coordinator 测试用 mock 的 `invalidateQueries`，页面测试只有单页且没有并发翻页/筛选读取。

**修复方向**

- 把“本轮发布版本”绑定到列表读取：先标记失效，等待该 mode 的相关查询 `fetchStatus==='idle'` 后再强制补一轮；或者在 `invalidateQueries` 解析后检查列表是否仍 `isInvalidated`/版本未被覆盖，必要时再读一次。
- `fetchNextPage` 与 `loadPreviousPage` 对齐：至少在 `assetsQuery.isFetching` 时不要发起，或显式 `cancelRefetch:false` 并让刷新器在读取结束后补一轮，避免两套在途语义互相取消。
- 增加真实 InfiniteQueryObserver 回归：刷新在途时触发翻页、翻页在途时触发发布，断言最终数据是服务端新结果，而不只是断言 `invalidateQueries` 调用次数。
- `docs/performance-budget.md:61` 的“在途读取不取消……保证最终事实不漏”与实现不一致；要么按上面实现，要么改掉这句话。

---

## 2. [中] 首次观察到的终态操作不会触发刷新（重挂载/切模式）

**位置**
- `apps/web/src/components/eagle/useAssetOperations.ts:64`（每次建 refresher 都把 `previous` 重置为 `undefined`）
- `useAssetOperations.ts:76-89`（`before` 不存在直接 `return`；`published` 和 `finished` 都依赖 `old`）
- `apps/web/src/components/eagle/SekerEaglePage.tsx:264-265,602`（资产列表 `staleTime` 5 分钟）
- `apps/web/src/App.tsx:310-311`（owner/mode 变化通过 Provider key 重挂整个页面）

**触发条件与证据**

页面重挂载（典型是切换素材/照片模式）时，`useAssetOperationProgress` 的 `previous` 被重置，首个操作快照只用于建立基线。如果后台批量操作在**上一次挂载之后、当前页面首次操作轮询之前**已经完成，那么首个快照就是 `STOPPED + completed>0`：`before` 不存在，`published` 为 false，`finished` 也因 `publishedOperations` 从未记录该 id 而为 false，于是整个终态被跳过，不会调度任何刷新。该模式不在当前页时列表只能被“标记失效”；但如果没有更早的发布被观察到，失效标记也不存在。切回该模式时列表仍在 5 分钟 staleTime 内，`refetchOnMount` 不会重取，已删除卡片继续显示，且人工刷新入口已移除。

需要说明的缓解条件：如果卸载前该 mode 曾观察到任意一次发布，列表已经处于 invalidated，返回时会重取。所以漏洞窗口是“卸载前没观察到发布、操作在卸载后完成、5 分钟内返回”。窗口较窄，但属于生命周期/最后一次发布的逻辑缺口，建议以运行时用例确认。

**实际影响**

切模式再切回、或页面短暂卸载后重进，可能看到已删除项仍在列表中，且没有任何手动刷新提示；不涉及权限泄漏（谓词限定 owner/mode）。

**修复方向**

- 首次快照时对 `completed`（或 `completed+skipped`）大于 0 的终态操作至少补一次失效/刷新，并用现有 10 秒节流限制成本；或把“已观察到的 completed 计数”放进按 owner/mode 的工作区缓存，跨重挂载保留基线。
- 若不想刷新历史完成记录，可比较列表查询的 `dataUpdatedAt` 与操作完成时间，但当前 `AssetOperationSummary` 没有时间字段，需评估是否新增。
- 补一个“首次快照即 STOPPED 且 completed>0 会触发一次刷新”的回归。

---

## 3. [低] 失效 predicate 过宽：把多页“关系查询”和刚删除资源的详情也重取

**位置**
- `apps/web/src/components/eagle/asset-operation-refresh.ts:26-32`（只排除了 `operations`，其余同 owner/mode 的查询全部 `refetchType:'active'`）
- `apps/web/src/components/photos/usePhotoFilterOptions.ts:13-20`（人物选项是 infinite query，一页 24 人，可加载多页）
- `apps/web/src/components/eagle/SekerEaglePage.tsx:808-815,2558-2565`（选中资源详情查询，删除后重取会 404 并显示加载失败）
- 成本口径：`docs/performance-budget.md:61`（“另有当前活跃计数／关系查询各一次”）

**触发条件与证据**

筛选面板打开时，人物选项查询的 key 是 `['eagle', owner, 'PHOTO', 'people', 'options', private]`，满足谓词（`key[3] !== 'operations'`），因此每轮自动刷新会按已加载页数重取，而不是“一次”。同样会重取 `photography-facets`、`manual-tags`、智能文件夹、`vector-summary`、`pyramid` 等。若 inspector 正打开一个刚被删除的资源，其 `asset-detail` 活动查询会立即 404，在列表刷新完成前显示 inspector 的“加载失败”提示。

**实际影响**

不影响删除结果的正确性，但每轮请求数可能明显超过文档承诺的“P 页列表 GET + 少量关系查询”，给 NAS 增加可避免的请求；删除后详情 404 是可见的瞬时错误。实际请求数需要真实页面计数确认。

**修复方向**

- 缩小刷新目标：列表、计数和真正受删除影响的查询即时重取；人物选项等分页关系查询只标记失效（`refetchType:'none'`），打开时再更新；对确认已删除资源的详情查询跳过或静默处理 404。
- 如果保留现在的宽谓词，应把人物选项分页数等一并计入 `docs/performance-budget.md` 的成本口径。

---

## 4. [低] 旧成本记录仍写“用户主动加载更新”，并遗留已删除 UI 的文案键

**位置**
- `docs/asset-operation-efficiency-2026-10-31.md:14`（“原工作区提示……用户按‘加载更新’主动刷新”）
- `docs/asset-operation-efficiency-2026-10-31.md:32`（成本表“用户主动加载更新……仅用户主动触发”）
- `docs/architecture.md:21`（新 North star 明确把该文档链接为“成本与验收记录”）
- 遗留文案：`apps/web/src/i18n/messages/zh-CN.ts:90-91`、`apps/web/src/i18n/messages/en-US.ts:92-94`

**触发条件与证据**

本轮需求明确要求“更新架构与成本取舍”，`architecture.md`、`performance-budget.md` 已更新，但被架构文档直接引用的同日期成本记录仍描述已被否定的手动刷新流程，且成本表仍写“仅用户主动触发”。i18n 中“后台内容已更新……”与“加载更新”已无生产引用（仅测试还按名字断言按钮不存在）。

**实际影响**

后续维护者/审查者读架构链接会得到相反结论，可能回退到手动刷新；遗留翻译键本身无功能影响。

**修复方向**

- 更新该记录第 14、32 行，替换成“发布后自动重取当前活跃查询、保留旧页、P 页成本、未打开查询只失效”的新口径，并删除对“加载更新”入口的描述。
- 清理两个已无引用的 i18n 键；如保留，注明历史用途。

---

## 已核对、未发现新问题的部分

- 谓词对 owner/mode 的隔离正确，`operations` 轮询查询被排除，未发现跨 owner 失效；`AssetOperationsPanel.test.tsx:117-149` 覆盖了这两点。
- 活动查询重取全部已加载页、保留旧数据、非活动查询只失效、其他 owner 不受影响：`asset-operation-refresh.test.ts:5-59` 用真实 `InfiniteQueryObserver` 覆盖，并验证了 12 页对应 12 次读取。
- 刷新的同 mode 串行与同轮合并逻辑本身自洽：`refreshing`+`pending` 的组合能保证刷新器自己发起的读取不重入，终态事件在途时会在之后补一轮（`asset-operation-refresh.test.ts:61-85`）。
- 10 秒中间节流 + 终态绕过节流符合“中间合并、整批立即刷新”（`useAssetOperations.ts:99-106`，`AssetOperationsPanel.test.tsx:151-192`）。
- 删除“后台内容已更新/加载更新”UI 和 `backgroundRevision` 等缓存通知状态后，未发现其他引用残留（仅 i18n 键和测试字符串）。
- 本次没有 API、数据库、存储或 worker 改动；未发现认证、owner、私密边界被放宽。

## 检查范围与限制

- 仅静态读取快照，未运行测试/lint/typecheck/build，也未复现 RED/GREEN；调用者声明的 955 项、153 项等结果未独立核实。
- TanStack Query 的具体在途语义按 `package-lock.json` 锁定的 `5.104.5` 与公开 API 语义分析，建议用真实 `InfiniteQueryObserver` 回归确认；第 1 条的两条路径中，“在途读取被跳过”不依赖默认值，“`fetchNextPage` 取消在途刷新”依赖 v5 默认 `cancelRefetch:true`。
- 生产浏览器验证尚未进行，本报告不把它当作已完成证据。

**大白话总结**：方向对，自动刷新基本能工作；但“最后一次发布绝不丢”还没做到——用户正在翻页或搜索时，后台刷新可能被跳过或取消，删除的卡片会留在列表里且没有手动入口兜底。建议先补这两个在途冲突的回归测试，再决定是否重构刷新器。
