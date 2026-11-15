# 地图位置行删除立即失效（2026-11-15）

## 问题

`20261114212500_photo_map_delete_keeps_snapshot` 把 `mark_photo_map_dirty()` 的所有 `DELETE` 都当作非敏感变化，只设置 `dirtyAt`。删除 `EaglePhotoLocation`／`EaglePhotoMetadata` 行（例如撤销照片代理的城市建议）会移除坐标，但 `visibilityVersion` 不提升，旧地图快照继续通过成员查询提供该位置，直到后台重建完成；成员查询只按 `EagleAsset.mediaRevision` 过滤，不会发现位置行已删除。

## 修复

新增迁移 90 `20261115150000_photo_map_location_delete_sensitive`，替换同一个触发器函数：

- `EagleAsset` 的 DELETE 仍只标脏（删除照片不立即清空地图，成员读取立即过滤）。
- `EaglePhotoMetadata`／`EaglePhotoLocation` 的 DELETE 只要旧行有 latitude 或 longitude，就提升 `visibilityVersion`，旧快照立即不可用。
- 更新分支保持原逻辑：仅隐私变化或已有坐标真的变化时立即失效；只改 `assetRevision` 仍只标脏。

## 验证

- `npm run test:photo-map` 使用真实临时 PostgreSQL 应用全部迁移并运行地图回归。
- 迁移只替换触发器函数，不重写业务数据。
- 2026-11-15 随 `review-fixes-82f8fa1a` 上线；生产迁移 90 已应用，触发器新分支已安装，四个应用容器 healthy。
