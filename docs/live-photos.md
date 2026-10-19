# 实况照片

实况照片是静态图片与动态片段的组合，不等同于连拍或相似照片组。媒体解析、预览、播放与访问控制共用素材／照片的媒体链路。

支持入口：Apple JPEG／HEIC／HEIF 静态照片与 MOV（以 Apple ContentIdentifier 精确配对），以及带 XMP 视频目录或旧 MicroVideoOffset 的 JPEG Motion Photo，以及带 mpvd 视频盒的 HEIC Motion Photo。不同账号、不同图库模式、标识不匹配或有多个候选的文件不得配对，不能只靠文件名猜测。缺少动态片段时仍可作为普通照片使用。

原始图片与配对视频保持字节不变并各自托管，单文件 Motion Photo 也保留完整原件；动态播放使用本地生成的 H.264／AAC 副本。静态复制始终复制图片。解析不可信元数据时限制大小、偏移、时长与子进程权限；损坏的可选动态内容不能阻断静态预览。

动态元数据与媒体版本绑定；替换原文件会清除旧关联。读取配对片段必须同时满足 owner、模式、私密、回收及当前版本边界；不能把视频复制到另一个图片资源后绕过视频本身的权限。

来源：[Apple Live Photo 关联标识](https://developer.apple.com/documentation/avfoundation/avcapturephotosettings/livephotomoviemetadata)、[Android Motion Photo 格式](https://developer.android.com/media/platform/motion-photo-format)、[ExifTool Apple MakerNotes 标签说明](https://exiftool.org/TagNames/Apple.html)。

播放副本最多 15 秒、64 MiB。缺少、损坏或超限的可选动态片段保留为静态图片；不会凭空恢复被导出工具丢弃的动态文件。图库折叠已匹配且当前可见的 MOV 组件；计数仍按托管原文件统计。删除／恢复静态实况图片时一并处理其唯一、同作用域、可访问的配对视频；下载原文件时保留两份文件。单独删除视频不删除静态图片。

原生验证样本：仓库自生成的 Apple MakerNote JPEG／MOV 与 XMP JPEG Motion Photo；额外本地测试 [Immich 公开测试资源](https://github.com/immich-app/test-assets) 的 Pixel 6 Pro JPEG 和 Samsung One UI 6 HEIC（README 标明媒体为 public domain，文件仅放在忽略的本地测试目录，不纳入发行）。
