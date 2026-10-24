# 安卓 0.8.0 全面检查与修复（2026-10-24）

本轮以工作区 `a57ab07` 的安卓 0.8.0 为基线，检查原生图库、会话与凭据、后台手动上传、手机备份、释放空间、筛选分页及服务端契约。只连接本机隔离工作台和 API 36 模拟器；未访问或修改生产、群晖与 SekerChat，未部署、未推送。

## 结论

未发现无需凭据即可越权、绕过登录或读取他人资源的 Critical 缺陷。确认并修复了一批会导致“暂停后仍上传、自动备份静默漏文件、筛选无结果、清理被单个坏文件中断、上传永久失败反复重试”的问题，同时统一了安卓与服务端的格式筛选和上传会话契约。剩余的会话凭据设计与真机边界在文末单独列出，不能把本轮模拟器结果当成小米实机验收。

## 已确认并修复

| #   | 严重度 | 问题                                                                                                                 | 处理                                                                                                                                                                                                                                                                                  |
| --- | ------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 高     | 准备阶段（读取文件元数据）按下暂停后，READY 状态仍会无条件启动上传；前台服务可能已停止，上传却继续                   | [NativeUploads.kt](../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeUploads.kt) 增加最终取消闸门；空选择/取消会发布 FINISHED；[NativeUploadLifecycleTest.kt](../apps/android/app/src/test/kotlin/com/sekereagle/android/NativeUploadLifecycleTest.kt) 覆盖            |
| 2   | 中     | Android 14 部分照片授权会被自动备份当成完整扫描，静默漏掉未授权相册                                                  | [BackupPermissionPolicy.java](../apps/android/app/src/main/java/com/sekereagle/android/core/BackupPermissionPolicy.java) 统一判断；[BackupService.java](../apps/android/app/src/main/java/com/sekereagle/android/BackupService.java) 在服务端入口再次拒绝部分授权；传输页增加授权提示 |
| 3   | 中     | 安卓格式筛选发送上传扩展名（jpg/heic/m4v…），服务端按存储格式（jpeg/heif/mp4…）精确匹配，部分选项永远返回空          | 服务端 media capabilities 新增 `formats`；[NativeGalleryRepository.kt](../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeGalleryRepository.kt) 优先使用 `formats`，旧服务端回退到别名映射；服务端与 JVM 测试覆盖                                                       |
| 4   | 中     | 上传会话永久失败后，GET session 不返回 `finalizationAttempts`/`objectCleanupPending`，客户端无法写终态，续传反复 409 | [eagle-upload.service.ts](../apps/api/src/eagle/eagle-upload.service.ts) 返回这两个字段；安卓原有终态判断因此生效；API 测试覆盖                                                                                                                                                       |
| 5   | 中     | BackupService 复用同一实例时 `cancelled` 和扫描计数可能从上一轮残留，新备份首次 guard 即被中止                       | [BackupService.java](../apps/android/app/src/main/java/com/sekereagle/android/BackupService.java) 在每次新任务前复位取消标志、计数和错误列表                                                                                                                                          |
| 6   | 中     | 手动上传的异步命令在账号/容量复核失败时静默 return，但 UI 已提示“已加入传输列表”                                     | [NativeTransferManager.kt](../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeTransferManager.kt) 通过事件回传失败原因；图库 ViewModel 显示消息                                                                                                                         |
| 7   | 中     | 清理扫描遇到一个空文件、超大文件、撤销权限或读取失败的文件就整体失败，无法列出其余可清理项                           | [CleanupEngine.java](../apps/android/app/src/main/java/com/sekereagle/android/core/CleanupEngine.java) 将本地不可读/变化文件保留并返回 null；[CleanupScreen.java](../apps/android/app/src/main/java/com/sekereagle/android/CleanupScreen.java) 逐项跳过尺寸异常                       |
| 8   | 中     | 自动备份和手动传输的 30 分钟唤醒锁不会续期，长任务中途可能失去 CPU 保证                                              | 两个前台服务在进度/guard 中按 25 分钟窗口续期                                                                                                                                                                                                                                         |
| 9   | 中     | 0.1 版 WebView 的明文 Cookie 不随原生退出清理，升级后最近任务中的旧宿主仍可能恢复已登录状态                          | [LegacyWebSession.java](../apps/android/app/src/main/java/com/sekereagle/android/LegacyWebSession.java) 首次原生启动清理一次；原生注销/会话失效时再清理。遗留 WebView 宿主仍保留用于迁移回归，见残余风险                                                                              |
| 10  | 低     | 备份页前台每 5 秒轮询 `/api/auth/me`，约 720 次/小时                                                                 | [MainActivity.java](../apps/android/app/src/main/java/com/sekereagle/android/MainActivity.java) 改为 30 秒；回前台仍立即复核                                                                                                                                                          |
| 11  | 低     | 原生 Cookie jar 忽略 `Expires`，服务端用 Expires 删除 Cookie 时客户端仍保留                                          | [NativeCookies.java](../apps/android/app/src/main/java/com/sekereagle/android/core/NativeCookies.java) 解析 Expires，Max-Age 优先；单测覆盖                                                                                                                                           |
| 12  | 低     | 通知栏复用带深色背景的应用图标，小图标会显示成白色方块                                                               | 新增 [ic_notification.xml](../apps/android/app/src/main/res/drawable/ic_notification.xml) 并使用于两个前台服务                                                                                                                                                                        |
| 13  | 低     | 遗留 WebView 下载文件名未经过统一清洗                                                                                | [MainActivity.java](../apps/android/app/src/main/java/com/sekereagle/android/MainActivity.java) 复用 `NativeDownloadPolicy.fileName`                                                                                                                                                  |
| 14  | 低     | 持久队列中一行损坏会丢掉全部批次                                                                                     | [NativeTransferStore.kt](../apps/android/app/src/main/kotlin/com/sekereagle/android/NativeTransferStore.kt) 逐行恢复，损坏行单独跳过                                                                                                                                                  |
| 15  | 低     | 设备测试登录没有统一限流间隔，快速运行时触发真实 5 次/分钟限制，造成 429 假失败                                      | 新增仅测试使用的 [TestLoginThrottle.kt](../apps/android/app/src/androidTest/kotlin/com/sekereagle/android/TestLoginThrottle.kt)，不降低服务端限制                                                                                                                                     |

