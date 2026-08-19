# SekerEagle 浏览器图片采集

精简的 Manifest V3 Chrome 扩展：在网页图片上按住 `Alt` 并点击右键，将原图和网页来源加入 SekerEagle。

## 安装

1. 在 SekerEagle 账号页创建“浏览器采集”令牌；它只应包含 `capture:write` scope。
2. 打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”。
3. 选择本目录 `plugins/browser-capture`。
4. 打开扩展设置，填写 SekerEagle 地址和刚创建的 PAT。

本机默认地址为 `http://localhost:8180`。远程地址必须使用 HTTPS。

## 队列语义

- Alt+右键只负责将任务持久化到 IndexedDB，不会阻塞网页操作。
- 默认并发为 3，最大为 6。
- 浏览器或 Service Worker 中断后会自动恢复上传。
- PAT 失效时队列暂停，更新设置后继续。
- 相同图片由服务端 SHA-256 去重，但每次网页采集来源都会保留。
- 待上传与失败任务不会自动清理；已完成历史最多保留 30 天或最近 500 条。

当前支持 JPG/JPEG、PNG、WebP、GIF、HEIC 和 HEIF；单图最大 100MB。网页临时 `blob:` 图片、Canvas、视频和 CSS 背景图不在首版范围内。
