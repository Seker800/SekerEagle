# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`7a603df2db866e888201102b76fe5007d9181655..8fcd2265abfcbe0a0c94d078017e8bf747cf2a7f`
- 完成时间（UTC）：2026-10-30T15:23:40.063771+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/8fcd2265abfc-ptq6v5q5`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 独立审查报告：人物确认质量修复（7a603df2..8fcd2265）

结论：**未发现会阻塞发布的正确性缺陷**。核心修复（两入口共用“当前模型+当前媒体版本+清晰人脸+双向强相似”证据门槛、相似度优先排序、展示实际匹配脸、向量不外泄、不合并历史身份）与代码一致。下面 3 条为可证实的一致性问题，1 条为待验证的静默漏问边界；均不改变“少问、不误问”的方向。

---

## 已核对成立的部分（检查范围）

- 两入口确实共用最终证据策略：`readPhotoPeopleReview` 与 `PhotoPersonReviewService.suggestions` 都在原型检索后调用 `readPersonReviewEvidence` + `qualifyPersonReviewPairs`（`apps/api/src/photos/photo-people-review.ts:151-158`、`apps/api/src/photos/photo-person-review.service.ts:64-70`）。
- 门槛与文档一致：检索 0.40（`photo-person-review-evidence.ts:7`，两路共用常量），单样本 0.60、多样本最佳≥0.55、双向各≥0.50、平均分较小值≥0.50（同文件 `9-11,69-79`）；照片数只做同分排序（`89-97`）；每组最多 3 张不同照片（`PERSON_REVIEW_SAMPLE_LIMIT`，SQL `142-146`）。
- 排序/分散：相似度优先、每人最多 4 条边、检索上限 800（`photo-people-review.ts:72-100`）；成题每人只出现一次、上限 100（`photo-person-review-evidence.ts:98-107`）。
- 守卫保持：owner、PHOTO、私密、当前 revision、当前模型、同框、人工否定均在 SQL/服务层生效（`photo-people-review.ts:111-150`、`photo-person-review-evidence.ts:134-141`、`photo-person-review.ts:44-60`）；`decide` 仍做 rowVersion 与唯一分离记录 fencing（`photo-person-review.service.ts:131-161`），合并仍走 `mergePeople`。
- 生物向量不外泄：两路返回的 select 均不含 prototype/embedding（`photo-people-review.ts:169-196`、`photo-person-scope.ts:25-53`），集成测试也断言了这一点（`scripts/testing/photo-person-review.test.mjs:186-188`）。
- 未改 worker 自动归类阈值 0.45（`apps/worker/src/photo-faces.ts:118-132`），未加性别推断、模型、schema、队列或 provider；i18n 新键在 `zh-CN`/`en-US` 同时存在；路由 `people/review` 与 `people/review-priority` 无冲突。
- 文档与代码总体一致（`docs/architecture.md` North star、`docs/photo-people-review.md`、`docs/photo-people-quality-2026-10-30.md`），仅“旧版本统计排除”只做了一半，见问题 1。

---

## 问题 1｜低｜“待整理分组”计数与目录/筛选列表的版本口径不一致

- 文件与行号：
  - 计数：`apps/api/src/photos/photo-person-review.service.ts:24-38`（新增 `AND f."assetRevision"=a."mediaRevision"`，第 29 行）
  - 目录：`apps/api/src/photos/photo-management.service.ts:111-114`（`people()` 只要求 `isCurrent` + 可见资产），人脸 select 在 `145-164` 行
  - 可见性定义：`apps/api/src/photos/photo-person-scope.ts:4-12`（无 revision 比较）
- 触发条件与证据：某组只剩 `isCurrent=true` 但 `assetRevision != asset.mediaRevision` 的脸——媒体版本已更新而人脸重扫未完成/失败，或历史数据异常。计数 CTE 排除了这些组；`people()` 的 `faces.some({ isCurrent, asset: visible })` 未排除，仍会在 NAMED/UNNAMED 列表展示，并可能用旧框在当前预览上裁出错位人脸。对比：`readPhotoPeopleReview`/`readPersonReviewEvidence` 都已过滤 revision（`photo-people-review.ts:118,206`、`photo-person-review-evidence.ts:135`）。
- 实际影响：标签页/提示的“自动分组”数与列表实际条数可能不一致；被计数“排除”的组仍出现在列表里，用户会看到数量对不上。属于低严重度；若重扫永久失败则持续存在。
- 修复方向：让目录、计数共用一个“当前可见组”谓词（例如 `people()` 也要求存在 `assetRevision=mediaRevision` 的 current face，或抽一个共享 SQL/helper），或把这类 stale 组显式标成“需重新分析”而不是从计数里静默消失。
- 待验证：生产库中 `isCurrent=true && assetRevision != mediaRevision` 的组有多少；该状态是否只出现在重扫窗口内。

## 问题 2｜低｜确认页仍把自动分组称为“未命名人物”

- 文件与行号：`apps/web/src/components/photos/PhotoPeopleReview.tsx:88-89`（`alt` 与文字都用 `t('未命名人物')`）。同类残留：`PhotoPrivatePeopleSettings.tsx:50`、`SekerEaglePage.tsx:2663`。
- 触发条件与证据：任意未命名分组进入确认页。`PhotoCollections.tsx:185` 已改为“未命名分组”，`docs/photo-people-review.md` 也明确“未命名显示自动分组而非真实人数”，但真正问“是不是同一个人”的界面仍把两侧叫“人物”。
- 实际影响：与“2800 是分组不是人数”的核心信息自相矛盾，容易继续强化误解；低严重度。
- 修复方向：确认页统一用“未命名分组”，仅当 `name` 存在时才用“人物”。

## 问题 3｜低｜空状态测试用的首屏形状与真实接口不同，未覆盖真实无候选体验

- 文件与行号：`apps/web/src/components/photos/PhotoCollections.review.test.tsx:151-161`、`apps/web/src/components/photos/PhotoPeopleReview.server.test.tsx:10-26` 都把 `getPhotoPeopleReview` mock 成首屏 `nextCursor: null`；真实首屏见 `apps/web/src/lib/photo-management-api.ts:184-192`，无论 pairs 是否为空都返回 `nextCursor: 'priority-complete'`。
- 触发条件与证据：priority 接口返回 `pairs: []`。组件此时 `hasNextPage` 为真，显示的是“继续查找相似人物”按钮（`PhotoPeopleReview.tsx:134-141`），而不是测试断言的“暂时没有需要确认的相似人物。”；后者只有在遍历完所有分页后才会出现。
- 实际影响：测试给了“证据不足时无题可问”的 UI 信心，但真实首屏行为未被覆盖；在 2800 组库里用户可能要靠多次手动“继续查找”才能确认无相似人物。低严重度（不是错误提问，只是空状态体验/测试保真）。
- 修复方向：补一个按真实 `photo-management-api` 首屏形状的组合测试；若希望空状态自动出现，可在首屏 pairs 为空时有界地预取下一页，而非只给按钮。

## 问题 4｜低·待验证｜证据查询依赖预览宽高非空，可能出现“可计数但永不成题”的静默漏问

- 文件与行号：`apps/api/src/photos/photo-person-review-evidence.ts:138-141`（`r.width * f.box[3]>=48 AND r.height * f.box[4]>=48`）；`apps/api/prisma/schema.prisma:718-719`（`width Int?`、`height Int?`）。
- 触发条件与证据：某 PREVIEW/THUMBNAIL 目录存在但 `width`/`height` 为 NULL 时，乘法结果 NULL，整行被 WHERE 丢弃；而候选/计数只要求存在默认预览或缩略图（`photo-people-review.ts:123-126`、`photo-person-review.ts:35`）。结果是组被计数、被原型检索到，却永远不产生问题，且无日志。
- 实际影响：方向上安全（少问），但可能让“确认人物”在部分真实库上看起来失效。当前 worker 写预览时带宽高（`apps/worker/src/main.ts:569-582`），是否存在历史 NULL 行需以生产数据核实——标注待验证。
- 修复方向：用 `COALESCE(r.width, a.width)` 等兜底，或让计数/检索与证据使用同一 rendition 条件；至少记录被过滤的组数便于诊断。

---

## 限制与未核实项

- 只读审查固定快照，未运行命令：CI、迁移状态、镜像标签/摘要、Chrome 验收、真实图库准确率均未独立复现；`docs/current-runtime.md` 的部署与 health 声明按“文档声称”处理，未核验。
- 阈值是工程截断值、非身份概率，且文档已自述未用个人全库人工标注校准；合成验收不能证明真实识别准确率——这一点文档已明确，不再作为缺陷重复计分。
- 未验证生产库中“stale current face”和“预览宽高为空”的实际分布，问题 1、4 均按触发条件标注。
- 大组场景的性能只有合成规模证据（2000 人/10001 照片）；证据 SQL 的 per-face LATERAL 与 400 候选组结合时的真实耗时，文档也未承诺生产性能，故不单列为缺陷。

大白话总结：这次修复的方向是对的——只拿当前版本、足够清晰且双向强相似的人脸来问，两个入口共用一套门槛，不动真实身份和自动归类模型，也没发现会阻塞发布的问题；真正值得顺手收口的是三件小事：待整理计数和目录列表的版本口径要统一、确认页别再叫“未命名人物”、空状态测试要按真实首屏形状写。
