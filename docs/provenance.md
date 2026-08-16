# 代码来源

独立仓库以 SekerChat 提交 `4361257a854232494f6279487e06a8e858f76ba0` 为行为参考，采用干净复制并重新划定边界，没有改写原仓库历史。

第一轮只建立独立运行骨架、认证、空数据库模型、对象存储适配器和 contracts。Eagle 业务 API、worker 处理逻辑、前端素材页和 importer 将在后续阶段逐域迁入，并以 `docs/extraction-inventory.json` 记录范围。

新 baseline migration 从空数据库生成，不复制 SekerChat 的历史 migration。新仓库没有连接、读取或写入群晖数据面。
