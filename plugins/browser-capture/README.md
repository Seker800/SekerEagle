# SekerEagle 浏览器图片采集

精简的 Manifest V3 Chrome 扩展：在网页图片上按住 `Alt` 并点击右键，将原图和网页来源加入 SekerEagle。

## 安装

1. 在 SekerEagle 账号页创建“浏览器采集”令牌；它只应包含 `capture:write` scope。
2. 打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”。
3. 选择本目录 `plugins/browser-capture`。
4. 打开扩展设置，填写内网地址、公网地址（可选）和刚创建的 PAT。
5. 首次安装或点击扩展“重新加载”后，刷新已经打开的普通网页，再使用 Alt+右键。Chrome 内置页、新标签页与 Chrome 商店不允许扩展注入。

本机默认地址为 `http://localhost:8180`。公网地址可以使用固定域名或 IP 与端口。公网 HTTP 必须在设置页显式允许，因为 PAT 和图片都会经过明文网络。自动模式会优先尝试内网地址，仅在连接失败时回退到公网地址；服务端认证失败不会触发地址切换。

公网反向代理或 Tunnel 应将域名根路径原样转发到本机 `http://localhost:8180`，包括 `/api/` 与 `/sekereagle-assets/`。无需把 PostgreSQL、MinIO 或其他 Compose 端口暴露到公网。

## 队列语义

- Alt+右键只负责将任务持久化到 IndexedDB，不会阻塞网页操作。
- 默认并发为 3，最大为 6。
- 浏览器或 Service Worker 中断后会自动恢复上传。
- PAT 失效时队列暂停，更新设置后继续。
- 相同图片由服务端 SHA-256 去重，但每次网页采集来源都会保留。
- 待上传与失败任务不会自动清理；已完成历史最多保留 30 天或最近 500 条。

当前支持 JPG/JPEG、PNG、WebP、GIF、HEIC 和 HEIF；单图最大 100MB。网页临时 `blob:` 图片、Canvas、视频和 CSS 背景图不在首版范围内。
