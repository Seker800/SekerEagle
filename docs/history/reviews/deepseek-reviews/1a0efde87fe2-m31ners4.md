# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`b54698f8c9c2d768a7e50c7ea7b5ecee3073c940..1a0efde87fe2ab8ed1e8575f9fedb1d3be51e19c`
- 完成时间（UTC）：2026-11-02T14:33:02.969533+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/1a0efde87fe2-m31ners4`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 独立代码审查报告

**范围**：`b54698f8c9c2d768a7e50c7ea7b5ecee3073c940..1a0efde87fe2ab8ed1e8575f9fedb1d3be51e19c`
**模式**：只读审查，未修改文件、未运行命令/测试、未调用其他代理。

## 结论

未发现可证实的生产正确性缺陷、回归、越权/隐私问题或架构偏离。核心修复方向正确且改动最小：在 `src` 赋值前声明 `crossOrigin = 'use-credentials'`，桌面媒体协议已有的"精确 origin + allow-credentials + `Vary: Origin`"策略正好满足；未放宽 CSP/webSecurity，未改 API/worker/数据库/权限/租约，未新增上限或 UI 阻塞。

有 3 条**低严重度、非阻断**的问题，均属"发布记录/验收证据"而非产品缺陷。另附已知限制和待验证项。

## 检查范围

- 逐项核对准确差异中的 6 个文件（`PhotoEditor.tsx`、`photo-editor-export.ts`、两个新增/新增测试、发布文档、桌面回归脚本）。
- 读取相关上下文：`apps/desktop/src/main/navigation-policy.ts`（CORS 策略）、`main.ts`（协议注册与 `handleMediaRequest`）、`apps/web/src/lib/media-resolver.ts`（预览 URL 解析）、`EaglePhotoEditing.tsx`、`eagle-api.ts`、`eagle-media-sources.ts`、`eagle-transfer-facts.ts`、`browser-origin.guard.ts`、`photo-editor-render.ts`、`image-clipboard.ts`、Android `NativeEditor.kt`、`docs/architecture.md`、`docs/desktop-client.md`、`client-cache-experience` 文档。
- 限制：准确差异只含上述 6 个文件；25 个分支整合与桌面 0.1.9 主体代码不在本差异中，我没有评审也无法替其背书。所有"ci:check / 真实 Electron 通过"均来自发布文档，我没有独立复跑。

## 问题

### 1. [低] 发布文档的固定版本段与后文 web 候选冲突，最终部署的网页源码/镜像未定稿

- **文件/行**：`docs/main-production-release-2026-11-02-evening.md:9`、`:31`、`:37`
- **触发条件**：读者/后续部署者按此文档核对生产镜像与回退依据时。
- **证据**：
  - `:9` 写"固定应用与不可变 Mac 执行器源码为 `51f8bc80…`……随后提交只修正验收脚本……不改变产品代码"，并记录网页镜像为 `sekereagle/web:main-evening-51f8bc804222`。
  - `:35` 说明首轮生产启动后才发现新 Electron 缓存画布问题；`:37` 给出新的网页源码 `c2129902…` 与候选镜像 `editor-cors-c2129902b9dc`，且该源码包含本差异中的 web 产品代码（`PhotoEditor.tsx`、`photo-editor-export.ts`）。
  - `:31` 仍保留"生产切换、双端生产合成主体验收和最终 Git 核对将在完成后追加现场结果；本段准备记录不代表已上线"。
- **影响**：文档没有一处最终状态说明"生产实际运行的是哪个 web 源码/镜像"；"随后提交不改变产品代码"在出现 CORS 修复后已不成立。"准备记录不代表已上线"的谨慎表述是符合要求的，但这意味着发布记录本身没有记录最终上线结果，审计/回退时只能依赖会话信息。`docs/current-runtime.md` 不在本差异中，而 AGENTS 要求部署后同步核验日期与证据。
- **修复方向**：在文档追加最终发布段，写明实际生产 web 镜像 tag/digest、对应源码提交、85 项迁移在生产确认、双端验收与最终 Git 核对结论，并明确 `main-evening-51f8bc80` 的网页镜像是否已被 `editor-cors` 取代；同步更新 `docs/current-runtime.md`。若宿主计划在推送后补记，应在文档中明确标注"最终结果待补"。
- **待验证**：生产是否最终切到 `editor-cors` 候选、`current-runtime.md` 是否在本次推送后更新；我无法从快照读取提交先后关系。

### 2. [低] 桌面 E2E 的"两模式编辑器实际像素"中，材料模式没有走缓存预览 CORS 路径

- **文件/行**：`scripts/testing/desktop-photo-regression.mjs:91-104`、`:260`
- **证据链**：`EaglePhotoEditing.tsx:118-123` 仅在 `asset.photoMetadata` 存在时设置 `previewSource`；`PhotoEditor.tsx:318` 用 `previewSource ?? source`；`eagle-transfer-facts.ts:443-445` 只为 `PHOTO` 写 `EaglePhotoMetadata`。因此素材资产打开编辑器时 `previewSource` 为空，加载的是同源 `/api/eagle/assets/:id/original`，不会请求 `sekereagle-media://`。
- **触发条件**：运行该脚本的 `eagle`（素材）模式编辑器验收。
- **影响**：真实缓存画布 CORS 回归只在照片模式被覆盖；素材模式那条像素断言实际验证的是"同源原图的编辑器渲染/布局"。这不是产品回归（素材模式本来就不使用该缓存预览），但文档 `:37` 和结果字段 `actualEditorPixelsInBothModes` 容易被读成"两模式都验证了缓存 CORS"。
- **修复方向**：在 `results.json` 的 limitation 和发布文档里区分"编辑器像素渲染"与"缓存画布 CORS"的覆盖范围；如需材料模式也覆盖，应在验收中显式断言照片模式请求了 `sekereagle-media://` 且画布可读，而不是仅看画布有像素。
- **待验证**：生成 `.omx/artifacts/desktop-018-workbench.json` 的夹具脚本不在本快照内，无法确认照片模式夹具是否确实带 `EaglePhotoMetadata`（按文档的复现过程推断应当有）。

