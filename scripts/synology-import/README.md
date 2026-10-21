# 群晖共享空间一次性导入

仅将共享空间原文件复制到 SekerEagle PHOTO 托管图库。不得挂载个人 `/homes/*/Photos`，不得赋予数据库、MinIO 凭据或 Docker socket。原片与目录只读，人物、AI 搜索索引和深层金字塔不属于本次导入。

先用 `node scripts/synology-import/export-policy.mjs /private/policy.json` 从共用格式目录导出规则；不维护另一份格式白名单。运行镜像复用带 ExifTool 的现有 worker 镜像，无需新的 Python 依赖。

固定源挂载 `/volume1/photo:/source:ro`，脚本目录挂载 `/import:ro`，私有状态目录挂载 `/state`。状态目录必须 0700，`/state/token` 必须 0600，只放专用 `asset:write` PAT，不接受命令行明文凭据。进程以 NAS 文件所有者的非 root UID/GID 运行，禁用提权、只读容器文件系统并限制 CPU／内存。网络只连接本项目 compose 网络。API 固定使用 `api:3000` 的 `/api/photos/uploads`；原文件分片通过签名 URL 的原 Host 发到同项目 `minio:9000`，校验公共 origin、固定 bucket、认证 owner 路径和分片编号，不经过 Mac 或公网传照片。

在 API 容器先运行共用运行目标安全检查，并核验独立项目、数据库、bucket 和可用磁盘。两端升级后先验证会话返回 `assetStatus`，再执行真实导入。

```sh
python3 /import/shared_import.py inventory --state /state --policy /import/policy.json
python3 /import/shared_import.py run --state /state --policy /import/policy.json --public-origin https://your-gallery.example --limit 25
python3 /import/shared_import.py run --state /state --policy /import/policy.json --public-origin https://your-gallery.example
python3 /import/shared_import.py status --state /state
```

`run` 会先完成清单，再按拍摄时间倒序导入。无时区时间仅用于排序时按上海时区解释，缺失时区不会写回原片或冒充 EXIF。没有拍摄时间时尝试媒体创建时间，最后回退文件修改时间；数据库的拍摄时间仍由原有摄影分析从原片读取，不用排序回退伪造拍摄时间。清单冻结后新增的文件不自动加入本轮。

每批最多 25 项，全部进入 READY／FAILED 后才处理下一批；文件级永久错误保留记录并继续。网络／服务升级暂时失败重试，401／403 停止等待凭据修复。SIGTERM／SIGINT 在检查点安全暂停；再次运行同一目录即恢复，先核对服务器已接收的分片，不清库、不重新复制已完成项。相同文件仍由服务端在同一 owner／PHOTO 内去重。

导入期间 worker 可设 `EAGLE_BACKGROUND_PROCESSING_ENABLED=false`，只暂停该进程的可选后台分析，不修改用户偏好或模型服务。原有基础预览与维护行为保持，通常先用两并发、4 GiB 上限。正式更新应停在批次边界，再部署 API／worker；只更新脚本时也须先停止导入进程。完成后应撤销专用 PAT。

本轮脚本不读取 Synology Photos 私有数据库，因此不会迁移群晖专属的相册集合、分享权限、人脸名字或人工标签；原文件内嵌摄影信息由 SekerEagle 既有链路保留。
