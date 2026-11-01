# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`cb3975ccef27235c3c4cfd6ed0de6c30f9d07e7a..094cdce1fd50f694cff269773fa3411a4a25afaa`
- 完成时间（UTC）：2026-10-31T23:46:05.775921+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/094cdce1fd50-btkuism2`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

## 审查范围与限制

我只进行了读取：完整阅读了给定 diff 涉及的 5 个文件，以及 `AGENTS.md`、`docs/architecture.md`、`docs/product-frame.md`、`docs/current-runtime.md`、`docs/people-count-first-2026-10-31.md`，并交叉检查了 PEOPLE 目录的 `readPeopleCountPage`、`PhotoManagementService.people`、`PhotoCollections`、`usePhotoPeople`、相关单测/集成测试、API 镜像冒烟脚本和迁移目录。未修改文件、未运行命令、未访问生产环境。

无法从仓库快照验证的内容：实际 Chrome/Electron 验收、生产清理结果、`maintenance/people-all-20261101/` 私有文件、真实镜像内容、覆盖率 100% 的测量过程、以及 Git 拓扑是否与给定范围完全一致。下文涉及这些内容的判断均标注为待验证。

---

## 发现

### 1. [中] 发布来源与“本次 push 只补充文档”的说明不一致，影响成品镜像验收的可追溯性

**文件与行号**

- `docs/current-runtime.md:3`：镜像固定源码为 `cb3975ccef27235c3c4cfd6ed0de6c30f9d07e7a`。
- `docs/current-runtime.md:7`：声明“本次只改读取排序与UI”。
- `apps/api/src/eagle/eagle.service.ts:87-91`：构造器由 `@Optional()` 改为显式 `@Inject(EagleImageSearchService)`，去掉可选注入，属于启动装配行为变化。
- `apps/api/src/eagle/eagle-search-injection.test.ts:42-53`：新增“缺少 provider 时编译失败”的测试；该测试在旧的 `@Optional()` 源码上会失败。
- `scripts/testing/request-frequency.test.mjs:66-73`：新增搜索接口断言。

**触发条件与证据**

按调用者给出的范围 `cb3975cc..094cdce1`，diff 中包含上述非文档文件。若生产镜像确由 `cb3975cc` 构建，则 `eagle.service.ts` 的注入改动和新测试不在成品镜像内，文档所述“最终 API 成品启动验收”没有覆盖该启动行为；若镜像实际由 `094cdce1` 构建，则文档中的固定源码和镜像标签又不正确。两种情况都会使发布记录与实际验收代码不一致。

另外，`eagle.service.ts` 的改动不是“读取排序与 UI”，与 `current-runtime.md:7` 的范围声明冲突；新测试的加入也会影响“470 项 API 单测”的计数口径。

**实际影响**

- 回滚、复现和后续审计无法确定到底哪个提交在跑。
- “最终镜像验收通过”不能证明新增的必选注入行为已在镜像中验证。
- 若这些改动来自此前已单独排队的 `cb3975cc`，则说明当前提供的 diff/范围本身不准确，需要先校正 Git 拓扑。

**修复方向**

先核对实际构建提交和镜像标签。若镜像为 `cb3975cc`，应把注入改动和新测试作为独立源码变更重新构建并重跑 `test:api-image`，或从本次范围中移除；若镜像为 `094cdce1`，则更新 `current-runtime.md` 的固定源码、标签和“本次只改读取排序与UI”的表述，并说明新增测试和启动行为变化。

（Git 拓扑本身待验证；上述判断以调用者提供的 diff 为准。）

---

### 2. [低] 发布记录缺少本轮静态门禁、RED 反例和跳过项

**文件与行号**

- `docs/current-runtime.md:5`：只记录最终镜像启动、470 项 API 单测、1008 项网页测试、真实数据库回归和分页覆盖率。
- `docs/people-count-first-2026-10-31.md:33-35`：记录实现、隔离库、Chrome/Electron 和清理，但没有 lint/typecheck/build/architecture/contracts/format 的结果，也没有记录“先真实 DB/UI 反例失败”的 RED 阶段。
- `AGENTS.md:43-44`：每个里程碑至少运行 lint、typecheck、unit test、build；API 镜像发布前必须执行 `test:api-image`。

**触发条件与证据**

调用者给出的验证要求包含“lint/typecheck/build/architecture/contracts/format 通过”，并说明“另 1 项原跳过”。但当前发布段落没有这些结果，也没有提到该跳过项。`docs/people-count-first-2026-10-31.md:25` 的上一轮记录有完整的 lint/typecheck/unit/build 记录，容易让读者误以为本轮沿用，但本轮实际有新代码。

**实际影响**

发布记录无法独立支撑“所有门禁已通过”的结论；跳过项被隐藏；后续无法区分“未运行”和“运行通过”。这不是代码正确性问题，但会影响验收审计。

**修复方向**

在本轮发布段落补充静态门禁结果、RED 反例阶段和 1 项原跳过测试；若某项检查被有意省略，应写明原因和覆盖范围。

---

### 3. [低] 旧 UNNAMED 游标兼容性没有回归测试，文档中的“保持”未被验证

**文件与行号**

- `docs/people-count-first-2026-10-31.md:31`：声明“旧UNNAMED游标与full／options协议保持”。
- `apps/api/src/photos/photo-person-count-page.ts:12-33`：新版解码器校验 `version`、`ownerId`、`includePrivate`、`view`、`id`、`photos` 等字段。
- `apps/api/src/photos/photo-people-pagination.test.ts:197-204`：只验证用 NAMED/ALL 游标请求 UNNAMED 会被拒绝。
- `scripts/testing/photo-person-ranked.test.mjs:269-285`：只生成并消费新版 UNNAMED 游标。

**触发条件与证据**

没有测试把“部署前旧版本生成的 UNNAMED 游标 JSON”直接喂给新代码。若旧游标字段集合与新版解码器要求不完全一致（例如缺少 `photos` 或 `named` 的处理差异），上线时仍持有旧游标的客户端或已加载页会收到 400，列表需要重置。当前证据只能证明新游标可用，不能证明旧游标兼容。

**实际影响**

文档中的向后兼容承诺缺少可复现证据；不过目前没有证据表明旧格式一定不同，因此这是测试缺口而非已确认回归。

**修复方向**

增加一个使用旧 UNNAMED 游标载荷（version 1、owner/privacy/view/id/photos）的回归测试，断言返回下一页；如果旧格式确实不兼容，应在文档中明确说明并考虑前端/发布时的处理。

（旧格式具体字段待验证。）

---

### 4. [低] request-frequency 测试耦合搜索可用性，断言依赖 Embedding Space 状态

**文件与行号**

- `scripts/testing/request-frequency.test.mjs:66-73`：断言搜索返回 `imageSearch.status === 'UNAVAILABLE'` 且 `items` 为空。
- `scripts/testing/api-image-smoke.mjs:180-197`：该 fixture 由最终镜像冒烟脚本调用，当前使用全新的 tmpfs 数据库。

**触发条件与证据**

在 `api-image-smoke` 的当前路径中，数据库是新迁移的，没有 Embedding Space，因此断言是确定的。但该测试脚本自身的保护条件只要求数据库名为 `sekereagle_test`、目标为 loopback，并没有要求“没有 Embedding Space”。如果开发者在已有 `sekereagle_test` 上单独运行它，而该库此前被搜索/集成测试创建过 Embedding Space，`imageSearch` 会变成 `READY`，测试将因搜索状态而不是请求频率失败。

另外，Nest 注入行为已经由新增的 `eagle-search-injection.test.ts` 覆盖；把“搜索必须 UNAVAILABLE”放进请求频率/无 429 测试，属于不必要的耦合。

**实际影响**

测试脆弱，可能产生与请求频率无关的假失败；也容易掩盖真正的限流回归。

**修复方向**

在 request-frequency fixture 中只断言搜索请求返回 200 且没有限流响应头，不断言具体 `imageSearch.status`；把 UNAVAILABLE/搜索装配检查留在专用搜索测试中，或显式清空/准备 Embedding Space 再断言。

---

### 5. [低/待验证] 新增“人物目录”链接的锚点可能失效

**文件与行号**

- `docs/current-runtime.md:7`：链接 `people-count-first-2026-10-31.md#2026-11-01所有人目录`。
- `docs/people-count-first-2026-10-31.md:27`：标题为 `## 2026-11-01：所有人目录`（全角冒号）。

