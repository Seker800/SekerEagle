# 安全策略

## 报告漏洞

请使用 GitHub 仓库的 **Security → Report a vulnerability** 私密报告功能。不要在
公开 Issue、Discussion、日志或截图中披露漏洞细节、用户素材、访问令牌、数据库连接串
或对象存储凭据。

报告请包含受影响版本、复现前提、最小复现步骤、影响判断以及可行的缓解方式。维护者会
尽快确认收到报告，但早期社区项目不承诺固定响应时限或漏洞奖励。

如果仓库尚未启用 private vulnerability reporting，请仅提交一个不含漏洞细节的公开
Issue，请维护者提供私密联系渠道。

## 支持版本

安全修复只保证进入最新发布版本和默认分支。`0.x` 阶段不维护长期支持分支。

## 部署边界

- 默认 Compose 仅支持 loopback gateway，不是可直接暴露到互联网的托管方案。
- 公网部署必须自行提供 TLS、可信反向代理、访问控制、备份与监控。
- 不要映射 PostgreSQL、MinIO、API 或 MLX sidecar 的内部端口。
- `.env`、PAT、bootstrap 密码和 bearer token 不得提交、粘贴到 Issue 或写入日志。
- PAT 应使用满足用途的最小 scope；不再使用时立即撤销。
- 导入、migration、seed 和测试前必须通过安全目标检查。

## 发布安全

公开发布前运行 `npm run oss:check`、完整 CI、依赖漏洞扫描和覆盖全部 Git refs 的
Gitleaks/TruffleHog 扫描。发现已经提交的真实密钥时，应先轮换或撤销密钥，再清理历史；
仅删除当前文件不能使已公开密钥恢复安全。
