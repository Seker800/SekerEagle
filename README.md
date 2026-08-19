# SekerEagle

SekerEagle 是一个独立、自托管、多用户隔离的个人素材库。它使用 NestJS、
React、PostgreSQL、MinIO 和可重试 worker 管理图片、视频、标签、Eagle 导入与
浏览器采集；可选的 Apple Silicon MLX sidecar 提供本地多模态向量和人工标签建议。

> SekerEagle 是独立社区项目，不是 Eagle 官方产品，也不受 Eagle 团队赞助或背书。
> “Eagle”仅用于描述兼容与导入来源。

## 当前状态

项目处于早期公开阶段（`0.1.x`）。核心图库、认证/PAT、上传、媒体派生、批量导入、
浏览器采集、隐私素材可见窗口和向量建议已经实现；API 和数据模型仍可能在次版本中
变化。生产数据升级前请先备份。

## 平台与依赖

- macOS 与 Apple Silicon 是当前完整支持平台。
- Node.js 22、npm 10、Docker Desktop、至少 16 GiB Docker 内存和 8 CPU。
- 向量功能需要 `uv`，并会下载固定 revision 的 Qwen3-VL-Embedding-2B 模型。
- PostgreSQL、MinIO、API 和 worker 只运行在 SekerEagle 自己的网络与数据卷中。

Linux/x64 尚未作为完整产品路径验证。非向量 TypeScript 组件可能可以运行，但不属于
当前支持矩阵。

## 快速开始

```sh
npm ci
npm run db:generate
npm run env:create
./scripts/mlx-embedding-host.sh setup
npm run mlx:install-service
npm run compose:config
docker compose --env-file .env -f deploy/mac/docker-compose.yml up -d --build
```

创建首个管理员：

```sh
docker compose --env-file .env -f deploy/mac/docker-compose.yml exec \
  -e BOOTSTRAP_ADMIN_EMAIL=you@example.com \
  -e BOOTSTRAP_ADMIN_PASSWORD='replace-with-a-long-password' \
  api node apps/api/dist/bootstrap-admin.js
```

然后打开 <http://localhost:8180>。只有 gateway 应绑定宿主机端口；不要直接暴露
PostgreSQL、MinIO 或 API。完整步骤、诊断和停止方式见
[`docs/operations-runbook.md`](docs/operations-runbook.md)。

## 开发与验证

```sh
npm ci
npm run db:generate
npm run ci:check
./scripts/mlx-embedding-host.sh test
npm run oss:check
```

数据库 migration、seed、测试和导入必须先经过安全目标检查。开发数据库只能是
`sekereagle` 或 `sekereagle_test`，对象存储 bucket 必须使用 `sekereagle-` 前缀。

## 架构与安全边界

- ownerId 只能从认证主体推导，请求 DTO 不接受 ownerId。
- 跨 owner 访问统一返回 404。
- PostgreSQL 是业务事实源；对象存储和 worker 通过可恢复状态机收敛。
- 浏览器使用 HttpOnly Cookie，插件使用最小 scope PAT。
- 项目不依赖或访问 SekerChat 的运行时和数据面。

更多信息见 [`docs/architecture.md`](docs/architecture.md)、
[`docs/environment-model.md`](docs/environment-model.md) 和
[`SECURITY.md`](SECURITY.md)。

## 隐私

默认部署完全本地运行，不包含遥测。素材、页面来源和标签保存在操作者自己的
PostgreSQL/MinIO 中；模型也在本机执行。浏览器插件的数据边界和管理员责任见
[`PRIVACY.md`](PRIVACY.md)。

## 贡献与支持

提交前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md) 和
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。普通问题使用 GitHub Issues；安全漏洞
不要公开提交，见 [`SECURITY.md`](SECURITY.md)。支持范围见 [`SUPPORT.md`](SUPPORT.md)。

## 许可证

除 `services/mlx-embedding` 外，本仓库代码按 Apache-2.0 发布，见 [`LICENSE`](LICENSE)。
由于直接使用 GPLv3 的 `mlx-embeddings`，`services/mlx-embedding` 单独按
GPL-3.0-only 发布，见 [`services/mlx-embedding/LICENSE`](services/mlx-embedding/LICENSE)。
第三方组件与模型说明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
