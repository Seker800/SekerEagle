# 旧 API 后台宿主兼容夹具

两个 `.source` 文件逐字来自提交 `89acbe96a1d9f39cd398a2dde3e239684b4f685b` 的同名 API provider，SHA256 固定在 manifest。它们保留旧 API 的真实 Nest 启停定时器、恢复逻辑及维护 SQL，专供隔离数据库的升级重叠验收。测试编译时只重定位模块依赖，不改方法体，不伪装成当前类；不依赖 CI 的 Git 历史深度。

这不是生产备用实现，不得装配到 API 或 operations。测试始终关闭旧定时器、排空新宿主并删除临时编译文件。所覆盖的是旧 API provider 生命周期与新 operations 宿主同时发现同一持久事实，不替代发布时完整镜像启动验收。
