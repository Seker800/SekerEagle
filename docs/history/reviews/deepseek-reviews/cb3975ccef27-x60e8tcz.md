# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`a032dac74eb8aa6cff219275e2e45f19aeded07b..cb3975ccef27235c3c4cfd6ed0de6c30f9d07e7a`
- 完成时间（UTC）：2026-10-31T23:37:23.502277+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/cb3975ccef27-x60e8tcz`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 审查报告：人物目录「所有人」（a032dac..cb3975c）

## 结论

未发现阻断发布或高风险的正确性问题。核心需求在代码层面成立：ALL 页签、`named+unnamed` 总数、服务端全局 `named DESC, 可见照片数 DESC, id` 排序、v2 游标、独立缓存标记、旧 UNNAMED/legacy 协议、owner/隐私/当前媒体/版本守卫、合并复用，均能在本次改动与上下文中对上。

下面 3 条为低风险建议 + 1 条文案一致性提示。第 1 条是最值得主代理确认的一条。

## 已核对、未发现问题的部分

1. **排序与游标数学**（`apps/api/src/photos/photo-person-count-page.ts:36-63`）：`ORDER BY named DESC, photos DESC, id` 与 `named<c.named OR (named=c.named AND (photos<c.photos OR (photos=c.photos AND id>c.id)))` 是标准 keyset 谓词，方向一致，不会漏页/重页；`LIMIT 25` 取 24 + 1 探测下一页与原逻辑一致。
2. **可见性语义**：ALL 查询的 `f.isCurrent`、`a.mediaRevision=f.assetRevision`、`deletedAt IS NULL`、`isPrivate`、`marksAssetsPrivate` 与既有 UNNAMED/摘要口径一致；`count(DISTINCT a.id)` 按不同资产计数而非人脸数；`HAVING ... OR (includePrivate AND marksAssetsPrivate)` 与 `summary()`（`photo-person-review.service.ts:18-41`）的可见集合一致，因此页签总数与列表条数同口径。
3. **游标绑定**：`ownerId`、`includePrivate`、`view`、`version`（ALL=2、UNNAMED=1）均校验；ALL 游标强校验 `named` 为 boolean；UNNAMED 旧 v1 游标仍可用，新 UNNAMED 游标多出的 `named:false` 不影响旧校验。`photo-people-pagination.test.ts:197-204` 的跨协议游标拒绝仍覆盖。
4. **旧协议**：`view=full/options/cards` 与 `view=NAMED|UNNAMED` 的行为未被改写；`view=ALL` + `projection=full/options` 仍走原 200 条路径（`photo-management.service.ts:86-90,150-151`），符合"仅显式 ALL/cards 排序、legacy 保持"。
5. **前端**：ALL 独立 queryKey 后缀、去重后按命名优先/照片数/id 重排（`use-photo-people.ts:12-44`）、合并缓存投影按 `queryKey[3]` 前缀匹配，均能命中新键形；`rowVersion` 由卡片投影带回，合并版本守卫未被绕过。
6. **i18n/空状态**：中英 key 完全对称（`messages.test.ts` 的 parity 测试可继续通过），新 key 无重复，旧 key 无残留引用；无 DDL、无新上限、无模型/worker 改动。

## 问题

### P1（低，但主流程较易触发）改名后 ALL 目录按旧游标重取，已加载列表可能静默少一张人物卡

- 位置：`apps/web/src/components/photos/PhotoCollections.tsx:88-103`（改名成功后 `invalidateQueries(['eagle', ownerId, 'PHOTO', 'people'])`，会重取全部已加载页）；`apps/web/src/components/photos/use-photo-people.ts:11-27`；`apps/api/src/photos/photo-person-count-page.ts:43-45`。
- 触发条件：在「所有人」页加载 ≥2 页后，对某个未命名人物在卡片编辑器里保存姓名（这是本页签的主要整理动作）。
- 证据/机制：v2 键把 `named` 作为第一排序键；改名会把该人物从未命名区移到命名区，整段顺序位移 +1。`invalidateQueries` 后 React Query 按各页原有 `pageParam`（旧游标）重取已加载页，而不是从新第一页重算；旧第 24 条游标行会落到第 25 位，第 1 页新前 24 条不再包含它，第 2 页又按"严格在游标之后"从第 26 位开始，于是该行在两页之间被跳过。客户端只做去重/排序，无法补回缺失行。位移方向不同时可能表现为漏卡或边界重复（重复被去重），但都不会自愈。
- 实际影响：用户改名后，已加载网格里会悄悄少一张人物卡（通常是包含新位置的那一页的末尾卡），看起来像人物丢失；需整页刷新或后续重取才恢复。与"稳定分页/进度刷新不得扰动已加载分页"的产品约定不符。
- 修复方向：改名成功后不要整段目录 refetch，而像 `applyPhotoPersonMerge` 那样局部改缓存（改 `name` 后由客户端排序自然移动到命名区，页面不重取）；若仍需重取，应对该 query 重建页参数（首屏重载或快照/epoch 游标），而不是沿用旧 keyset 游标。
- 待验证：本快照未安装依赖，无法直接复核 React Query v5 "invalidate 后按原 `pageParams` 重取全部页"的行为；建议补一条组件测试（mock 两页 + 改名 + 断言两页并集仍完整）确认。游标数学本身可由代码确认。

### P2（低）「私密人物」设置页被连带改成 24/页、命名优先排序

- 位置：`apps/web/src/components/photos/PhotoPrivatePeopleSettings.tsx:18`（`usePhotoPeople(ownerId, includePrivate, includePrivate)` 使用默认 `view='ALL'`）；`apps/web/src/lib/photo-management-api.ts:44`（请求 `?view=ALL&projection=cards`）；`apps/api/src/photos/photo-management.service.ts:86-90,150`。
- 触发条件：打开账号设置里的「私密人物」列表（`includePrivate` 为真）。
- 证据：改动前 `view=ALL&projection=cards` 只命中 `if (category === 'UNNAMED')` 之后的 legacy 路径，`pageSize = category === 'ALL' ? 200 : 24`，按 `createdAt, id` 排序；改动后同一请求命中新排序路径，变成 24/页、命名优先。请求 URL 未变，所以这是同一前端的隐性行为变更，需求文档与验收清单未提及该消费者。
- 实际影响：私密人物（通常只占极少数）混杂在 24 条/页、命名优先的列表里，用户要找到并解除某个人的私密规则需要明显更多次「加载更多人物」（最坏约 200/24 ≈ 8 倍点击量）；顺序也变了。功能不丢失、仍有分页按钮，所以定为低。
- 修复方向：给该设置页显式选择不会变化的列表口径（保留旧的 200/页或专用查询），或在文档/验收中明确接受这一变化；如果接受，建议在私密人物列表上提供更直接的过滤/搜索，避免让用户逐页翻。

### P3（低）新 ALL 行为的自动化测试缺口

- 位置：`apps/web/src/components/photos/PhotoCollections.review.test.tsx:303-346`、`:348-366`；`apps/web/src/components/photos/PhotoCollections.status.test.tsx:50-58`。
- 证据：
  - ALL 多选合并测试只勾选了两个未命名人物 `a`、`c`（`person('a')`/`person('c')`），命名人物 `b` 仅作为合并目标选项；没有任何自动化用例勾选 ALL 里的已命名人物并断言其 `rowVersion` 被带入 `merge-selected`。而文档声称验证了"两类人物多选"（真实 Chrome 拦截 API），提交内的组件测试并未覆盖该路径。
  - 新 ALL 空状态文案 `暂无人物。` 无任何断言；status 测试仍只覆盖 NAMED 空状态。
- 实际影响：最需要防回归的两点（命名人物作为合并来源、ALL 空状态）在默认测试集中没有保护，后续重排/改文案可能无声破坏。
- 修复方向：补一条 ALL 用例：点击已命名人物复选框 + 未命名人物，断言合并请求包含两者的当前版本；补一条 ALL 空列表断言 `暂无人物。`。另可见 `photo-person-count-page.ts` 无独立单元测试，ALL 分支仅由真实库脚本覆盖，见"限制"。

### P4（很低，文案一致性）已命名人物复用"分组"话术

- 位置：`apps/web/src/components/photos/PhotoCollections.tsx:242-247`（已命名卡片的复选框 aria-label 变成"选择分组 小明"）、`apps/web/src/components/photos/PhotoPersonMergeSelection.tsx:92,130,136`（"已选择 N 个分组""合并所选分组""分组已变化"）。
- 证据/影响：本次把命名人物也纳入多选后，这些文案对已命名人物语义不准确（尤其影响读屏用户）；不影响功能。
- 修复方向：改为中性话术（"选择人物/已选择 N 个人物/合并所选人物"）或按条目类型分支。属于建议，不阻断。

## 检查范围与限制

- 只读审查：未运行测试、未连接数据库、未执行 git；"API 470 项、网页 1008 项通过、真实 Chrome/真实库验收、lint/typecheck/build 通过"等只能依据提交内文档，未能复核。
- 文档声称"分页模块行/分支/函数覆盖率 100%"，但仓库内 `apps/api/src/photos/photo-person-count-page.ts` 没有单元测试文件，`scripts/testing/run-library-tests.mjs:263` 运行该真实库脚本时也未对该模块开启 `--experimental-test-coverage`；该数字无法从提交内容复现（不排除作者在本地用额外覆盖率参数运行过），建议主代理核对覆盖率产物。
- P1 依赖 React Query v5 失效重取的行为（快照无 `node_modules`），端到端"少一张卡"建议用组件测试确认；游标谓词导致的边界跳过可由代码推导。
- 未审查范围外文件（worker/operations/模型/策略/迁移），与 diff 和文件清单一致。

**大白话总结**：需求本身实现得比较扎实，服务端排序、游标绑定和旧协议都对，我没找到会挡住发布的问题；建议主代理优先确认"在所有人页翻了几页后改名，会不会少一张人物卡"这个边界（很可能是真问题，补个测试就能定），顺带确认私密人物设置页被顺带改成 24 条/页是否符合预期。
