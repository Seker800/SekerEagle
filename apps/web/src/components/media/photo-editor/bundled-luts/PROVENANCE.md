# Xiaomi MediaEditor 滤镜资源来源

本目录是小米媒体编辑器官方照片滤镜的离线快照：

- 官方包名：`com.miui.mediaeditor`
- 官方 APK 版本：`2.4.0.4.3`
- 云配置模块：`mediaeditor_filter_config / filter_cloud_config`
- 云配置版本：`706957`
- 抓取日期：`2026-08-20`
- 资源域名：`cdn.cnbj1.fds.api.mi-img.com`

本仓库从 Seker 水印项目的上述资源快照中选取了 14 条徕卡 LUT，实际打包项、名称和每个 PNG 的 SHA-256 以同目录 `manifest.json` 为准。未打包其余常规滤镜或视频内部 CUBE；不得依据来源项目的完整数量判断本目录缺失文件。

所有打包 LUT 均为 512×512 PNG，对应 64³ 数值查找表。名称相近的条目可能具有不同像素与校验值，不能仅凭名称去重。内置清单与用户个人 LUT 存储分离，升级不能覆盖个人滤镜。
