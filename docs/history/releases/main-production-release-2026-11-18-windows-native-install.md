# 2026年11月18日本机 Windows 客户端升级到 13b1fbef 原生构建

> 状态：历史记录 | 归档日期：2026-11-18 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 范围

- 仅本机 Windows 便携客户端（`D:\SekerEagle`）。网页、API、operations／library-reader、数据库与 Mac 客户端均未改动。
- 源码：HEAD `4d5ae6e9`（仅文档提交），桌面代码与上一轮 Mac 对齐构建同为 `13b1fbef`。
- 本机旧 exe 是 11-17 构建，缺少 11-18 的缓存控制台、v3 缓存身份与旧缓存清理；本次补齐。

## 构建与安装

- 在 Windows 10.0.26200 上用 electron-builder 26.18.0 原生重建：`npm run package:win --workspace @sekereagle/desktop`。
- 产物：`apps/desktop/release/SekerEagle-0.1.9-windows-x64-portable.exe`，102,645,805 字节，SHA-256 `597acca0…`；`app.asar` SHA-256 `e0fa70c0…`。
- 旧 exe（`2fb31110…`）备份到 `D:\SekerEagle\backup\SekerEagle-0.1.9-windows-x64-portable-20261118-before-upgrade.exe`；`SekerEagleData` 未移动、未删除。
- 与 11-18 Mac 交叉构建记录（app.asar `ca3a6a38…`、exe `81a65bb7…`）不同：那是 Mac 主机产物，本机原生重建以本机哈希为准。

## 验证

- 桌面 `typecheck` 与 227 项测试通过，`package:win` 构建成功。
- 实机启动后图库正常加载（约 5.9 万项），连接状态为外网，客户端版本 0.1.9。
- 桌面设置页（连接管理）显示新版缓存控制台：上限 10.0 GiB、总缓存 139.9 MiB、当前账号 3.0 MiB、长期命中率 64%，并有“旧版缓存 / 清理旧版缓存”入口，与 `13b1fbef` 口径一致。
- 运行中解包目录的 `app.asar` 哈希与构建产物一致（`e0fa70c0…`），确认进程加载的是新构建。
- 核对用的 `--remote-debugging-port` 仅用于本次验证，最终运行进程已去掉该参数，9222 无监听。

未验证项：未做 Windows 代码签名与干净机安装；只确认了“清理旧版缓存”入口和统计，未执行实际删除。

## 回退

- 关闭客户端，用备份 exe 覆盖回 `D:\SekerEagle\SekerEagle-0.1.9-windows-x64-portable.exe`；`SekerEagleData` 保持不动。