相关文档同步：`docs/android-client.md` 更新到 0.8.0 并补充后台传输说明；README 安卓定位改为独立原生 App；OpenAPI 生成文件随 media capabilities 字段更新。

## 仍需处理或实机确认

- **备份 PAT 生命周期**：PAT 目前无过期时间，服务端 authenticate 不比对创建时的 authVersion，应用内也没有撤销入口；改密码或停用账号后，已保存的 `asset:write` 令牌仍可能继续上传。这需要服务端设计调整（过期、authVersion 绑定或注销撤销），本轮未改。
- **凭据落盘的失败语义**：`BackupSettings` 仍忽略 `commit()` 返回值；刷新令牌轮换时若加密落盘失败，理论上存在假注销或旧 refresh token 触发整族撤销的风险，属于磁盘/IO 异常下的残余风险。
- **注销与 in-flight 刷新竞态**：媒体请求恰好在刷新时注销，服务端新轮换的 refresh token 可能未被撤销。概率低，但完整修复需要注销与刷新串行化。
- **遗留 WebView 宿主**：目前仍保留给旧回归测试；首次原生启动与原生注销会清理其 Cookie/WebStorage，但在“升级后先打开最近任务、且从未启动原生页”的狭窄路径下不能完全排除旧会话。彻底方案是删除该宿主或强制升级迁移登录。
- **手动传输通知权限**：Manifest 已声明 POST_NOTIFICATIONS，原生流程仍未主动申请；未进过备份设置的用户在 Android 13+ 可能看不到通知栏暂停入口。
- **向上补页的视觉锚点**：向前加载会把新页 prepend 到列表，LazyGrid 按索引保位，视口可能跳到更旧内容。属于体验问题，未改。
- **性能与可访问性**：右侧快速滑块在 composition 中读取 `grid.layoutInfo`（Lint `FrequentlyChangingValue`），磨砂全屏重绘与小米真机帧率仍未测量；快速滑块没有独立无障碍语义。
- **发布形态**：仍是 debug 签名包，release 未配置签名/压缩，不能作为商店或正式发布物。
- **未覆盖**：小米 HyperOS 真机后台、锁屏、厂商省电策略；大图库内存/帧率；私密库、地图、人物、编辑、高清切片、磁盘缓存和进程死亡导航恢复仍是既有产品缺口。

## 验证

- 安卓 JVM：**51 项通过，0 失败**；核心 JaCoCo 门禁通过，行 **97.2%**、分支 **86.6%**、方法 98.0%、类 100.0%。
- Android Lint：**0 error**，11 个 warning（既有 SharedPreferences、静态 Context 引用、快速滑块 FrequentChangingValue 等）；`assembleDebug` 成功。
- 设备回归：API 36 arm64 模拟器（4 GB）**45/45 通过，0 跳过、0 失败**，使用本机隔离工作台（loopback、临时 `sekereagle_test` 容器、合成媒体）；补装静态 ffprobe 后 RAW/视频测试通过。
- API：`apps/api` typecheck 通过；media capabilities 与 upload 服务定向测试 **15/15 通过**；OpenAPI 已重新生成。
- 测试中的 429/模拟器离线均为测试环境问题：统一登录间隔、补装 ffprobe、加大模拟器内存后完整通过；不是应用失败。

## 边界

未连接生产、群晖或 SekerChat；未修改生产数据库、对象存储、处理开关、镜像或部署；未 push。设备与工作台均为本机隔离资源，测试结束后已停止。
