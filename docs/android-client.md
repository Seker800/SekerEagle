# 安卓客户端与手机备份

安卓版目前是本机验证的预览版，最低 Android 11，目标 Android 16。共用网页图库、素材／照片工作区和服务端业务；Java 原生层负责目录授权、扫描、备份检查点、网络传输和前台进度通知。没有把文件系统或备份入口暴露给网页 JavaScript。

## 使用

1. 首次打开在「账户」填写 SekerEagle 的 HTTPS 网关地址，在图库使用原账号登录。首页右上角的账户图标可再次进入连接设置。调试 APK 额外允许 localhost／127.0.0.1 的 HTTP，正式构建不允许明文 HTTP。
2. 点击首页右上角的云图标进入「手机备份」，启用备份。应用为当前主体创建仅有 `asset:write` 的独立令牌，使用 Android Keystore 加密保存在应用私有目录中；网页拿不到令牌。可在网页版账号令牌管理中撤销「Android 手机备份」。
3. 选择一个或多个手机相册目录，或使用系统选择器授权其他文件夹。目录项可以修改目标模式、子目录范围或移除。初始目标为照片；切换当前浏览模式不会改变备份目标。目录移除不删除已备份资源。
4. 按需启用「打开时自动备份」。手机的定时任务只需打开应用；应用确认登录身份后自动执行，无需再次点击备份。
5. 可限制仅 Wi-Fi、仅充电。低于 15% 且未充电时暂停。首次大量上传可启用「专注备份」，在备份页保持屏幕唤醒。

小米／HyperOS 建议允许自启动、后台联网，并将省电策略设为无限制。应用提供系统设置入口；各机型设置名称不同，模拟器结果不能代替小米实机后台验收。

## 小屏交互

