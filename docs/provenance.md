# 代码来源与发布边界

SekerEagle 最初以 SekerChat 提交 `4361257a854232494f6279487e06a8e858f76ba0`
为行为参考，通过干净复制建立独立仓库并重新划定领域、认证、数据库和对象存储边界。
SekerChat 的 Git 历史、migration、运行时配置、数据、Cookie 和 secrets 均未迁入本仓库。

此后 SekerEagle 在自己的提交历史中独立演进。新 baseline migration 从空数据库生成，
运行时只接受 SekerEagle 专用数据库与 bucket；源码中的隔离断言用于阻止意外连接旧系统。
`docs/extraction-inventory.json` 保留初始抽取范围，作为安全审计与历史说明，不是运行时配置。

公开发布负责人必须确认自己有权按本仓库许可证发布来自 SekerChat 的相关实现以及 Logo、
图标等资产。第三方依赖、模型和二进制不因位于本仓库而改变其原许可证，详见
`THIRD_PARTY_NOTICES.md`。

除 `services/mlx-embedding` 外，SekerEagle 原创代码按 Apache-2.0 发布。
`services/mlx-embedding` 直接导入 GPLv3 依赖，单独按 GPL-3.0-only 发布。两个组件通过
受认证的 HTTP 边界通信，不共享进程或链接产物。