**触发条件与证据**

链接省略了标题中的全角冒号 `：`。GitHub 常用 slugger 主要移除 ASCII 标点，U+FF1A 这类非 ASCII 标点是否保留取决于渲染器；若保留，实际锚点为 `#2026-11-01：所有人目录`，当前链接会失效。该判断依赖实际文档渲染器，需在 GitHub 或项目文档站上点击验证。

**实际影响**

“规则与成本”链接无法跳转到本轮新增章节，降低发布记录可读性。

**修复方向**

把标题中的全角冒号改为空格，或使用与渲染器一致的正确锚点/显式 HTML 锚点。

---

### 6. [低] ALL 空状态没有回归测试，总数与列表的一致性也没有真实数据交叉验证

**文件与行号**

- `apps/web/src/components/photos/PhotoCollections.tsx:320-322`：ALL 空状态显示“暂无人物。”。
- `apps/web/src/components/photos/PhotoCollections.status.test.tsx:50-58`：只覆盖默认 NAMED 视图的空状态。
- `apps/web/src/components/photos/PhotoCollections.review.test.tsx:348-365`：总数标签使用 mock summary 验证，未与 ALL 列表实际返回数量交叉核对。

**触发条件与证据**

需求明确要求“页签UNNAMED改ALL并显示named+unnamed总数”和“空状态更新”。当前测试能证明 NAMED 空状态和 mock 下的 ALL 总数标签，但不能证明：
- 切到 ALL 且没有人物时显示“暂无人物。”；
- 真实数据下 `summary.named + summary.unnamed` 与 ALL 列表实际可分页总数一致。

