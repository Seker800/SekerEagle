# 2026年11月14日保存进度与大图预览标识生产发布

## 范围与版本

用户确认发布上线。运行源码固定为 `62b6df15c4800586fd2e8b3a0460b4dfbc09d7b1`，已推送 `origin/main`。

- Web：`sekereagle/web:ui-feedback-62b6df15c480`（基于 `sekereagle/web:raw-edit-ecc32873d5c4`，仅替换静态构建与 nginx 配置）
- API／operations／library-reader：保持 `sekereagle/api:editor-fixes-318fcf4e47ec`，未重建
- Mac 唯一业务执行器：保持 `worker-ecc32873d5c4`，未重启（本批仅 web 改动）
- NAS worker 继续停止；数据库、MinIO、网关、协调器、中继未改变

本批包含：

- 保存成片显示确定进度条：读取原图／提交任务／按原图生成／准备预览／上传，并显示已用秒数；上传阶段使用上传接口返回的真实百分比。
- 大图查看器对所有低于原图像素的预览显示「预览图 · 高清未就绪」；有金字塔时显示「正在加载高清细节… 已加载/所需瓦片」和确定进度条，加载完成自动替换。
- 打开大图时每 15 秒检查缺失的高清金字塔，就绪后自动升级，不需要手动刷新。

## 构建与验收

- web 测试 151 文件／1140 项、lint、typecheck、build、格式检查通过；本批没有 API 镜像变更，未执行 `test:api-image`。
- Web 镜像以 `raw-edit-ecc32873d5c4` 为基座、`--platform linux/amd64` 构建；revision label 为 `62b6df15…`，48 个静态文件与本机 `apps/web/dist` 逐文件 SHA256 一致；加载到 NAS 后再次验证架构、label 与内容。
- NAS `release-web.py prepare/images/activate` 通过：追加镜像覆盖后的 Compose 仅 web 的 `image`／`pull_policy` 差异；只重建 web，环境、挂载、命令、健康检查和资源限额与发布前一致；其余 9 个容器 ID 未变；迁移仍 87。
- 公网 `https://yuntai.design:8181/` 200、`/api/health/ready` 200、匿名 `/api/eagle/assets` 401；服务端 `index.html` SHA256 `20b2341675dda745ec758535077fee344c9190c0d662d06829b2f9d843affbbb`、`PhotoEditor-1dCHeuxj.js` SHA256 `d0a40d62f888ce2550d774fd63ad0d760079eb0acaceea48371b48d7db009f64`（73,439 字节），均与本机构建一致；构建产物包含「预览图 · 高清未就绪」「正在加载高清细节」「正在提交成片任务」「正在按原图生成成片」。
- Mac worker 保持 `worker-fab1d68c-add4-433c-88b1-6a4dd9b98249`，发布时心跳新鲜。
- 核验快照：MATERIAL 64,855、PHOTO 58,138、回收站 11,912、编辑草稿 95。相对上一快照的 PHOTO +6、草稿 +11 来自用户操作，不是本次 web 切换写入；发布本身没有数据库写入或迁移。

## 数据安全与备份

- 本次无数据库、对象存储、上传、后台任务或迁移路径变更，未新建备份；回退基准沿用 2026-11-07 已验证的 929,219,123 字节一致性备份（SHA-256 `d6adb615016f17bd650eb0c1831041b561301862ebaa087080908c0011f76de3`）。
- 未执行恢复、seed、重新导入或数据清理；未重启 API／operations／reader／postgres／MinIO／网关／Mac worker；未修改用户策略、处理暂停／时段与资源数量。

## 回退

- NAS 私有 `maintenance/ui-feedback-62b6df15c480/` 保存发布前服务快照、原 Compose 链、`images.json`、`rollback.json`、`image-plan.json`、`content-hashes.json` 和 `active.json`。回退时在完整 Compose 链后追加该目录 `rollback.json`，执行 `--profile processing up -d --no-deps web`，再执行 `nginx -t` 与 `nginx -s reload`；不修改链文件。
- 不涉及 worker 回退；worker 仍为 `worker-ecc32873d5c4`。不自动恢复数据库；本次无需恢复数据。

## 限制

- 未做登录后的生产浏览器／桌面交互：本机没有生产账号凭据；已用构建产物逐字节一致、容器健康与公网匿名检查替代。Windows 实机需要刷新后确认进度条与预览标识的实际观感。
- 保存的服务端渲染阶段没有字节级百分比，进度条按真实阶段推进；上传阶段才是接口返回的百分比。
- 预览瓦片进度按当前显示尺寸对应的金字塔层级统计已加载/所需瓦片；缩放或平移后所需瓦片会变化。
- 32,985 张应有大图高清的素材仍没有 READY 金字塔；本次只把预览标识和进度显示改对，这些图仍会显示 1600 预览并标记「高清未就绪」，生成金字塔属于后续工作。
