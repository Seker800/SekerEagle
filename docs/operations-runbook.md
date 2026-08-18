# 本机运行手册

## 首次启动

1. 运行 `npm run env:create` 生成权限为 `0600` 的 `.env` 和随机独立密钥；不要提交 `.env`。命令发现已有 `.env` 时会拒绝覆盖。
2. 确认 Docker Desktop 至少分配 16 GiB 内存和 8 CPU。
3. 运行 `npm run env:ensure-vector` 补齐独立的 MLX 本机 token，再运行 `npm run mlx:install-service`。`launchd` 会在登录后启动 Qwen3-VL Embedding 宿主服务并在崩溃后恢复。
4. 用带认证的 `http://127.0.0.1:11435/health/ready` 检查固定模型 revision、1024 维和 `metal: true`。宿主服务虽为 Docker Desktop 绑定 `0.0.0.0`，但只接受独立随机 bearer token、受限字节和固定输入类型；不接受 URL 或文件路径。
5. 运行 `npm run compose:config` 检查编排，再运行 `docker compose --env-file .env -f deploy/mac/docker-compose.yml up -d --build`。
6. 只有 `127.0.0.1:8180` 应暴露到宿主机。PostgreSQL、MinIO、API 和 web 不应有宿主端口。
7. 用一次性环境变量在 API 容器内创建首个管理员：

   ```sh
   docker compose --env-file .env -f deploy/mac/docker-compose.yml exec \
     -e BOOTSTRAP_ADMIN_EMAIL=你的邮箱 \
     -e BOOTSTRAP_ADMIN_PASSWORD=至少十二位的密码 \
     api node apps/api/dist/bootstrap-admin.js
   ```

8. 打开 `http://localhost:8180` 登录。

也可以先运行 `npm run bootstrap-credentials:create` 生成本机私有的 `.local/bootstrap.env`。首次登录并修改密码后应删除该文件。

从早期用户名版本升级时，数据库中唯一的旧管理员可以直接在新登录页输入希望绑定的邮箱和原密码。只有原密码验证成功后才会写入邮箱，并同时吊销旧 refresh token 与 PAT；普通用户和多个旧管理员不会自动绑定。

## 安全检查

- 数据库 migration 前必须经过 `npm run db:guard`。
- 任何目标包含 `192.168.31.89`、数据库名包含 `sekerchat` 或 bucket 不以 `sekereagle-` 开头时，程序会拒绝启动。
- 不要把本仓库 `.env` 指向 SekerChat 或群晖。
- 本轮不包含旧数据清理或用户备份导入。

## 停止

`docker compose --env-file .env -f deploy/mac/docker-compose.yml down` 只停止容器，不删除 volume。不要加 `-v`，除非明确决定删除新 SekerEagle 数据。

## 图片向量与人工标签建议

- 入口固定在“素材处理”。标签默认全部关闭；只有用户显式开启并点击“生成中心”后才参与人工标签建议。
- “扫描缺失向量”每次最多扫描 500 张尚无当前处理任务的图片，可重复执行；图片导入和普通图库不会等待 MLX。
- 处理时段、暂停和恢复继续使用素材处理的系统级队列设置。新导入的交互式预览优先于向量历史回填。
- 标签中心刷新采用旁路代际。构建失败时继续使用旧中心；关闭标签会使其未审核建议失效，但不会删除中心、人工标签或审核历史。
- 当前宿主日志在 `.runtime/mlx-embedding.log` 和 `.runtime/mlx-embedding.error.log`；不得记录 bearer token、图片内容或向量。

常用诊断：

```sh
launchctl print gui/$(id -u)/com.sekereagle.mlx-embedding
docker compose --env-file .env -f deploy/mac/docker-compose.yml ps
curl -fsS http://127.0.0.1:8180/api/health/ready
```

模型升级不得覆盖 current 空间。应固定新 revision 和新的 space id，旁路回填、通过真实人工标签黄金集后再切换；旧空间延迟清理。PostgreSQL 备份必须包含 `vector` extension、embedding、prototype、member distance、suggestion 与 provenance 表；恢复后先部署 migration，再恢复数据并重建 HNSW 索引。
