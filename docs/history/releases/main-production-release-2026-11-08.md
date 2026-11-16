# 2026年11月8日裁剪工作区预览修复生产发布

## 范围与版本

用户确认将本轮编辑器修复发布上线。运行源码固定为 `61be63b4766b4fe9b63b69d9312c23331f688fc1`，已推送 `origin/main`。

- Web：`sekereagle/web:crop-preview-61be63b4766b`（基于 `sekereagle/web:editor-fixes-318fcf4e47ec`，仅替换静态构建与 nginx 配置）
- API／operations／library-reader：保持 `sekereagle/api:editor-fixes-318fcf4e47ec`，未重建
- 数据库／MinIO／网关／协调器／中继／worker：容器身份未变；NAS worker 继续停止；Mac 业务执行器未变
- 数据库仍为 87 项迁移，未应用新迁移，未写入业务数据

本提交包含：裁剪、缩放与任意角度拉直改为 CSS 变换（不再逐帧重绘画布）、过期渲染帧丢弃、工具切换时画框与位图原子切换、遮罩改为四块矩形、裁剪面板高度、拉直角度钳制、换图时清空渲染键，以及文档和性能预算更新。

## 构建与验收

- 完整 `lint`、`prettier`、`typecheck`、web 测试（151 文件／1135 项）、web 构建、`architecture:check`、`test:architecture`、`oss:check` 通过。
- 本机以 final 生产 web 镜像为基座、`--platform linux/amd64` 构建；镜像 label revision 为 `61be63b4766b…`，镜像内 48 个静态文件与 `apps/web/dist` 逐文件 SHA256 一致。
- NAS 上复核镜像架构 amd64、revision label、48 个文件哈希；追加 `images.json` 后的 Compose 仅 web 的 `image`／`pull_policy` 差异，其余服务镜像与配置完全一致。
- 只重建 web 容器：healthy；其环境哈希、用户、工作目录、重启策略、挂载、网络、命令、健康检查、内存／CPU 限额与发布前一致；其余 9 个容器 ID 全部未变；迁移仍为 87。网关仅执行 `nginx -t` 与 reload 刷新上游解析。
- 公网 `https://yuntai.design:8181/` 200、`/api/health/ready` 200、匿名 `/api/eagle/assets` 401；服务端 `index.html` 与本机构建 SHA256 完全一致（`a5789388…`），`PhotoEditor-CE6BF_41.js` 服务端与本机构建 SHA256 完全一致（`aeac4a89…`，72,305 字节）。

## 数据安全与备份

- 本次只替换 web 静态资源与 nginx 配置，无数据库、对象存储、上传、后台任务或迁移路径变更，未新建备份；回退基准沿用 2026-11-07 已验证的 929,219,123 字节一致性备份（SHA-256 `d6adb615…`）。
- 未执行恢复、seed、重新导入或数据清理；未重启 API／operations／reader／postgres／MinIO／网关以外的任何服务；未修改用户策略、处理暂停／时段与资源数量。

## 回退

NAS 私有 `maintenance/crop-preview-20261108-61be63b4/` 保存发布前服务快照、原 Compose 链、`images.json`、`rollback.json`、镜像计划、镜像内容哈希和 `active.json`。回退时从 `maintenance/processing-upgrade-20261023/release-compose.json` 读取 `command`，在末尾追加 `-f maintenance/crop-preview-20261108-61be63b4/images.json -f maintenance/crop-preview-20261108-61be63b4/rollback.json`，执行 `--profile processing up -d --no-deps web`；不修改链文件。回退后重新执行 `nginx -t` 与 `nginx -s reload`。不自动恢复数据库；本次无需恢复数据。

## 限制

- 未做登录后的生产浏览器交互：本机没有生产账号凭据。已用构建产物逐字节一致、容器健康与公网匿名检查替代。
- Windows 客户端实机卡顿改善仍需用户更新网页后现场确认；颗粒／暗角开启时裁剪几何仍会按设计重算 Worker。
- 本机验证数据来自 macOS 开发页（50 次拉直输入 0 次画布绘制、0 次 Worker 消息），未在 Windows 硬件上测量。
