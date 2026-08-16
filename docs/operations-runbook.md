# 本机运行手册

## 首次启动

1. 运行 `npm run env:create` 生成权限为 `0600` 的 `.env` 和随机独立密钥；不要提交 `.env`。命令发现已有 `.env` 时会拒绝覆盖。
2. 确认 Docker Desktop 至少分配 16 GiB 内存和 8 CPU。
3. 运行 `npm run compose:config` 检查编排，再运行 `docker compose --env-file .env -f deploy/mac/docker-compose.yml up -d --build`。
4. 只有 `127.0.0.1:8180` 应暴露到宿主机。PostgreSQL、MinIO、API 和 web 不应有宿主端口。
5. 用一次性环境变量在 API 容器内创建首个管理员：

   ```sh
   docker compose --env-file .env -f deploy/mac/docker-compose.yml exec \
     -e BOOTSTRAP_ADMIN_USERNAME=你的用户名 \
     -e BOOTSTRAP_ADMIN_PASSWORD=至少十二位的密码 \
     api node apps/api/dist/bootstrap-admin.js
   ```

6. 打开 `http://localhost:8180` 登录。

也可以先运行 `npm run bootstrap-credentials:create` 生成本机私有的 `.local/bootstrap.env`。首次登录并修改密码后应删除该文件。

## 安全检查

- 数据库 migration 前必须经过 `npm run db:guard`。
- 任何目标包含 `192.168.31.89`、数据库名包含 `sekerchat` 或 bucket 不以 `sekereagle-` 开头时，程序会拒绝启动。
- 不要把本仓库 `.env` 指向 SekerChat 或群晖。
- 本轮不包含旧数据清理或用户备份导入。

## 停止

`docker compose --env-file .env -f deploy/mac/docker-compose.yml down` 只停止容器，不删除 volume。不要加 `-v`，除非明确决定删除新 SekerEagle 数据。
