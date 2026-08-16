# ADR 0001: 独立运行时与空库重导

- 状态：Accepted
- 日期：2026-08-16

## Decision

SekerEagle 使用独立仓库、认证、PostgreSQL、MinIO 和 secrets。新实例从空库开始，通过用户自己的 Eagle library/backup 重新导入，不迁移或清理 SekerChat 数据。

## Consequences

- SekerChat 保持零改动并可继续运行旧 Eagle。
- 新系统必须提供多用户 owner 隔离和独立 PAT。
- 未来停用旧 Eagle 是单独任务，不属于当前拆分。
