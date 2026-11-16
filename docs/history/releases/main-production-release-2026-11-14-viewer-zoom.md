# 2026年11月14日 XPan、默认水印与查看器放大加载生产发布

## 范围与版本

用户确认发布上线。运行源码固定为 `7879fd865b90948bcecdf4e5ff5ecac713f5ff77`，已推送 `origin/main`。

- Web：`sekereagle/web:viewer-zoom-7879fd865b90`（基于 `sekereagle/web:ui-feedback-62b6df15c480`，仅替换静态构建与 nginx 配置）
- API／operations／library-reader：保持 `sekereagle/api:editor-fixes-318fcf4e47ec`，未重建
- Mac 唯一业务执行器：保持 `worker-ecc32873d5c4`，未重启（本批仅 web 改动）
- NAS worker 继续停止；数据库、MinIO、网关、协调器、中继未改变

本批包含：

- 裁切比例新增 XPan 65:24／24:65，支持横竖切换；编辑参数校验、服务端成片和批量套用接受该比例。
- 新编辑会话默认选择「摄影信息条」和「毛玻璃底」；已有草稿、已保存成片和用户显式选择保留原值。
- 查看器默认只加载最长边 1600 的预览，不再在打开时拉取金字塔或原图；用户放大超过适屏后才加载高清。大图有金字塔时加载金字塔瓦片，没有金字塔的 JPG／PNG／WebP 按需读原图，RAW 读当前显影副本。
- 高清瓦片进度按实际加载层级计数；0 进度不显示数字和进度条；高清瞬间完成时不再残留 0/60。

## 构建与验收

- web 测试 151 文件／1143 项、library-core 65 项、lint、typecheck、build、格式检查通过；本批没有 API 镜像变更，未执行 `test:api-image`。
- Web 镜像以 `ui-feedback-62b6df15c480` 为基座、`--platform linux/amd64` 构建；revision label 为 `7879fd86…`，48 个静态文件与本机 `apps/web/dist` 逐文件 SHA256 一致；加载到 NAS 后再次验证架构、label 与内容。
- NAS `release-web.py prepare/images/activate` 通过：追加镜像覆盖后的 Compose 仅 web 的 `image`／`pull_policy` 差异；只重建 web，环境、挂载、命令、健康检查和资源限额与发布前一致；其余 9 个容器 ID 未变；迁移仍 87。
- 公网 `https://yuntai.design:8181/` 200、`/api/health/ready` 200、匿名 `/api/eagle/assets` 401；服务端 `index.html` SHA256 `67fa4d31bf3598ce9f853c8c8da871f2e6a16620939147e5b47223ce19cad1cf`、`PhotoEditor-BMc_0q8b.js` SHA256 `1fbf572862eb3f6221734db3706bf5e0e4c5bbe08aef2663bf4cb0721eba2678`（73,492 字节），均与本机构建一致；构建产物包含「预览图 · 放大加载高清」「正在加载高清细节」「XPan」「摄影信息条」。
- Mac worker 保持 `worker-fab1d68c-add4-433c-88b1-6a4dd9b98249`，发布时心跳新鲜。
- 核验快照：MATERIAL 64,855、PHOTO 58,141、回收站 11,912、编辑草稿 102。相对上一快照的 PHOTO +3、草稿 +7 来自用户操作，不是本次 web 切换写入；发布本身没有数据库写入或迁移。

## 数据安全与备份

- 本次无数据库、对象存储、上传、后台任务或迁移路径变更，未新建备份；回退基准沿用 2026-11-07 已验证的 929,219,123 字节一致性备份（SHA-256 `d6adb615016f17bd650eb0c1831041b561301862ebaa087080908c0011f76de3`）。
- 未执行恢复、seed、重新导入或数据清理；未重启 API／operations／reader／postgres／MinIO／网关／Mac worker；未修改用户策略、处理暂停／时段与资源数量。

## 回退

- NAS 私有 `maintenance/viewer-zoom-7879fd865b90/` 保存发布前服务快照、原 Compose 链、`images.json`、`rollback.json`、`image-plan.json`、`content-hashes.json` 和 `active.json`。回退时在完整 Compose 链后追加该目录 `rollback.json`，执行 `--profile processing up -d --no-deps web`，再执行 `nginx -t` 与 `nginx -s reload`；不修改链文件。
- 不涉及 worker 回退；worker 仍为 `worker-ecc32873d5c4`。不自动恢复数据库；本次无需恢复数据。

## 限制

- 未做登录后的生产浏览器／桌面交互：本机没有生产账号凭据；已用构建产物逐字节一致、容器健康与公网匿名检查替代。Windows 实机需要刷新后确认查看器放大行为、XPan 卡片和默认水印的实际观感。
- 大图放大使用金字塔瓦片，不整份下载原图；只有没有金字塔的浏览器原生格式才按需读原图。
- 32,985 张应有大图高清的素材仍没有 READY 金字塔；本次没有补生成，它们初次显示 1600，放大时按素材类型读取原图或显影副本，若都没有则保持预览。
