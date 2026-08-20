# Environment Model

## Local development

- 本机代码可以裸跑。
- PostgreSQL 与 MinIO 使用 SekerEagle 自己的 Docker compose。
- 开发数据库固定为 `sekereagle`，测试数据库固定为 `sekereagle_test`。
- 所有数据脚本必须先通过 `scripts/assert-safe-target.mjs`。

## Mac runtime

- 目标架构：`linux/arm64`。
- gateway 默认绑定 `127.0.0.1:8180`；可信局域网部署可用独立 Compose 叠加文件增加单个固定内网 IP，同时保留 loopback，禁止使用 `0.0.0.0` 泛化暴露。
- API、PostgreSQL、MinIO 仅位于 compose 内部网络。
- compose project name：`sekereagle`。

## Forbidden targets

- SekerChat PostgreSQL 或 MinIO。
- `192.168.31.89`。
- 数据库名包含 `sekerchat`。
- 不以 `sekereagle-` 开头的 bucket。
