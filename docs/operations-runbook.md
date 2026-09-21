# 本机运行手册

## 首次启动

1. 运行 `npm run env:create` 生成权限为 `0600` 的 `.env` 和随机独立密钥；不要提交 `.env`。命令发现已有 `.env` 时会拒绝覆盖。
2. 确认 Docker Desktop 至少分配 16 GiB 内存和 8 CPU。
3. 运行 `npm run env:ensure-vector` 补齐独立的 MLX 本机 token，再运行 `npm run mlx:install-service`。`launchd` 会在登录后启动 Qwen3-VL Embedding 宿主服务并在崩溃后恢复。
4. 用带认证的 `http://127.0.0.1:11435/health/ready` 检查固定模型 revision、1024 维和 `metal: true`。宿主服务虽为 Docker Desktop 绑定 `0.0.0.0`，但只接受独立随机 bearer token、受限字节和固定输入类型；不接受 URL 或文件路径。
5. 运行 `npm run deploy:mac:check` 检查实际部署配置，再运行 `npm run deploy:mac`。该入口会根据 `.env` 自动决定是否叠加 LAN Compose 文件，并在更新后验证 gateway 端口和健康状态。
6. 默认只有 `127.0.0.1:8180` 暴露到宿主机。可信局域网访问可按下节绑定单个内网 IP；PostgreSQL、MinIO、API 和 web 不应有宿主端口。
7. 用一次性环境变量在 API 容器内创建首个管理员：

   ```sh
   docker compose --env-file .env -f deploy/mac/docker-compose.yml exec \
     -e BOOTSTRAP_ADMIN_EMAIL=你的邮箱 \
     -e BOOTSTRAP_ADMIN_PASSWORD=至少十二位的密码 \
     api node apps/api/dist/bootstrap-admin.js
   ```

8. 打开 `http://localhost:8180` 登录。

自动名词标签是独立的可选能力。需要时先安装 Ollama，执行
`ollama pull qwen3-vl:8b-instruct`，并确保容器可通过 `.env` 中的 `OLLAMA_URL` 访问它。
Ollama API 没有应用层认证：不得把 11434 暴露到公网；如果 Docker Desktop 要求它监听
非 loopback 地址，必须使用主机防火墙将访问限制在本机 Docker 后端。自动标签的手动和
定时开关默认均关闭。

也可以先运行 `npm run bootstrap-credentials:create` 生成本机私有的 `.local/bootstrap.env`。首次登录并修改密码后应删除该文件。

## 局域网 HTTP

需要让另一台可信局域网电脑直接访问时，先为服务器设置固定 DHCP 租约，然后把 `.env` 中的
gateway 绑定地址改为该内网 IP，例如：

```dotenv
SEKEREAGLE_GATEWAY_LAN_ADDRESS=192.168.1.10
```

先确认预检识别为 `local + LAN`，再通过唯一部署入口更新并自动验证：

```sh
npm run deploy:mac:check
npm run deploy:mac
```

不要直接执行只带 `docker-compose.yml` 的 `docker compose up` 来更新这台 LAN 部署。基础文件有意只发布
`127.0.0.1:8180`；漏掉叠加文件会造成“Mac 本机正常、其他电脑无法访问”。标准入口会在
`SEKEREAGLE_GATEWAY_LAN_ADDRESS` 非空时自动加入 `docker-compose.lan.yml`，拒绝非私网地址或
不属于当前 Mac 的旧地址，并在结束前同时检查 `127.0.0.1:8180`、LAN IP 端口和健康接口。

### 日常代码更新与 Docker 发布

代码推送到 Git 仓库不会自动更新本机容器。拉取或完成代码变更后，统一执行：

```sh
git status --short
npm run deploy:mac:check
npm run deploy:mac
```

成功标准是命令最后输出 `Deployment verified`，并且其中同时列出 loopback 与配置的 LAN 健康地址。
若预检显示 `local only`，但这台服务应供局域网使用，应先修正 `.env`，不要继续发布。脚本不会输出
`.env` 中的密码或令牌。发布失败时保留原始报错进行诊断，不要改 Clash、TUN、路由器或防火墙，
除非已经证明 gateway 的两个绑定与本机/LAN 健康检查均正常。

LAN 地址只控制 gateway 的宿主机绑定，不再同时充当 API 白名单。网页登录和所有受 CSRF
来源保护的写操作会动态要求浏览器来源与当前私网 gateway 的协议、主机和端口完全一致；
更换私网 IP 后只需更新绑定并重建入口，无需登记登录来源。其他私网主机、协议或端口不匹配的
请求仍会 fail closed，公网来源继续要求显式配置。网页拖拽上传的预签名对象请求也会经由当前
内网 gateway，而不会访问客户端电脑自身的 `localhost`。Chrome 采集扩展选择“仅使用内网”，
内网地址填写 `http://192.168.1.10:8180`，并勾选
“允许内网 HTTP”。不要使用 `0.0.0.0`；通过 macOS 防火墙只允许可信设备访问 8180。
局域网 HTTP 会明文传输登录信息、PAT 和图片，不适合不可信 Wi-Fi；这种环境应使用 HTTPS。
浏览器不会向局域网 HTTP 页面开放脚本图片剪贴板；此时网页端的“打开可复制预览”会展示真实
PREVIEW 图片，可继续使用浏览器原生右键“复制图片”。HTTPS、localhost 和桌面端仍使用一键复制。

## 公网来源

公网入口应优先使用 HTTPS，并把精确 origin（包含非标准端口）写入
`SEKEREAGLE_PUBLIC_ORIGIN`。只有在公网 HTTPS 暂时无法部署且明确接受登录信息、Cookie 与图片
明文传输风险时，才能额外开启危险兼容开关：

```dotenv
SEKEREAGLE_PUBLIC_ORIGIN=http://yuntai.design:8180
SEKEREAGLE_ALLOW_INSECURE_PUBLIC_HTTP=true
```

该开关只允许配置的精确 origin，不接受通配符、路径、URL 凭据或隐式来源推断；默认值为
`false`。修改后必须重建 API。长期运行应在非标准端口上部署 HTTPS（证书可通过 DNS-01
签发），随后把公网 origin 改为 `https://...:端口` 并关闭危险开关。

从早期用户名版本升级时，数据库中唯一的旧管理员可以直接在新登录页输入希望绑定的邮箱和原密码。只有原密码验证成功后才会写入邮箱，并同时吊销旧 refresh token 与 PAT；普通用户和多个旧管理员不会自动绑定。

## 安全检查

- 数据库 migration 前必须经过 `npm run db:guard`。
- 任何目标包含 `192.168.31.89`、数据库名包含 `sekerchat` 或 bucket 不以 `sekereagle-` 开头时，程序会拒绝启动。
- 不要把本仓库 `.env` 指向 SekerChat 或群晖。
- 本轮不包含旧数据清理或用户备份导入。

## 停止

`docker compose --env-file .env -f deploy/mac/docker-compose.yml down` 只停止容器，不删除 volume。不要加 `-v`，除非明确决定删除新 SekerEagle 数据。

## 图片向量与人工标签建议

- 图片向量运行状态和队列控制位于“待处理 → 处理任务”；参与推荐标签及向量中心配置位于“设置 → 人工标签推荐”；建议审核和遗漏分类分别位于“待处理 → 推荐审核 / 待分类”。标签默认全部关闭；只有用户显式开启并点击“生成中心”后才参与人工标签建议。
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