0.1.1 原生界面采用 [Material 3](https://m3.material.io/components/app-bars/overview) 和 Material Components Android 1.13.0，备份组织参考 [Immich 的手机备份流程](https://docs.immich.app/features/mobile-backup/)。取消底部三块大按钮；图库为主界面，云备份与账户是顶部图标，子页返回同一个 WebView，不重载图库。

720px 及以下采用共用工作区的手机组合：标题、选择、导入和搜索优先；视图与筛选按钮打开底部面板，缩略图滑杆与详情入口收进面板。单击图片直接打开共用查看器，长按或点击选择进入批量操作。详情改为按需模态面板，菜单与筛选浮层保持在所属模态内。桌面继续使用内联工具栏和侧边详情，共用原有资源、筛选状态、上传与编辑服务。

备份页以状态卡、自动开关、可选目录和网络条件分组，更多设置收纳通知、后台运行提示和重新检查。设计目标是减少默认露出的功能，而非维护第二套手机业务。

## 数据语义与边界

- 支持的图片、RAW、视频格式与大小预算由 `library-core` 生成到 APK，服务端仍执行最终内容检查。不会上传文档、压缩包等任意文件，不压缩或修改原字节。
- 媒体目录只枚举未处于写入状态、未进系统回收站的项目；额外授权目录递归读取，逐文件检查大小、修改时间、哈希及读取稳定性。未知时间戳不会直接走快速跳过。
- 本地指纹是文件 URI、大小和修改时间。成功文件快速跳过；改名或移动后的相同内容通过内容回执跳过。文件变化会生成新的备份项，不覆盖旧资源。
- 内容回执、文件检查点、目录设置和上传会话按网关 origin、部署身份、账号及模式隔离。每个任务冻结目录目标模式，换服务、换账号或注销会停止当前任务。
- 新内容先通过共用 `/api/{eagle|photos}/uploads/check-content` 查询当前主体可见的未删除资源，只返回 `exists`，不返回资源 ID；已有内容不传输文件。并发上传仍由共用完成事务做最终去重。
- 服务器确认原文件入库后才记录成功；缩略图、人物等派生处理可以继续在服务端执行。SQLite 原子保存成功状态和内容回执；上传检查点保存会话 ID、哈希和分片大小，恢复时读取服务端已收分片，重新签名未完成分片。过期／已中止会话重新创建，入库中的会话保留待下次确认。
- 手机删除不删除服务器副本。服务器删除也不会使普通扫描反复补传；「重新检查全部文件」会清空本账号本机回执并重新检查，明确提示可能补传服务器已删除文件。
- 网络／电量不满足或任务中断时保留检查点，下一次打开或手动重试接续。当前版本不承诺在应用未打开时按固定时刻唤醒，也不承诺绕过 Android／HyperOS 的后台限制。
- Android 14 的部分照片授权不当作完整目录授权；相册目录备份要求完整图片和视频权限，避免静默漏传。系统授权仍受安卓目录限制；未被媒体库收录的 RAW 可以通过可授权的目录读取，不能访问其他应用私有目录。
- 应用禁用云备份和设备迁移，避免令牌与媒体 URI 授权在别的设备被错误复用。WebView 只在应用内导航到当前服务，禁用本地文件访问、混合内容及第三方 Cookie；上传链接要求签名和当前网关／loopback 来源。

## 构建和检查

需要 Node 22、npm、JDK 17 或更新版、Android SDK 36。Gradle Wrapper 固定为 9.4.1；SDK 路径优先读取 `ANDROID_HOME`／`ANDROID_SDK_ROOT`，也支持本机常用目录。原生构建不参与服务器镜像，不要求服务器安装 Android 工具链。

```sh
npm ci
npm run android:check
npm run test:coverage --workspace @sekereagle/android
npm run android:install
```

调试包位于 `apps/android/app/build/outputs/apk/debug/app-debug.apk`，应用 ID 为 `com.sekereagle.android.debug`。release 构建需要另行配置发布签名；本轮不配置发行密钥、不发布商店、不部署服务端。

## 隔离模拟器验收

严禁连接生产或群晖。沿用现有 `scripts/testing/photo-workbench.mjs`，它创建新的 loopback 测试端口、临时 `sekereagle_test` 数据库、独立对象存储、随机测试认证与账号，并在迁移和导入前运行安全目标检查。测试图库使用合成图像；RAW 和视频样本由既有相机测试生成器创建。

准备本机 ExifTool、ffmpeg、ffprobe，以及安装了 `scripts/testing/camera-requirements.txt` 的 Python。根据实际工具路径设置 `EXIFTOOL_PATH`、`FFMPEG_PATH`、`FFPROBE_PATH`、`CAMERA_RAW_PYTHON`。不要读取或复用生产环境文件。

```sh
npm run build
PHOTO_WORKBENCH_BASIC=1 PHOTO_WORKBENCH_PORT=42319 \
  EAGLE_BACKGROUND_PROCESSING_ENABLED=false \
  node scripts/testing/photo-workbench.mjs --serve
```

等待出现测试工作台就绪消息，再在另一个终端执行。以下命令只应针对安卓模拟器；存在多设备时设置 `ANDROID_SERIAL` 为模拟器序列号。

```sh
adb reverse tcp:42319 tcp:42319
npm run install:device --workspace @sekereagle/android
adb shell pm grant com.sekereagle.android.debug android.permission.READ_MEDIA_IMAGES
adb shell pm grant com.sekereagle.android.debug android.permission.READ_MEDIA_VIDEO
npm run test:device --workspace @sekereagle/android -- \
  -Pandroid.testInstrumentationRunnerArguments.origin=http://localhost:42319
```

设备测试仅接受显式给出的 localhost HTTP 地址，并使用测试工作台的专属登录入口；测试代码和自动登录不包含在应用 APK 中。测试完成后停止工作台会删除它创建的临时容器；不影响其他数据库或服务。

## 2026-10-21 验证记录

- 根目录 architecture:check、lint、typecheck、完整 unit test、build 通过；认证上传共用契约与新预检 owner／模式／私密／DTO 负向测试通过。
- 安卓核心单测通过，JaCoCo 门禁要求核心行与分支覆盖均至少 80%；已测行覆盖 98.25%、分支覆盖 87.25%。这里只统计平台无关决策核心，不把这个比例冒充整个原生 UI 或 Android 适配层覆盖率。
- 6 项 Android 36 arm64 模拟器集成测试全部通过，真实 HTTP 流程覆盖：首次备份、同内容异名、重复扫描、改名、打开自动上传新增项、素材／照片隔离、未写完文件排除、RAW／视频、下载目录范围、Keystore 与 SQLite 作用域隔离。
- 大于 5 MiB 的合成 PNG 在第二片传输中主动失败；确认第一片已在服务端存在，关闭并重开 SQLite 后沿用同一会话完成原片入库。
- 真实强制停止应用后加入新的测试图片，再打开应用自动扫描，结果为扫描 1、上传 1、失败 0。
- 通过系统选择器实际授权 Documents 下的测试目录，扫描其中未进入媒体索引的合成 DNG，结果成功；图库和原生备份界面均已截图检查。
- 未验证：小米真机不同 HyperOS 版本的后台存活、长时间锁屏与大规模图库性能、手机上所有编辑格式的内存表现。不得据模拟器验收宣称这些均已通过。
- 未连接或修改生产、群晖及 SekerChat；没有部署或推送发布。

## 0.1.1 小屏改版验收

- architecture:check、lint、typecheck、完整 unit test、build、format:check 通过；93 项定向界面测试覆盖手机单击浏览、长按选择、面板开关／焦点恢复／作用域关闭、模态内筛选及现有桌面行为。
- Android lint、核心单测及 80% 行／分支覆盖门禁通过。8 项 Android 36 模拟器测试通过，其中 7 项功能回归和 1 项可选截图；导航回归确认顶部轻量入口、自动备份开关、账户连接与返回同一 WebView。
- 测试初始化等待重新确认的登录主体，并自行准备模拟器媒体权限，避免将旧的持久身份或安装后重置的授权当作可用状态。截图只使用独立测试账号与合成图片；检查了中文照片首页、视图面板、备份页和账户页。
- 本地安装包：`apps/android/release/SekerEagle-0.1.1-android-debug.apk`。未访问生产、群晖或 SekerChat；小米实机验收仍未执行。
