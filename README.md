# SekerEagle

独立、多用户隔离的个人素材库。当前仓库从 SekerChat 的 Eagle 领域边界抽取，但运行时、认证、数据库和对象存储完全独立。

## 当前里程碑

阶段 0-3：独立仓库、认证/PAT、空 Prisma schema、PostgreSQL/MinIO 和 contracts 骨架。

## 安全边界

任何数据库、迁移、测试和导入命令都会先检查目标。以下目标会被拒绝：

- `192.168.31.89`
- 数据库名包含 `sekerchat`
- 非 `sekereagle` / `sekereagle_test` 数据库
- 非 `sekereagle-*` bucket

## 本机入口

最终 Mac compose 只暴露 `http://localhost:8180`。PostgreSQL、MinIO 和 API 不直接映射宿主端口。

详细边界见 `docs/architecture.md` 和 `docs/environment-model.md`。