### 3. [低] E2E 画布像素断言包含 alpha 通道，区分不了"画了内容"与"透明/纯黑画布"

- **文件/行**：`scripts/testing/desktop-photo-regression.mjs:96-99`
- **触发条件**：画布为全黑不透明（RGB=0，A=255）或只有 alpha 非零时。
- **证据**：`getImageData(...).data.some(value => value > 0)` 对 RGBA 数据逐字节判断，alpha 通常为 255。
- **影响**：对本次回归仍然有效（tainted canvas 时 `getImageData` 抛错、`catch` 返回 false，最终 `waitForFunction` 超时失败），但"实际像素"的语义弱于字面，无法发现"画布可读但渲染为空/黑"的另一类问题。
- **修复方向**：忽略 alpha（`index % 4 !== 3 && value > 0`）或与夹具已知颜色/像素比较。

## 已核对、未发现问题的点

- **属性设置顺序正确**：`photo-editor-export.ts:45` 在 `src` 之前设置；`photo-editor-export.test.ts:20-22` 与 `PhotoEditor.test.tsx:1145` 通过 `src` setter 读取 `crossOrigin` 证明顺序。
- **同源路径不受影响**：web 端 `source` 恒为同源 `/api/...`；CORS 检查只作用于跨源响应。唯一跨源来源是桌面 `sekereagle-media://`，其协议注册了 `corsEnabled: true`，`mediaCorsHeaders` 返回精确 origin、`allow-credentials: true`、`vary: Origin`（`navigation-policy.ts:8-15`、`main.ts:880-889`），且仍先经过 `isAllowedMediaOrigin` 和缓存控制器的主体/版本/私密校验。
- **取消语义未回归**：`AbortController` 重构保留"abort 后不 setError、清空 `src`、清空 onload/onerror"的行为；既有测试 `PhotoEditor.test.tsx:925-966` 仍然成立。
- **未触碰安全/架构边界**：无 API、worker、DB、迁移改动；无 owner 推导、跨 owner 404、私密、租约、暂停/时段、终态事务改动；无新增配额或上限。
- **其他消费者不受影响**：Android 原生编辑器 `/source` 为同源（`NativeEditor.kt:146-154`）；复制图片走 `resolveClipboardImageUrl` + `fetch(credentials: include)`（`image-clipboard.ts:50-67`），不读画布；`/original` 由 API 流式返回（`eagle.controller.ts:384` 起），不存在跨源 presigned 重定向被 CORS 打断的问题。

## 已知限制（非缺陷）

- 未在 Windows 原机/DPI/外部软件真实拖放上验收（任务已声明）；CORS 修复在 macOS Electron 验证，Electron 使用同一 Chromium CORS 栈，残余风险低。
- 客户端无自动更新，新安装包不会替换已安装程序；旧客户端由媒体能力协商回退到 API 路径，不受本次 `use-credentials` 影响（0.1.8 起媒体协议才带 CORS，文档 `client-cache-experience` 已记录）。
- `desktop-photo-regression.mjs` 是独立验收脚本，不在 `ci:check` 内，该回归不是持续门禁。
- 我没有运行任何测试，无法独立确认文档中的 `ci:check`、真实 Electron、48 项定向测试等通过结论。

**一句话总结**：这次修复本身没什么可挑的毛病——只改了一个加载器、没动安全边界、协议端 CORS 头本来就匹配；真正需要补的是发布记录把网页最终版本和"两模式像素 vs 缓存 CORS"的口径写清楚，否则回退和验收证据会对不上。
