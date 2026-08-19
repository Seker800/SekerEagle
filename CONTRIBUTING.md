# 贡献指南

感谢你帮助改进 SekerEagle。提交代码即表示你有权按相应目录的许可证提供贡献：默认是
Apache-2.0，`services/mlx-embedding` 是 GPL-3.0-only。

## 开始之前

1. 对较大的功能先创建 Issue，说明用户问题、边界、迁移与安全影响。
2. 阅读 `AGENTS.md`、`docs/architecture.md` 和相关 ADR。
3. 不要提交用户素材、真实 Eagle 图库、`.env`、数据库 dump、token 或私有网络信息。
4. 保持 SekerEagle 与 SekerChat 的运行时和数据面完全隔离。

## 开发要求

- 使用 Node.js 22 和 npm workspaces。
- ownerId 必须从认证主体推导；跨 owner 访问返回 404。
- 认证、上传、对象存储或 API 改动必须包含安全测试。
- schema 和 migration 必须同时提交，不允许跳过安全目标检查。
- 优先保持领域规则、应用服务和基础设施适配器之间的单向依赖。

提交 Pull Request 前运行：

```sh
npm ci
npm run db:generate
npm run ci:check
npm run oss:check
```

修改 MLX sidecar 时还应运行：

```sh
./scripts/mlx-embedding-host.sh test
```

## Commit 与 Pull Request

项目提交类型使用中文：`新增`、`修复`、`重构`、`清理`、`文档`。PR 应说明行为变化、
验证证据、数据库/安全影响以及回滚方式。生成文件和 lockfile 必须与源声明保持一致。

贡献采用 Developer Certificate of Origin 方式。请在 commit 中使用 `git commit -s` 添加
`Signed-off-by`，表示你有权提交该贡献并允许项目按对应许可证分发。
