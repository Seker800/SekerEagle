# 2026年11月18日桌面切片直读与首屏先显示后校验发布

> 状态：历史记录 | 归档日期：2026-11-18 | 不代表当前运行状态；现行事实读 [current-runtime](../../current-runtime.md)。

## 范围与版本

- 运行源码：`67e99d52`（网页 `SekerEaglePage` 与桌面主进程；API 未变）。
- Web：`sekereagle/web:cacheopt-67e99d52`（linux/amd64，基于 `viewer5d4d0ce0` 叠加本地 `apps/web/dist`）。
- API／operations／library-reader 保持 `sekereagle/api:share4k-e57b7ab7`／`sekereagle/api:refactor-93b5d583`；无迁移、无 schema 变化、无数据写入。
- macOS 客户端：`/Applications/SekerEagle.app` 0.1.9，app.asar SHA-256 `63fb85841db3d52fc2216b389a6129ab2be7b866536aad9fb16f780228f88adf`。

本次修改：

- 读取过当前资产的切片说明后，同一修订的大图切片直接读本地缓存，不再逐块联网确认。
- 没有新鲜列表依据的缩略图／预览图先显示磁盘副本，再在后台校验可见性；401／403／404 或不再允许持久化时删除该资产缓存并通知页面刷新，断网与限流等暂时失败保留本地副本。
- 当前列表已明确删除或转私密的资产不进入乐观显示；未登录、主体／连接／模式变化仍先失败关闭。
- 真实端发现线上切片说明没有 `revision` 字段，首版 `cacheopt-abb4c3e3` 因此错误重置快照；`67e99d52` 改为按当前列表 `mediaRevision` 绑定，并让查看器每次打开重读一次切片说明。首版只在本机短暂验证，未作为最终版本保留。

## 构建与切换

- 首版 `sekereagle/web:cacheopt-abb4c3e3` 先在 11:08 部署；真实端验证发现切片仍逐块重验后，修正并构建 `cacheopt-67e99d52`，11:18 覆盖 web。
- 构建上下文、`before-web.private.json`、容器清单、`images.json`、`rollback.json`、`compose-diff.json`、`public-verification.json` 保存在 NAS 私有 `maintenance/cacheopt-67e99d52/`（首版在 `maintenance/cacheopt-abb4c3e3/`）。
- Compose 展开对比只有 web 镜像变化；执行 `up -d --no-deps web`，其余容器 ID 全部未变。
- 公网 `index.html` SHA-256 `038ab2b162414aed7821746abda94e12ce7f26616edd8ebfe07987ed99dfb078`，入口 JS `index-DDgTz6nZ.js` SHA-256 `3f893ae7c0b1e5fd7f7b9b579f7ada3abaa8b57f6d99b1f0143e7f7daa15c7c9`，与本地构建和镜像内文件一致。
- 公网首页 200、`/api/health/ready` 200、匿名 `/api/eagle/assets` 401；web healthy。
- 切换前后计数：MATERIAL 64,851、PHOTO 58,751（合计 123,602）、回收站 12,105，与上一版一致。

## 桌面客户端与真实端验证

- 用当前源码构建 macOS arm64 未签名客户端，替换 `/Applications/SekerEagle.app`；旧客户端完整备份在 `~/SekerEagle-client-backups/SekerEagle-0.1.9-20261118-before-cacheopt.app`（app.asar `ca6263bf…`）。
- 通过本机远程调试在真实客户端、真实账号和真实图库上操作：
  - 重启客户端后进入照片模式，打开 11648×8736 的 `DSCF3509` 并放大：首次加载 31 块切片为联网读取（miss 7→38）。
  - 关闭后重新打开同一照片并放大：31 块切片全部本地直读，`revalidatedHitCount` 保持 0、`missCount` 保持 38、`localHitCount` 51→81。
  - 对已缓存缩略图先重置列表快照，再通过真实媒体协议读取，返回 `x-sekereagle-cache-result: OPTIMISTIC`，正文不等待联网校验。
- 客户端正常重启后进程存在，未生成 `renderer-failures.log`。

## 回退

- Web 回退：`sekereagle/web:cacheopt-abb4c3e3`（再上一版 `viewer5d4d0ce0`）。
- macOS 客户端回退：关闭客户端，用上面的备份 `.app` 替换 `/Applications/SekerEagle.app`。
- 不需要回退 API、数据库、迁移或对象存储。

## 限制

- 素材模式首批 40 项都没有 READY 大图切片（404），因此真实端切片验收在照片模式完成；素材切片路径由隐藏 Electron 夹具覆盖。
- 首屏乐观显示在真实客户端通过“重置快照后读取已缓存缩略图”验证，未在真实首屏竞态中复现“先显示再撤回”的完整用户路径。
- Windows 客户端和 `/downloads/desktop/` 分发未更新；macOS 包未签名。
- 真实首屏和翻图的延迟数值未测量；本次结论来自请求结果与计数，不是性能 p95。
