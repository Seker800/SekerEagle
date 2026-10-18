# 相机照片与视频格式

素材和照片使用同一份格式策略、上传校验和媒体处理链路。允许导入原文件不等于让浏览器直接解码原文件：RAW 生成 sRGB 图片预览，相机视频生成 H.264／AAC MP4 播放副本，下载仍返回未经转码的原始字节。

## 格式范围

| 类型     | 入口格式                                                                       | 处理方式                                                             |
| -------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 常见图片 | JPEG、PNG、WebP、GIF、AVIF、HEIC／HEIF、TIFF                                   | 共用图片校验、缩略图和查看器                                         |
| 相机 RAW | DNG、CR2／CR3／CRW、NEF／NRW、ARW／SR2、RAF、ORF、RW2、RWL、PEF、SRW、KDC、RAW | LibRaw 验证并解码，生成可浏览的 sRGB 派生图片；EXIF 尽力从原文件提取 |
| 相机视频 | MP4／M4V、MOV、MTS／M2TS、AVI、MXF、MPG／MPEG                                  | 验证真实容器及编码，生成海报与浏览器播放副本                         |

视频编码白名单包含 H.264、HEVC、ProRes、DNxHD、MPEG-2、MPEG-4 Part 2、MJPEG、DV、H.263。容器相同不代表所有编码都受支持；ProRes RAW、BRAW、R3D 等视频 RAW 不在本轮范围内。RAW 是否可解码取决于运行环境中的 LibRaw 版本和具体机型／压缩方式，不能仅凭扩展名宣称所有相机均已验证。RAW 显影使用相机白平衡和通用 sRGB 输出，不等同于厂商显影软件；视频预览暂未提供完整 HDR 色彩管理。

RAW 的拍摄时间、镜头、GPS 等元数据取决于原文件与 EXIF 解析器支持。普通 TIFF／DNG 等可读字段沿用现有摄影信息模块；不能把生成预览成功视作所有专有 MakerNote 或 CR3 元数据均已支持。本轮不增加视频的人物识别或视频摄影元数据管理。

## 资源限制与安全边界

- 图片／RAW：单文件 250 MiB，最多 5000 万输入像素，保留已有像素预算。高于该像素数的相机原片目前会明确拒绝，不能通过压低缩略图尺寸绕过原片解码限制。
- 视频：单文件 2 GiB，最多四小时，输入每边不超过 16384 像素且总像素不超过一亿。播放副本最长边 1920、H.264 8-bit／AAC，生成预算约 1 GiB、30 分钟；超时或不完整副本不会被标记为可用。
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
