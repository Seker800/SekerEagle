# DeepSeek 独立审核

- 状态：report_received
- 提交范围：`22e7867a278a2d3df6b2ba0cf78928f42dfe82f0..7a603df2db866e888201102b76fe5007d9181655`
- 完成时间（UTC）：2026-10-30T14:35:13.581401+00:00
- 本地审查记录：`/Users/seker/seker-workspace/SekerEagle/.git/deepseek-reviews/7a603df2db86-q3rep3nz`

报告仅针对上述提交，是独立建议，不是推送门禁，也不代表当前工作区已通过审核。

# 独立审查报告（固定范围 `22e7867a..7a603df2`）

## 审查范围与方法

- 只读审查指定快照；未运行测试/构建，未访问生产、数据库、凭据或原工作区，未修改任何文件。
- 重点阅读了 `BackupService.java`、`MainActivity.java`、`BackupScreen.java`、`MobileBackupTest.java`、`App.tsx`、`SekerEaglePage.tsx/.test.tsx`、`AccountHome.tsx` 及相关文档；对删除文件按 diff 核对。
- 快照没有 git 历史，无法验证 RED/GREEN 提交号（`65b8f8d1`、`327516a3`、`d87621a1`、`90288a9d`）、祖先关系及“已部署/已实测”声明。

## 结论摘要

未发现会直接阻断推送的正确性缺陷。网页首页隐私开关的删除是完整的：`LibraryPrivacyToggle` 组件、旧测试、页面装配、`onPrivacyVisibilityChange` 回调及 App 对首页的注入均已移除；账号页仍保留唯一授权开关和原认证接口。安卓 `retiring` 交接方向自洽，`pendingRestart`、最新 `startId`、用户暂停/网络/权限作用域均未破坏，也没有新增生产测试钩子。

下面两项是低风险问题，建议主代理独立判断是否处理。

## 问题清单

### 1. 低（P3）：新增的“运行中内部取消”测试在取消时扫描/上传尚未真正开始

- **文件与行号**
  - `apps/android/app/src/androidTest/java/com/sekereagle/android/MobileBackupTest.java:1200-1236`（`cancelRunningBackup`）
  - 同文件 `243-258`（`holdBackupExecutor`）
  - `apps/android/app/src/main/java/com/sekereagle/android/BackupService.java:140-157, 307-312`
- **触发条件与证据**
  - `cancelRunningBackup` 先调用 `holdBackupExecutor()` 占住唯一串行执行器，再调用 `activity.startBackup()`；`runBackup` 的调用被排在阻塞任务之后。
  - 此时 `working=true`，因此 `BackupService.isRunning(scope)` 为真，但 `runBackup` 主体尚未执行：`settings.setFlag(running, true)`、`guard()`、`activeApi = ...` 都还没发生。
  - 取消发生后 `release.countDown()` 才释放执行器（`1229-1231`），`runBackup` 随后进入 `guard()` 因 `cancelled` 直接抛 `Hold` 并退休。测试断言只覆盖 `userPaused`、`status`、`lastFinished` 和 `currentBackup()==null`（`1226-1235`），没有覆盖扫描/上传进行中的取消。
- **实际影响**
  - `cancelRun(false)` 的“不写用户暂停、清空待恢复、正常退休”语义已覆盖，修复了上一轮“该分支完全没执行”的问题；但“真实运行中取消”的更强含义——中断正在进行的扫描/上传和 `activeApi.close()`——仍无测试。若未来取消逻辑无法打断在途传输，现有用例不会发现。文档 `docs/deepseek-followup-2026-10-30.md:9` 的“真实服务运行中取消”表述略强于实际证据。
- **修复方向**
  - 在保留现有快速用例之外，增加一条让 `runBackup` 真正开始（例如等待 `settings.flag(running)` 且出现扫描计数/首条传输记录，或使用较大的测试文件）后再调用 `cancelBackup` 的用例；或明确把文档限定为“服务实例已建立、任务已入队时的内部取消”。

### 2. 低（P3，静态分析、未在设备复现）：正常完成到 `retiring=true` 之间仍有极窄的启动丢弃窗口

- **文件与行号**
  - `BackupService.java:233`（写入 `lastFinished`）
  - 同文件 `242-248`（`finally` 中先 `api.close()`、`wake.release()`，之后才 `retiring = true`）
  - 同文件 `123-125`（`working=true && !cancelled && !retiring` 时直接丢弃启动）
- **触发条件与证据**
  - 若一个允许的自动启动恰好在扫描已写入 `lastFinished`/“备份完成”之后、`retiring=true` 之前到达，`onStartCommand` 看到 `working=true`、`cancelled=false`、`retiring=false`，会直接返回，不写入 `pendingRestart`。
  - 随后该 run 进入 `finally` 退休，自动启动被静默丢弃；`MainActivity` 侧的 `autoPending` 已在调用 `startBackup(false)` 前置为 `false`，需等下一次前台/身份检查才会再次触发。
  - 新增测试 `MobileBackupTest.java:1238-1284` 是在 worker 完全返回（`retiredWorker` 完成、`retiring` 已为真）后才注入启动，因此只覆盖了已修复的窗口，没有覆盖上述更窄窗口。
