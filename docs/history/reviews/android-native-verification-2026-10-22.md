# 0.2.0 安卓原生首版

## 实现范围

本轮将 Android launcher 切换为独立 NativeActivity／Jetpack Compose。网页源代码零改动；服务器业务与 API、数据库 schema 零改动。旧 MainActivity 不再对外导出，原生核心流程不创建 WebView。已有 Java 备份和释放空间通过 SessionApi 继续利用；不是复制备份引擎，也没有把本机文件能力交给 JavaScript。

| 能力       | 本轮实现                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| 登录与会话 | 原生登录表单、既有 Cookie 会话及一次续期重试、Keystore 加密保存、注销立即清本机身份与凭据、服务器会话尽力撤销            |
| 两种模式   | 一套 Compose 列表／查看器／搜索与仓储，按 PHOTO／MATERIAL 绑定现有 API，清掉旧在途显示状态                               |
| 列表       | 按日照片网格、素材网格、3／4 列、游标分页、空状态、加载与重试、返回保留列表滚动位置                                      |
| 大图       | 派生预览、双击缩放／复位、双指缩放、平移、左右分页、旋转、日期时间、信息菜单                                             |
| 搜索       | 原生全屏、系统键盘和搜索动作、示例关键词、按账号／部署／模式的历史与清空、搜索结果回到共用列表                           |
| 更多       | 账号及地址、已有手机备份和释放空间、退出；不展示未完成的高级功能                                                         |
| 风格       | 黑底、小型模式胶囊与独立搜索、右上圆形按钮、原生图层背景磨砂（Android 12 起，Android 11 为半透明回退），文字与图标不模糊 |

尚未接入的新原生能力：系统分享、收藏、标签、回收站管理、地图、人物、编辑与视频播放。视频只展示封面；不伪装成已可播放。大图最高解码边长 2048，未实现服务端金字塔的原生深层浏览；不据此宣称超大 RAW 可无损任意放大。高级功能不跳转网页兜底。

## 模块与边界

NativeGalleryViewModel 管状态及导航；NativeGalleryRepository 管受作用域限制的分页与派生媒体；Compose 页面不直接操作 HTTP、数据库或删除手机文件。列表与媒体 URL 均通过 NativeGalleryPolicy 按模式构建。当前媒体版本严格匹配 mediaRevision，排除 edit 显影副本，普通看图不读取原件。

NativeSession 仅向规范化后的当前服务发送 `/api/` 请求，禁止跟随重定向；只接收当前服务的 access／refresh Cookie，刷新 Cookie 仅发给 auth 路径，不接收私密解锁 Cookie。私密解锁和私密模式没有开放入口。凭据独立存入 Keystore 加密字段，不与 WebView 共享；密码不持久化。注销与在途响应通过凭据代次锁协调，旧响应不能恢复已删除的凭据；刷新通过专门锁协调，最多一次续期后重试。回到前台先复核身份，失效会话清空旧界面并暂停备份，身份确认成功后才考虑打开自动备份。

图片读取单次最多 16 MiB，解码检查源尺寸且使用采样，最多四项并行读取／解码、32 MiB 内存 LRU；无持久媒体磁盘缓存。JSON 响应最多 2 MiB。切换账号／模式和注销会清理或隔离旧数据与请求结果；离线和失败显示重试，不把未完成请求标为成功。

原有 Java 备份核心继续验证当前服务、部署、账号和目标模式，保留格式目录生成、增量／去重／断点续传及清理复核。原生宿主的返回回到原生更多页面，不进入旧 WebView。重新打开相同会话不主动停止已有手动备份。

## 本机验证与限制

仅使用新建 loopback 工作台、临时 sekereagle_test 数据库、独立存储、随机账号、合成媒体和 Android 36 模拟器。没有连接、部署或修改生产、群晖或 SekerChat。模拟器结果不替代小米／HyperOS 真机的后台、帧率、触控手感或长列表性能验收。

测试凭据只在显式 `PHOTO_WORKBENCH_NATIVE=1` 时写入被忽略、权限 0600 的本机临时文件；测试夹具生成器校验其与存活的 loopback 工作台一致，仅放进 androidTest assets，绝不进入应用 APK。工作台正常停止时删除凭据文件。不要分发测试 APK。

验证命令：

```sh
npm run db:guard
npm run android:check:device
npm run test:coverage --workspace @sekereagle/android
npm run lint
npm run typecheck
npm test
npm run build
npm run architecture:check
npm run format:check
```

工作台运行需设置 `PHOTO_WORKBENCH_BASIC=1 PHOTO_WORKBENCH_NATIVE=1`；其余工具路径和安全启动方式沿用 android-client.md。设备门禁仍拒绝物理手机，实机验收另按原生计划执行。

首次迁移的构建依据：[AGP 内置 Kotlin](https://developer.android.com/build/migrate-to-built-in-kotlin)、[Compose 编译器](https://developer.android.com/develop/ui/compose/setup-compose-dependencies-and-compiler)、[Compose BOM](https://developer.android.com/develop/ui/compose/bom)。使用既有 AGP 9.2.0，Compose 编译器 2.3.21 与 BOM 2026.03.00，保留 compileSdk 36／minSdk 30；实际兼容性由本轮构建验证。

## 验证结果

- 本机 Android 36 模拟器 23 项测试全部通过：原有 15 项回归与新增 8 项原生流程／协议检查；覆盖真实登录、双击及双指缩放、左右分页、键盘搜索、系统返回、模式资源隔离、原生备份／清理子页无 WebView、续期与 Cookie 路径、媒体重定向／类型／大小拒绝、注销时在途响应失效和当前媒体版本选择及前台恢复时的会话复核。
- 安卓 JVM 单测 30 项通过；原生结构门禁 7 项通过。既有 JaCoCo 核心统计行覆盖 97.54%、分支 86.74%，不包含完整 Compose UI；结构门禁自身行覆盖 100%、分支 85.71%。不将这些比例冒充整个 App 的覆盖率。
- 安卓 lint、Kotlin／Java 编译、APK 构建、完整项目 lint／typecheck／unit test／build、architecture:check 与 format:check 均通过。应用 APK 已检查不含测试凭据夹具。
- 原生看图流程另行重跑并保存 `native-home.png`、`native-viewer.png`、`native-search.png`、`native-more.png`，位于 `.omx/artifacts/native-final-shots`；最后在模拟器重新启动 NativeActivity，并恢复隔离账号的图库。搜索截图包含真实系统键盘。
- 首次原生测试失败是测试向已有服务器输入内容追加文本，已改为替换输入；没有放宽服务地址校验或延长等待掩盖问题。测试等待实际界面及帧绘制后再截图。

状态：本机原生候选版，待小米实机验收。完整日志保存在 `.omx/artifacts/native-*`。
