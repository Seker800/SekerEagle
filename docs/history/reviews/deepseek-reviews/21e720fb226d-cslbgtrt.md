# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`18ecd92719bf4c722d01418bacd50664a097c9cb..21e720fb226d706a85dce04ab7871da0e21c67f5`
- 完成时间（UTC）：2026-10-31T17:05:57.799947+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/21e720fb226d-cslbgtrt`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

## 审查报告（只读快照审查）

**审查范围**：`18ecd927..21e720fb` 中调用者给出的两处改动（`EagleDuplicates.tsx`、`EagleDuplicates.test.tsx`），并对照 `docs/architecture.md` North star、`docs/library-duplicates.md`（产品行为基线）与 `apps/web/src/lib/eagle-duplicates-api.ts`。服务端 API 和 operations 不在本次改动内，未审查。未运行任何命令，未修改文件。

### 结论

未发现可证实的正确性缺陷、数据安全回归或需求遗漏。修复点很小，且只改变“未处于逐组比较”时的分支语义，与需求一致。

### 关键逻辑核对

- **旧行为**：原 `advance` 只拦截 `current && !signatures.includes(current)`。当 `expanded === null`（跨页勾选后批量提交）时，代码会继续执行 `groups.findIndex(... === null)` 得到 `-1`，再拼出 `groups` 的旋转列表，返回第一个既未提交、也未选中的组，导致意外展开并在 `DuplicateComparison` 内触发 `api.members`（`EagleDuplicates.tsx:837-841`），违反 `docs/library-duplicates.md:69`“展开才读组内成员”的既有基线。
- **新行为**：`EagleDuplicates.tsx:299` 显式短路为 `null`，保持收起；`EagleDuplicates.tsx:300` 原分支未动，因此“手动逐组比较提交后接续已加载下一组”（`docs/library-duplicates.md:25`）保留。三个调用点均已核对：`247`（乐观推进）、`288`（成功）和 `711`（忽略后）；`258` 的 4xx 回滚仍能展开失败组，不受影响。
- 该分支是唯一入口；`DuplicateComparison.members` 只在该组件挂载时创建（`grep` 确认 `duplicate-members` 仅出现在 `231/837`），因此收起即不再有组内 GET，修复范围充分。
- 附带效应是改善了旧投影下 `allExact` 提交可能展开未选 SIMILAR 组的同类路径，属同一条规则的自然结果。

### 问题（均为低，建议，不阻断）

**1. 低：批量提交成功后键盘焦点会落到 body（由收起语义带来的焦点管理缺口）**

- 位置：`apps/web/src/components/eagle/EagleDuplicates.tsx:71-79`（尤其 `75-78`），与 `297-309` 交互。
- 触发条件：未展开任何组时，跨页勾选 → “清理所选重复组” → 确认；成功后 `onSuccess` 先 `setConfirm(null)`（`273`），确认区卸载。
- 证据：`useEffect` 在确认关闭后只查找 `button[aria-expanded=true]` 并聚焦；修复保证此时没有展开组，查询为 `null`，不会聚焦任何元素，而原焦点所在的“确认移入回收站”按钮已卸载，焦点落回 body。
- 影响：纯交互可访问性——键盘或读屏用户失去位置；无数据、权限或任务状态影响。说明：`allVerified` 全量批量路径在修复前已是同样表现，所以这是让本路径与既有行为一致，而非新增资源风险。
- 修复方向（可选）：确认关闭且无展开组时，把焦点交给稳定目标（结果区标题设 `tabIndex={-1}`，或回到“清理所选重复组/刷新结果”按钮），不改动展开逻辑。

**2. 低：新增 RED 用例的断言是间接代理，且 mock 实现会跨用例残留**

- 位置：`apps/web/src/components/eagle/EagleDuplicates.test.tsx:113-159`（新增 `114-121`、`135-140`、`157-158`）。
- 证据与判断：本用例中第三组 `d` 从未被展开过，成员查询缓存为空，所以 `expect(mocks.members).not.toHaveBeenCalled()`（`158`）确实等价于“未展开”，加上 `157` 等待成功提示（位于 `advance` 之后、`setNotice` 前后同一提交）保证了 RED 有效。但若将来出现成员预取、缓存预热或 `staleTime` 内的复用，同一缺陷可在不调用 `members` 的情况下被掩盖；更直接的断言是第三组组头 `aria-expanded === 'false'` 且不出现 `收起`/组内比较区。
- 另：`mocks.members.mockResolvedValue(...)` 为持续实现，`beforeEach` 的 `vi.clearAllMocks()` 只清调用记录、不清实现，该桩会带入后续用例。当前后续用例要么自设桩、要么不断言 `members` 未调用，因此尚无实际影响；但以后若新增“不得加载成员”的断言，可能被这个残留桩伪通过。建议改用 `mockResolvedValueOnce`，或在 `beforeEach` 补 `mockReset()`。
- 影响：仅测试可靠性，不影响本次通过结果。

### 已核对但未发现问题的点

- 需求“不替换用户删除/不删真实照片”：本次仅前端展开状态与测试，无删除路径变更。
- “手动逐组比较继续能力”：`EagleDuplicates.test.tsx:431-494` 仍覆盖提交后展开下一组并保留勾选；`EagleDuplicates.tsx:300` 分支未改。
- 跨页选择提交的签名集合、修订版本与“每组保留一份”计数未被改动（`588-622`），新增用例断言 `signatures` 恰为 `[a, c]`、不含未选 `d`，符合需求。
- 单测数量：该文件 `it(` 共 22 项，与调用者所述“22 项查重单测”一致。
- 未新增接口、队列、上限或服务端逻辑，符合 AGENTS 的“单 owner、不加产品配额、后台独立 operations”边界；未发现架构偏离。

### 未验证与限制

- 只读审查，未执行测试，因而无法独立确认“RED 在修复前失败”的实跑结果、22 项/135 文件 1003 项 web 测试、typecheck、lint、架构与 web 构建通过；上述 PASS 结论来自调用者陈述，我只核对了代码与用例结构。
- 焦点问题是从代码路径推导，未在真实浏览器验证。
- 未审查 `18ecd` 版本的 API/operations（调用者说明未变），也未做递归审查。

**一句话总结**：这次修复方向正确且改动最小——批量跨页提交后不再误展开下一组、不再多打一次 members 请求，手动逐组比较仍能接续；只有“确认后键盘焦点丢失”和“新用例断言偏间接 + mock 桩跨用例残留”两个低优先级点，建议顺手处理，不构成阻断。
