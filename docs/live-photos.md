# 实况照片

实况照片是静态图片与动态片段的组合，不等同于连拍或相似照片组。媒体解析、预览、播放与访问控制共用素材／照片的媒体链路。

支持入口：Apple JPEG／HEIC／HEIF 静态照片与 MOV（以 Apple ContentIdentifier 精确配对），以及带 XMP 视频目录或旧 MicroVideoOffset 的 JPEG Motion Photo。不同账号、不同图库模式、标识不匹配或有多个候选的文件不得配对，不能只靠文件名猜测。缺少动态片段时仍可作为普通照片使用。

原始图片与配对视频保持字节不变并各自托管，单文件 Motion Photo 也保留完整原件；动态播放使用本地生成的 H.264／AAC 副本。静态复制始终复制图片。解析不可信元数据时限制大小、偏移、时长与子进程权限；损坏的可选动态内容不能阻断静态预览。

动态元数据与媒体版本绑定；替换原文件会清除旧关联。读取配对片段必须同时满足 owner、模式、私密、回收及当前版本边界；不能把视频复制到另一个图片资源后绕过视频本身的权限。

来源：[Apple Live Photo 关联标识](https://developer.apple.com/documentation/avfoundation/avcapturephotosettings/livephotomoviemetadata)、[Android Motion Photo 格式](https://developer.android.com/media/platform/motion-photo-format)、[ExifTool Apple MakerNotes 标签说明](https://exiftool.org/TagNames/Apple.html)。