**实际影响**

空状态或总数投影回归不会被现有测试捕获；属于低风险但直接的测试缺口。

**修复方向**

增加一个 ALL 零人物 UI 测试；再增加真实隔离库断言，比较 summary 总数与 ALL 分页遍历得到的人物总数（含隐私/命名边界）。

---

## 已核对且未发现确定性问题的部分

- `photo-person-count-page.ts` 的 ALL 排序为 `named DESC, count(DISTINCT a.id) DESC, id`，与需求“已命名优先、未命名按照片数降序、同数量按 ID”一致；照片数按不同可见资产计数，不是人脸数。
- 游标绑定 owner、includePrivate、view 和 ALL 的 version 2，并携带 named/photos/id；分页取 25 条返回 24 条，没有总数量上限。
- 显式 `view=ALL&projection=cards` 走新的计数/代表脸路径；`view=UNNAMED` 保持 version 1；`view=full/cards/options` 的 legacy 路径仍保留。
- 前端 ALL 使用独立的 `cards-ranked-v2` 缓存标记，并在已加载页上按 named、photoCount、id 重排；ALL 中的多选合并仍走原 `merge-selected` 接口和回执投影。
- 中英文文案包含“所有人/All people”和空状态文案；`PhotoCollections.status.test.tsx` 覆盖了 NAMED 空状态。
- `apps/api/prisma/migrations` 下确为 74 个迁移目录，文档中的“74项迁移无新增”与快照一致。
- 镜像标签后缀 `cb3975ccef27` 与文档中的源码前缀一致。

---

## 总体判断

人物“所有人”的核心排序、游标、代表脸和前端缓存/多选逻辑与原始需求基本一致，未发现确定性的功能错误。最需要主代理先处理的是第 1 条：本次 diff 里出现了非文档代码，和“只补文档、镜像源码固定为 cb3975cc”的说法对不上；其余是发布记录和测试补强，属于低优先级但不建议忽略的缺口。

**大白话总结：** 功能看起来是按需求做的，文档也没发现明显说错的地方；但这次 diff 里混进了非文档代码，跟文档写的“镜像源码固定 cb3975cc”对不上。主代理先确认到底哪个提交在跑——如果镜像就是 cb3975cc，那新增的注入改动和测试不在镜像里，文档的“成品验收”就对不上；如果镜像是 094cdce1，文档写死的源码又不对。其余是发布记录和兼容性测试补强，不阻塞推送。
