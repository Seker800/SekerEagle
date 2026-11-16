# 2026年11月7日编辑器修复生产发布

## 范围与版本

用户要求将本轮 issue 修复推送到生产，且不得破坏数据库和图库。运行源码固定为 `318fcf4e47ec7cf7bb0a887965c8ee7cced452c3`，已推送 `origin/main`。

- API／operations／library-reader：`sekereagle/api:editor-fixes-318fcf4e47ec`
- Web：`sekereagle/web:editor-fixes-318fcf4e47ec`
- Mac 唯一业务执行器：`.runtime/business-worker/releases/worker-318fcf4e47ec`，仅替换 `library-core`／`photo-render-core` 共享包，worker 源码与原生依赖未变
- NAS worker 继续停止，未拉起；数据库、MinIO、网关、协调器、中继容器身份未变

包含 #95 拖出超时、#107 星标反馈与失败提示、#94 编辑器关闭位置、#93 任意角度拉直及暗角／镜像映射、草稿对旧客户端兼容；#108 仅加强回归，未宣称原图复现已完成。

## 构建与验收

- 完整 `npm run lint`、`typecheck`、`test`、`build`、`architecture:check`、`format:check` 通过。
- 最终 API 镜像执行 `npm run test:api-image -- sekereagle/api:editor-fixes-318fcf4e47ec`：镜像内 87 项迁移、独立启动、readiness 200、匿名 401、独立执行器无 API 权限并正常退出。
- NAS 侧重新构建同源镜像，`release.py images` 校验：amd64、revision 标签、运行文件 SHA、86 项既有迁移 checksum 全部一致，唯一待应用迁移为 `20261103130000_hot_table_autovacuum_tuning`；追加镜像覆盖后的 Compose 仅 image／pull_policy 差异。
- 切换后 api／operations／library-reader／web 四服务 healthy；公网首页 200、readiness 200、匿名 assets 401；生产首页与本地 `apps/web/dist/index.html` SHA256 完全一致，主 JS 含「拉直」「保存失败，请重试」。
- Mac worker 新进程 PID43367、worker ID `worker-b9f648ad-5dc9-4069-9ec1-204900d9bd89`，生产数据库心跳新鲜。

## 数据安全与迁移

- 发布前一致性 PostgreSQL 备份 `database-before.dump`，929,219,123 字节，SHA-256 `d6adb615016f17bd650eb0c1831041b561301862ebaa087080908c0011f76de3`，已用 `pg_restore --list` 完整解析；没有在现用库执行恢复、seed 或重导入。
- 唯一迁移只修改 `EagleAsset`、`EagleMediaJob` 的 autovacuum 参数，不重写业务数据；应用后 `reloptions` 与迁移一致，`EagleUploadSessionState_retired_cleanup_idx` 仍为 valid。
- 发布前后用户处理设置、暂停／时段逐项一致；活跃资源 MATERIAL 64,835、PHOTO 58,109（合计 122,944），回收站 11,872，编辑草稿 81，均未变化。
- 未重建或恢复 PostgreSQL／MinIO 卷，未重写原片或派生对象，未修改网关配置，仅 `nginx -t` 后 reload。

## 回退

NAS 私有 `maintenance/editor-fixes-20261107-318fcf4e/` 保存原 Compose 链、四服务原镜像 `idle-io-63958ed0b81a`／`editor-cors-c2129902b9dc`、数据库备份、镜像与迁移日志、`images.json`、`rollback.json`、`active.json`。应用回退只替换回原镜像并保留 87 项已应用迁移；不自动恢复备份。Mac worker 回退使用 `worker-51f8bc804222`，先正常停止新进程再切回原 release。

## 限制

- 未做登录后的生产浏览器／桌面交互验收：本机没有生产账号凭据；已用固定测试图库的真实浏览器验收和最终镜像／公网健康检查替代。
- #108 未用 issue 原图复现，只用合成颗粒提取回归验证当前阈值。
- 桌面 Electron 拖出桥仍只有单测覆盖，未做 OS 拖放人工验收。
