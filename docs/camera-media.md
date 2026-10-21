# 相机照片与视频格式

素材和照片使用同一份格式策略、上传校验和媒体处理链路。允许导入原文件不等于让浏览器直接解码原文件：RAW 生成 sRGB 图片预览，相机视频生成 H.264／AAC MP4 播放副本，下载仍返回未经转码的原始字节。

## 格式范围

| 类型     | 入口格式                                                                       | 处理方式                                                             |
| -------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 常见图片 | JPEG、PNG、WebP、GIF、AVIF、HEIC／HEIF、TIFF                                   | 共用图片校验、缩略图和查看器                                         |
| 相机 RAW | DNG、CR2／CR3／CRW、NEF／NRW、ARW／SR2、RAF、ORF、RW2、RWL、PEF、SRW、KDC、RAW | LibRaw 验证并解码，生成可浏览的 sRGB 派生图片；EXIF 尽力从原文件提取 |
| 相机视频 | MP4／M4V、MOV、MTS／M2TS、AVI、MXF、MPG／MPEG                                  | 验证真实容器及编码，生成海报与浏览器播放副本                         |

视频编码白名单包含 H.264、HEVC、ProRes、DNxHD、MPEG-2、MPEG-4 Part 2、MJPEG、DV、H.263。容器相同不代表所有编码都受支持；ProRes RAW、BRAW、R3D 等视频 RAW 不在本轮范围内。RAW 是否可解码取决于运行环境中的 LibRaw 版本和具体机型／压缩方式，不能仅凭扩展名宣称所有相机均已验证。RAW 的 256／512 缩略图优先使用内嵌相机 JPEG，按其 EXIF 方向（缺失时读取 RAW 方向）归一化，保留内嵌色彩配置并由共用编码器转换到 sRGB。预览缺失、损坏、非 JPEG、最长边不足 512 或超过 64 MiB／5000 万像素预算时回退到显影来源。原件仍须通过 LibRaw 验证；原始尺寸与摄影信息仍读取原片，不以 JPEG 覆盖。普通大图、金字塔和编辑副本继续使用独立显影来源，采用解码器默认亮度策略、相机白平衡和通用 sRGB 输出，不等同于厂商显影软件；视频预览暂未提供完整 HDR 色彩管理。

RAW 的拍摄时间、镜头、GPS 等元数据取决于原文件与 EXIF 解析器支持。普通 TIFF／DNG 等可读字段沿用现有摄影信息模块；不能把生成预览成功视作所有专有 MakerNote 或 CR3 元数据均已支持。本轮不增加视频的人物识别或视频摄影元数据管理。

## 资源限制与安全边界

- 图片／RAW：单文件 500 MB（500,000,000 字节，含边界），普通图片最多 5000 万输入像素；RAW 传感器输入最多 1.2 亿像素。LibRaw 解包前检查真实传感器与可见尺寸，高于 5000 万可见像素的 RAW 使用半尺寸显影，RGB 输出仍最多 5000 万像素。图库记录真实原片尺寸，原片下载字节不变；不能只修改缩略图尺寸绕过 RAW 输入预算。
- 视频：单文件 5 GB（5,000,000,000 字节，含边界），最多四小时，输入每边不超过 16384 像素且总像素不超过一亿。播放副本最长边 1920、H.264 8-bit／AAC，生成预算约 1 GiB、30 分钟；超时或不完整副本不会被标记为可用。
- 浏览器提供空 MIME 或 `application/octet-stream` 时，依据同一格式目录补齐声明；有冲突的声明拒绝。上传完成后仍检查真实内容：LibRaw 拒绝伪装 RAW，FFprobe 拒绝不匹配容器或不支持的编码。
- RAW 在读取元数据、检查原始尺寸后才执行像素解包；在独立进程中运行，有时间和输出限制。原文件写入独立临时目录，成功与失败均清理。
- FFprobe／FFmpeg 限制输入协议为本地文件／管道，限制容器探测白名单，不接受网络播放列表；调用使用参数数组，不拼接 shell 命令。
- 播放副本经现有 owner、mode、私密、回收与当前媒体版本校验后读取；支持单段 HTTP Range、206 和 416。越权返回 404，先鉴权再验证 Range，不泄露文件大小。
- 桌面端视频继续使用鉴权 HTTP 播放，不混入图片 Blob／原生图片缓存。老版本仅 H.264 MP4 的资产可继续播放原文件；新视频优先使用当前版本播放副本。

## 运行环境

API 与 worker 需要 FFprobe、FFmpeg，以及独立 Python 环境中的 rawpy、NumPy、Pillow。Dockerfile 已同时安装并复制共用媒体包和 Python 脚本；仅写前端扩展名不能构成支持。

本地开发可按以下方式准备，环境变量应同时传给 API 与 worker：

```sh
python3 -m venv .omx/camera-media/venv
.omx/camera-media/venv/bin/pip install -r packages/media-core/python/requirements.txt
export CAMERA_RAW_PYTHON="$PWD/.omx/camera-media/venv/bin/python"
# FFmpeg 和 FFprobe 不在 PATH 时，设置 FFMPEG_PATH 与 FFPROBE_PATH。
```

