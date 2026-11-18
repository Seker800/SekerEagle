# 2026年11月18日 Windows 便携版与 Mac 桌面端对齐

> 状态：历史记录 | 归档日期：2026-11-18 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 范围与版本

- 运行源码：`13b1fbef`（仅桌面默认缓存容量与跨平台打包；网页、API、数据库未变）。
- macOS 客户端：`/Applications/SekerEagle.app` 0.1.9，app.asar SHA-256 `ca3a6a38cf35ffa1cdc6e6a2b0ee8a6d81217ee02ac2c5fec285fe7b5635a1df`。
- Windows 便携包：`apps/desktop/release/SekerEagle-0.1.9-windows-x64-portable.exe`，98 MB，SHA-256 `81a65bb792b56f2bbdad96fd04f7116eedf1a2b5b37f4fe30dfbd9c9d7e19941`；其 app.asar 与 Mac 相同，均为 `ca3a6a38…`。
- Web 保持 `sekereagle/web:cacheopt-67e99d52`；API／operations／library-reader 未变。

## 平台一致性

- 移除便携版单独的 2 GiB 默认缓存上限，安装版和便携版统一使用 10 GiB；用户仍可在设置里按 1–100 GiB 调整。
- 本次控制台 UI、v3 缓存身份、切片直读、先显示后校验、旧版缓存清理都在共享桌面代码中，Windows 包重新构建即包含，不存在按平台分支的实现。
- Mac arm64 与 Windows x64 包的 app.asar 哈希完全相同，是“无分叉”的直接证据。
- 仍保留的平台差异只有环境本身：缓存目录位置（Mac 在 `~/Library/Caches`，Windows 便携版在 `SekerEagleData`）、图标/菜单、签名与安装方式；不改变缓存键、命中逻辑或页面结构。

## Windows 安装步骤

1. 关闭 Windows 客户端，备份旧的 `D:\SekerEagle\SekerEagle-0.1.9-windows-x64-portable.exe`。
2. 用上面的新 exe 替换旧文件；保留 `SekerEagleData`（连接设置、账号缓存和 v3 缓存都在里面）。
3. 启动后打开设置 → 本地媒体缓存，确认控制台 UI 和“缓存不按时间过期”说明。
4. 如果旧版本曾经手动保存过 2 GiB 的缓存上限，设置文件会保留该值；打开设置改成 10 GiB 即可。没有保存过的话，新默认值直接是 10 GiB。
5. 如果页面显示旧版缓存占比，点“清理旧版缓存”回收；只删缓存，不动原图。

## 验证

- 桌面 227 项测试、类型检查、构建通过；Mac 包已替换安装并正常启动。
- Windows 包在本机 macOS 上交叉构建成功；其 app.asar 与 Mac 完全一致，说明业务代码没有平台分叉。
- 未在 Windows 实机打开界面核对字体、玻璃效果和窗口尺寸；未做 Windows 签名。

## 回退

- Windows：换回备份的旧 exe，`SekerEagleData` 保持。
- macOS：用 `~/SekerEagle-client-backups/SekerEagle-0.1.9-20261118-before-cacheopt.app` 或从上一提交重新打包。

## 限制

- Windows 实机 UI 验收待补；交叉构建未签名，SmartScreen 可能提示。
- 2 GiB 上限曾保存到旧设置的机器需要手动改成 10 GiB；新默认值不会覆盖用户已保存的选择。
- 缓存目录位置和系统级清理策略仍是平台差异，不是代码分叉。