- **实际影响**
  - 与已修复问题同类，但窗口仅剩 `api.close()` + `wake.release()` 的一小段，实际概率低；影响仍是自动备份被跳过一次。未在设备复现，属代码时序分析，建议标注待验证。
- **修复方向**
  - 在 `finally` 开头、资源清理之前就设置 `retiring=true`（仍只在 `current == this` 时设置），让该窗口的启动进入 `pendingRestart`，由原有主线程 handoff 统一启动；若可构造，补一条在该窗口注入启动的回归。

## 已核查、未发现可证实问题的部分

- **首页隐私开关删除完整**：全仓已无 `LibraryPrivacyToggle` 实现/引用；`SekerEaglePage` 的 `onPrivacyVisibilityChange` 属性和装配已删除；`App.tsx` 仅保留给账号页 `AccountHome` 的回调；`updatePrivacyVisibility` 仅由账号页调用。首页仍只读消费 `privacyVisibility`，侧栏“隐私素材”仅在已授权时作为视图导航出现，不是授权开关。
- **双模式负例**：`SekerEaglePage.test.tsx:1754-1793` 在 MATERIAL/PHOTO、开启/关闭四种组合下断言不存在“显示/隐藏隐私内容”按钮或 switch，并保留旧回调也不会被调用；即使旧调用方通过 spread 传入回调，页面也不再支持。
- **账号页未回归**：`AccountHome.tsx:96-156, 406-452` 仍使用账号页开关和 `updatePrivacyVisibility`，App 仍向账号页注入更新回调；退出/切模式重置状态的逻辑未被改动。
- **安卓交接语义**：`retiring` 只在 worker 收尾时置真、在新 run 开始时清假；`onStartCommand` 在 `working && (cancelled || retiring)` 时排队，handoff 在主线程统一清 `working`、持久 `running=false` 并启动排队任务，`latestStartId` 仍取自最近一次 `onStartCommand`；未发现旧完成回调停掉新 run 的路径。`runScan` 改为等待 `currentBackup()==null`，比只看持久 `running` 更严格。
- **恢复测试证据**：`immediatePauseAndResumeRetiresTheLatestServiceStart` 主动写入历史 `lastFinished`，阻塞首轮执行，断言新文件在恢复前不存在于服务端，再等待与历史值不同的新完成记录、服务状态完成和文件存在；唯一像素图避免跨测试内容去重误判。
- **文档一致性**：`architecture.md:17`、`performance-verification-2026-10-30.md:163`、`current-runtime.md:3` 与 `deepseek-followup` 的首页隐私入口描述互相一致；历史 `docs/deepseek-reviews/22e7867a...md` 是上一轮报告，不冒充当前门禁。

## 其他观察（非阻塞）

- **持久 `running` 时机未被测试钉住**：`BackupService.java:257` 把 `running=false` 移到 handoff，但新测试都只等 `currentBackup()==null`；若有人把 `running=false` 写回 worker 的 `finally`，现有用例仍会通过（`retiring` 仍能保护排队启动）。可在 `automaticStartDuringNormalRetirementIsNotLost` 主线程阻塞期间补一条 `assertTrue(settings.flag(scope, "running"))`，直接覆盖“退休窗口内仍未完成”的状态。
- **4 秒主线程等待的稳健性**：`MobileBackupTest.java:1251-1258` 在主线程内最多阻塞 4 秒等待真实 worker（含 `/api/auth/me`、媒体扫描）完成；慢设备上可能超时导致用例失败，且主线程阻塞接近 ANR 阈值。这不是已证实缺陷，但属于测试稳定性风险。
- **历史文档**：`docs/main-integration-2026-10-30.md:9` 仍把“私密快捷入口”列为已完成整合项。若该文档定位为历史快照可忽略；若被当作现用能力清单，建议加注本轮已撤销。
- **删除文件的旧测试**：`LibraryPrivacyToggle.test.tsx` 删除后，账号页授权/撤销仍由现有 `AccountHome.test.tsx` 覆盖；`隐藏隐私内容` i18n 键变为未使用，但不影响构建或行为。

## 验证限制

- 未执行 lint/typecheck/unit/build/架构门禁/契约测试，也未运行安卓设备测试；所有“9 项设备回归、918+15 网页、167 桌面、80% 覆盖率、真实 Chrome/部署/healthy”结论均未由本报告复核。
- 快照无 git 历史：无法验证 RED/GREEN 提交、提交祖先关系、网页镜像是否确由 `90288a9d` 构建、API/worker 是否仍为 `f166dc01`。
- 无法读取生产/临时工作台，也无法确认 `maintenance/privacy-home-90288a9d-20261030/images.json`、临时验收主体清理等运行侧声明。
- 第 2 项问题为静态时序分析，未在真实设备复现，请按“待验证”处理。

**一句话总结**：这轮改动的主路径是自洽的，首页隐私开关确实删干净了，账号页入口保留，安卓退休窗口的核心修复方向正确；真正值得补的是“取消发生在真实扫描/上传进行中”的测试证据，以及正常收尾最后几毫秒仍可能丢一次自动启动的极窄窗口。