RAW 同时生成最长边 6000 的无损 WebP `PREVIEW/edit`，供原有编辑器编辑显影副本；它不是传感器级 RAW 编辑，不复制相机厂商电影模拟或手机多帧计算摄影。普通图库只读取 `PREVIEW/default`。旧资源可通过现有处理页“扫描缺失任务”补齐编辑副本，完成后出现 RAW 编辑入口，不使用低清缩略图替代。能力接口分别声明 `images.maxPixels` 与 `images.maxRawPixels`，普通图片预算不随 RAW 提升。

纯 RAW 运行环境缺失时，RAW 上传校验明确失败，不将其伪装成已支持的普通图片。其他图片和视频不依赖 RAW Python 模块。

## 可重复验证

格式策略在 `packages/library-core`；本地解码／探测／转码适配在 `packages/media-core`。Web、API、worker 复用它们，旧的 API／worker 两份 H.264-only 探测策略已移除。

根目录 lint、typecheck、unit test、build 和共用架构门禁覆盖常规回归；相机原生链路另有以下测试：

```sh
.omx/camera-media/venv/bin/pip install -r scripts/testing/camera-requirements.txt
npm run db:generate
npm run build
CAMERA_RAW_PYTHON="$PWD/.omx/camera-media/venv/bin/python" npm run smoke:camera-media
```

该测试生成自己的 Bayer DNG、TIFF、视频测试图案，经过 API 内容校验、worker 图片解码或视频转码，检查原文件 SHA-256 不变、派生预览和伪装文件拒绝。GitHub Actions 在安装原生测试运行环境后执行同一 smoke。测试 DNG 与视频图案是合成条件，不冒充真实拍摄样本。

`PHOTO_WORKBENCH_CAMERA=1` 启用独立工作台的相机格式验收：七种样本分别通过真实 HTTP 上传到素材和照片，等待 worker 处理，逐一校验原文件哈希、视频 Range 读取、跨模式 404，并将原图和派生对象复制恢复后比较哈希。运行时还须设置 `CAMERA_RAW_PYTHON`，并为生成合成 DNG 安装上述测试依赖。

