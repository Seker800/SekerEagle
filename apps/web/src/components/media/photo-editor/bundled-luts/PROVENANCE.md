# Xiaomi MediaEditor 滤镜资源来源

本目录是小米媒体编辑器官方照片滤镜的离线快照：

- 官方包名：`com.miui.mediaeditor`
- 官方 APK 版本：`2.4.0.4.3`
- 云配置模块：`mediaeditor_filter_config / filter_cloud_config`
- 云配置版本：`706957`
- 抓取日期：`2026-08-20`
- 资源域名：`cdn.cnbj1.fds.api.mi-img.com`

取舍规则：

- 保留原版照片编辑器的 92 条常规滤镜。
- 保留 14 条不重复的官方徕卡滤镜；云端重复发布的 VIV/NAT/HC/BLU 只保留一份。
- 不暴露仅支持视频业务的 6 条内部 CUBE 项。
- `白柔` 和 `黑柔` 按官方配置共用 `119.png`，通过不同的可调效果参数区分。
- 原相机 APK 中的 CHR/CLS/CNT/ETN/BRS/TEL 与云配置资源 SHA-256 完全一致，本快照使用 ID `248`–`253` 保持已有工程状态兼容。

所有 LUT 均为 512×512 PNG。`SHA256SUMS` 记录了每个实际打包文件的完整性校验值。