本机额外下载的 Canon 40D sRAW CR2 样本来自 [rawpy 测试数据](https://github.com/letmaik/rawpy/tree/main/test)，原提供者为 rawsamples.ch，许可见其 [README](https://github.com/letmaik/rawpy/blob/main/test/README.txt)（CC BY-NC-SA 4.0）。样本仅用于本地非商业验证，不随仓库或镜像分发。来源、大小和哈希记录在忽略目录中的 `camera-public-source.json`；可用 `CAMERA_TEST_RAW` 显式传入公开样本运行额外解码测试，默认 CI 不下载第三方照片。

这些小样本不构成所有品牌／机型、两小时 8K 视频或最大文件边界的全面性能验收。正式实例与群晖真实图库本轮均不部署、不迁移。

## 新机型色彩与本机验证

LibRaw 能解包不代表具备机型色彩校准。本机 rawpy 0.27.1／LibRaw 0.22.1 可解包 X-E5，但其相机到 XYZ 矩阵全为零。共用 Python 适配器为这种情况读取显式 X-E5 校准数据：先由 LibRaw 输出经过相机白平衡的线性 16-bit 相机 RGB，再按校准矩阵转换到线性 sRGB 并编码 sRGB。矩阵运算按 128 行处理，限制临时内存；不改写 LibRaw 内部数据、不将机型伪装成另一款相机。未来 LibRaw 自带矩阵时自动优先使用内置校准。数据来源和 CC-BY-SA-3.0 署名见 `camera-profiles.json` 与第三方声明。

数值测试检查灰阶中性、黑白端点及已知线性 sRGB 色块往返；真实样本经过 API 内容检查、worker 显影、四种派生规格及原片哈希校验。可对自己提供的本地样本重复执行：

```sh
CAMERA_RAW_PYTHON="$PWD/.omx/camera-media/venv/bin/python" \
  node scripts/testing/camera-device-audit.mjs /path/to/photo.RAF /path/to/photo.NEF /path/to/photo.DNG
```

测试只读取本地文件，不上传样本；结果记录在忽略目录 `.omx/artifacts/camera-device-audit.json`。公开 RAF／NEF 测试样本来自 [raw.pixls.us](https://raw.pixls.us/)，每份样本的来源、许可、压缩模式及 SHA-256 记录在本地样本 manifest 中，不随仓库分发照片。小米 DNG 使用本机既有四份 17 Ultra 实拍样本。合成 DNG 的双模式 HTTP 验收还检查显影副本鉴权、PNG 独立副本保存、跨模式拒绝，以及旧 RAW 缺少编辑副本时的扫描修复。

本次实拍验收覆盖如下，不将机型列表代替实拍结果：

| 设备             | 实测文件                                                  |
| ---------------- | --------------------------------------------------------- |
| Fujifilm X-E5    | 14-bit 未压缩、无损压缩、有损压缩 RAF                     |
| Fujifilm X-Pro3  | 14-bit 未压缩、压缩 RAF                                   |
| Fujifilm GFX100S | 14-bit 无损压缩、压缩 RAF，约 1.02 亿可见像素，半尺寸显影 |
| Nikon Z5         | 12/14-bit 无损压缩及有损压缩 NEF，共四份                  |
| Xiaomi 17 Ultra  | 三份 Ultra RAW DNG 与一份普通 RAW DNG                     |

以上合计 15 份实拍文件。单一机型通过这些模式不代表其他固件、镜头校正、所有压缩模式或厂商外观均已逐一验证；GFX100S 的其他位深模式本轮未取得完整样本，不列入实拍已验证范围。

## 2026-10-21 群晖实片兼容修复

摄影信息从原文件通过 ExifTool 的只读标签白名单提取，覆盖 RAF 封装、小米 DNG 的 IFD0 标签和 HEIC。保留没有时区信息的原始本地拍摄时间；GPS 方位与海拔符号显式归一化。不以显影 TIFF 的残缺 EXIF 替代原片，不从文件名、复制时间或导入时间伪造拍摄日期。原文件字节不变，文件系统时间不等于 EXIF 拍摄时间，也不会自动成为 S3 原文件的创建日期。

API 与 worker 均安装 ExifTool（worker 使用）和 Debian bookworm-backports 的 libheif-examples／libheif-plugin-libde265；上传与预览共用 media-core 的 HEIF 解码，保留 MIME、总像素、大小、超时、进程环境与输出预算，禁止关闭 libheif 安全限制。解码依赖缺失时，worker 重试而非将空摄影信息标记为成功。

已有照片可用 worker 镜像中的 `apps/worker/dist/photo-metadata-refresh.js` 补读。首个参数是明确资源清单文件，每项仅含 assetId、sha256、mediaRevision，最多 100 项且必须属于同一个账号的 PHOTO；默认仅输出计划，附加 `--apply` 才写入。先完成备份与安全目标检查。命令核对当前媒体版本、未删除状态、原片大小与 SHA，在资源行锁内复核并复用原有摄影持久化函数；保留既有像素分析、不覆盖继承了原片拍摄信息的编辑副本、不重新生成缩略图、不全库扫描。它不修改原片、素材、模型或数据库 schema。

### 群晖本轮发布与真实样本复验

2026-10-21 本轮只针对已授权的 100 张真实样本：100 张入库并生成预览，原片 SHA／大小一致；既有 91 项保持原 ID，仅新增此前失败的 9 项。83 个已有拍摄时间全部读入，17 张原片没有该字段而回退添加时间；593 项已有摄影字段与独立基准逐项一致。原始文件和群晖相册目录不改动。1 张扩展名误写 PNG 的 JPEG 仅在导入用临时副本中修正名称，不放宽服务端声明格式校验。

群晖仍使用 35 个 migration 的既有 schema，镜像源码为 `codex/nas-photo-format-fix-20261021` 的兼容补丁；本轮没有执行数据库迁移或部署主分支新增的其他功能。发布叠加顺序为既有 compose、search-inference、https，最后增加 `photo-format-fix-20261021.yml`；该覆盖文件仅固定 API／worker 镜像，不更改认证、对象存储、HTTPS、Mac 模型或其他服务。后续维护必须保留这些覆盖关系，或在完整升级计划中明确替换；不能直接用旧基础 compose 覆盖当前 HTTPS 和补丁版本。

这次复验只覆盖原片、基础预览、摄影信息和时间线。AI 标签、向量与更深层图像金字塔仍遵循既有后台安排，未作为本轮成功条件，也未开启全相册导入。

### RAW 内嵌 JPEG 缩略图

图库的 256／512 缩略图优先读取 RAW 内嵌相机 JPEG，复用其已完成的曝光、颜色和影调处理；不是给传感器数据手动加亮。可选预览验证失败或太小时才使用显影来源。内嵌预览先保留 ICC 配置、归一化方向并限制至最长边 512，随后复用既有 WebP 编码和私有媒体存储。原片解包验证、原始尺寸、EXIF、普通大图、金字塔和高清编辑来源保持独立。撤去自选的 0.001 亮度阈值；显影回退使用 LibRaw 默认值与相机白平衡。LibRaw 默认值不是厂商外观或完整 DNG 渲染的等价实现，完整显影一致性仍需另行验证。

本轮 38 份试导入 RAW 均成功读取内嵌 JPEG；六个代表机型涵盖 GFX100S、X-Pro3、Nikon Z5、D7000 与两款小米 DNG。回归覆盖缺失、损坏、非 JPEG、尺寸／字节预算、过小预览、EXIF／RAW 方向、ICC 保留和输出写入失败；显影来源不会被小预览替换。

既有 RAW 通过 worker 的 `raw-preview-refresh.js` 和同样的精确版本清单重新生成派生图片；默认预演，`--apply` 在账号／PHOTO／原始 RAW／SHA／媒体版本复核和行锁内创建现有 GENERATE_RENDITIONS 任务。任务按显影策略版本去重，重试不新增照片，不更改原件、摄影时间或模式归属。仅重建明确授权的样本，不自动扫描全库。
