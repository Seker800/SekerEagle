# SekerEagle 灵感采集

这是一个独立的 Manifest V3 Chrome 扩展。用户在网页图片或视频上按住 `Alt` 并点击右键，扩展会把原始媒体、网页来源和 Eagle 风格元数据加入本地可靠队列，再上传到 SekerEagle。

当前扩展版本：`0.3.0`。

## 给 Agent 的一句话说明

这不是“调用浏览器下载”的小脚本，而是 SekerEagle 的浏览器采集适配器：内容脚本负责识别图片和视频，Service Worker 负责持久化队列和上传，服务端负责认证、分片上传、SHA-256 去重、来源留存和媒体处理。

```text
网页 Alt+右键
    ↓
content-script / capture-interaction
    ↓ chrome.runtime.sendMessage
Service Worker
    ↓
IndexedDB 持久队列
    ↓
浏览器采集 API + 预签名分片上传
    ↓
PostgreSQL 业务事实 + MinIO 原图 + worker 媒体任务
```

插件只通过 gateway 访问 SekerEagle，不连接 PostgreSQL、MinIO 内部端口，也不依赖 SekerChat。

## 用户安装与配置

1. 在 SekerEagle 的“账号 → 外部连接令牌”创建用途为“浏览器采集”的令牌。
2. 令牌只应包含 `capture:write` scope，实际前缀是 `sea_pat_`。
3. 打开 `chrome://extensions`，启用开发者模式，点击“加载未打包的扩展程序”。
4. 选择本目录 `plugins/browser-capture`。
5. 打开扩展设置，填写服务器地址与 PAT。
6. 首次安装或重新加载扩展后，刷新已经打开的普通网页，再使用 `Alt+右键`。

默认配置：

- 连接模式：`auto`
- 内网地址：`http://localhost:8180`
- 允许内网 HTTP：关闭
- 公网地址：空
- 并发上传数：`3`，允许范围 `1-6`

Chrome 内置页、新标签页和 Chrome 应用商店不允许普通扩展注入内容脚本，不能作为采集测试页。

## 内网与公网

扩展支持三种连接模式：

- `auto`：内网优先，只有网络连接失败时才尝试公网。
- `local`：只使用内网地址。
- `public`：只使用公网地址。

在另一台局域网电脑上使用扩展时，内网地址应填写运行 SekerEagle 的电脑地址，例如
`http://192.168.1.10:8180`，并显式启用“允许内网 HTTP”。服务端还必须把 gateway 绑定到
该内网 IP；默认部署只绑定 loopback。HTTP 会明文传输 PAT 和图片，只应在可信局域网中使用。

公网地址可以是固定域名或 `IP:端口`。公网 HTTP 必须在设置页显式允许，因为 PAT 和图片会以明文传输。认证失败不会触发地址回退，避免把无效凭据重复发送到其他地址。

公网反向代理或 Tunnel 应把根路径原样转发到 `http://localhost:8180`，至少覆盖：

- `/api/`
- `/sekereagle-assets/`

不要暴露 PostgreSQL、MinIO 或其他 Compose 内部端口。预签名上传地址只允许改写 loopback host，并且必须指向当前已配置的可信 gateway。

## 捕获行为

当前能够识别：

- 普通 `<img>` 和 `<picture>` 图片。
- `srcset` 与匹配当前媒体条件的 `<picture><source>`，按宽度或像素密度优先尝试高清候选。
- 指向图片文件的外层链接，以及 `data-original`、`data-full`、`data-highres`、`data-large`、`data-zoom-image`、`data-srcset`、`data-lazy-srcset` 等通用高清来源属性。
- 元素后方被覆盖层遮挡的图片。
- 开放 Shadow DOM 内的图片。
- CSS 多层 `background-image`、mask、`::before` 和 `::after` 伪元素图片。
- `<video poster>` 与 SVG `<image href>` 引用。
- 普通 `<video src>` 与 `<video><source type="video/mp4">` 的 MP4 原文件。
- X / Twitter 页面接口返回的 `video.twimg.com` MP4 码率列表；按推文 ID 和媒体位置关联点击的视频，优先选择最高码率候选，并以播放器已加载的地址作为降级路径。
- 小红书笔记详情中的视频流列表；优先选择浏览器可处理的高清流，并以页面 `VideoObject` 结构化数据作为降级路径。视频地址仅接受 `xhscdn.com` 官方 CDN。
- `http:`、`https:`、`data:` 和网页临时 `blob:` 图片地址。
- Canvas、内联 SVG、WebGL 和无法下载的受限图片会使用点击元素的可见截图兜底。

支持的视频格式为浏览器兼容的 H.264 MP4；图片支持 AVIF、JPG/JPEG、PNG、WebP、GIF、HEIC 和 HEIF，单个媒体最大 100MB。视频原文件不可用时任务会明确失败，不会悄悄退化成封面或截图；只有确实没有可用视频来源时，旧有的 `<video poster>` 图片采集行为才会保留。

X 使用临时 `blob:` 播放地址。扩展只观察 X 页面自身已经发起的接口响应，从中提取视频地址和码率，不内置 X 的登录 Cookie、CSRF 值或 Eagle 的站点授权串，也不会把推文文本传给扩展后台。若站点响应结构变化，仍会尝试匹配播放器已经加载的 MP4。

小红书会在采集时用当前页面登录状态重新读取对应笔记详情，从 `noteDetailMap` 中选择视频流；不会保存或传出站点 Cookie。签名过期后重新打开或刷新笔记再采集即可。

同源登录媒体与普通 `blob:` 媒体优先在网页上下文读取，单次浏览器侧副本最大 16MB。PAT 始终只保存在扩展后台，不会发送到网页；超过该限制或读取失败时仍会尝试后台原文件下载。图片保留可见截图作为最终兜底，视频不会截图冒充原文件。

高清识别不会只押注一个猜测地址。内容脚本最多生成 12 个去重候选，并始终为浏览器当前显示的 `currentSrc`/`src` 保留兜底位置；后台依次下载，遇到失效地址、非图片响应或暂不支持的格式会自动尝试下一项。普通详情页链接不会作为图片候选，服务器明确声明为 HTML 的内容也不会因 URL 带图片扩展名而被上传。

Alt 状态会在右键按下阶段记录，因为部分页面触发 `contextmenu` 时已经丢失修饰键状态。一次手势通过按下、抬起和菜单事件关联并去重，防止同一张图重复入队。

捕获后页面会立即显示短暂提示：

- `正在加入 SekerEagle 队列`
- `已加入 SekerEagle 队列 · N`
- 或明确的失败原因

入队只是开始，不代表采集已经成功。任务真正完成或进入需要人工处理的失败状态时，扩展会同时显示网页提示和 Chrome 系统通知；原采集页面仍然打开时还会播放成功或失败音效。扩展弹窗中的每条任务会显示“刚刚 / N 分钟前 / N 小时前 / N 天前”，悬停可查看精确日期时间。成功任务使用完成时间，失败任务使用最后更新时间。

## 保存的元数据

扩展会生成接近 Eagle 的采集信息：

- 显示名称：优先使用 alt 文本，其次使用有意义的文件名，最后使用页面标题。
- 原始媒体 URL（数据库兼容字段仍名为 `imageUrl`）。
- 页面 URL 与页面标题。
- alt 文本。
- 捕获时间。
- 插件版本。

页面来源会去除 URL 凭据和片段；图片 URL 会去除常见签名查询参数。服务端按 SHA-256 去重相同图片，但每次采集来源都会单独保留，不覆盖已有素材元数据。

## 队列与恢复语义

任务保存在扩展自己的 IndexedDB：

- 数据库：`sekereagle-browser-capture`
- Object Store：`captures`

主要状态：

```text
PENDING
  → FETCHING
  → UPLOADING
  → COMMITTING
  → COMPLETED

瞬时失败 → RETRY
配置缺失 → WAITING_CONFIG
认证失败 → PAUSED_AUTH
永久错误 → FAILED
```

重要行为：

- Alt+右键只负责可靠入队，不阻塞网页。
- Service Worker 或浏览器中断后，`FETCHING`、`UPLOADING`、`COMMITTING` 会恢复为 `RETRY`。
- 瞬时错误使用指数退避，最长 10 分钟；Chrome alarm 每分钟唤醒队列。
- 一条采集成功后，会提前唤醒因服务器连接、上传或提交失败而退避的旧任务；源图下载失败仍按原退避执行。
- popup 会显示失败阶段、预计重试时间，并提供“立即重试全部”入口。
- PAT 或配置修复后，暂停任务可以继续。
- 服务端使用 `clientCaptureId` 保证重放幂等。
- 已上传分片可以复用，最终提交失败不必重新上传图片。
- 待处理和失败任务不会自动删除。
- 已完成历史最多保留 30 天或最近 500 条。

## 服务端边界

扩展使用以下 API：

```text
POST   /api/eagle/browser-captures
GET    /api/eagle/browser-captures/:clientCaptureId
GET    /api/eagle/browser-captures/:clientCaptureId/parts
POST   /api/eagle/browser-captures/:clientCaptureId/parts/:partNumber
POST   /api/eagle/browser-captures/:clientCaptureId/complete
DELETE /api/eagle/browser-captures/:clientCaptureId
```

所有接口要求 `capture:write` PAT。ownerId 只能从认证主体推导，DTO 不接受 ownerId，跨 owner 访问返回 404。

控制 API 请求携带 `Authorization: Bearer sea_pat_...`。预签名对象上传绝不能携带 PAT，也不能把 PAT 放入 URL。

## 代码导航

| 文件                           | 职责                                                       |
| ------------------------------ | ---------------------------------------------------------- |
| `manifest.json`                | Manifest V3 权限、内容脚本、Service Worker、popup 和设置页 |
| `src/content-script.js`        | 网页事件入口、消息发送与可见提示                           |
| `src/capture-interaction.js`   | Alt+右键手势、坐标命中、Shadow DOM 与背景图识别            |
| `src/image-source-resolver.js` | 响应式原图候选、直链与高清属性解析、质量排序和兜底         |
| `src/video-source-resolver.js` | 通用 MP4、X 媒体元数据和小红书笔记视频流解析               |
| `src/x-media-page-observer.js` | 从 X 页面自身的接口响应提取推文视频码率列表                |
| `src/site-media-observer.js`   | 校验并缓存 X 视频元数据，记录实际请求 MP4 作为降级路径     |
| `src/capture-source.js`        | 入队前对不可信候选 URL 去重、协议过滤和数量限制            |
| `src/capture-metadata.js`      | 名称、来源和图片元数据规范化                               |
| `src/service-worker.js`        | 入队、alarm、消息处理、恢复和 badge 更新                   |
| `src/queue-store.js`           | IndexedDB 持久化                                           |
| `src/queue-policy.js`          | 可运行任务选择、失败分类、退避和历史清理                   |
| `src/queue-runner.js`          | 下载图片、并发调度、上传、重放和最终收敛                   |
| `src/api-client.js`            | 浏览器采集 API 与预签名分片上传客户端                      |
| `src/runtime-fetch.js`         | 保持 `WorkerGlobalScope` 接收者的原生 fetch 适配器         |
| `src/connection-config.js`     | 内外网候选、HTTP 安全开关和预签名 URL 改写                 |
| `src/options.js`               | 配置校验与保存                                             |
| `src/popup.js`                 | 队列摘要与人工重试入口                                     |

## 两个已知高风险契约

### PAT 前缀

服务端签发的 PAT 前缀是 `sea_pat_`，不是 `seg_pat_`。设置页、队列、API 客户端和契约测试必须保持一致。

### Service Worker 原生 fetch

不要把原生 `fetch` 直接存下来再以其他对象的方法调用：

```js
this.fetchImpl = fetch;
await this.fetchImpl(url); // Chrome 中可能抛出 Illegal invocation
```

默认传输必须经过 `runtimeFetch`：

```js
export function runtimeFetch(input, init) {
  return globalThis.fetch(input, init);
}
```

它保证 Chrome Service Worker 中的 `fetch` 仍以 `WorkerGlobalScope` 为接收者。测试注入的 `fetchImpl` 仍可独立替换。

## Agent 验证手册

### 1. 静态与单元测试

```bash
npm --prefix plugins/browser-capture test
npx eslint plugins/browser-capture
npx prettier --check 'plugins/browser-capture/**/*.{js,json,html,md}'
```

修改里程碑还应按仓库规则运行：

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

### 2. 真实 Chrome 端到端测试

Node 测试不能替代真实 Chrome 测试。至少验证一次：

1. 确认 ChatGPT Chrome 控制扩展已经连接。它与 SekerEagle 灵感采集扩展是两个不同扩展。
2. 在 `chrome://extensions` 确认 SekerEagle 版本并重新加载。
3. 刷新一个普通网页媒体页，让新版内容脚本重新注入。
4. 对真实图片或视频执行 `Alt+右键`。
5. 确认网页出现 `已加入 SekerEagle 队列`。
6. 检查 gateway 日志是否依次出现创建捕获、分片签名和完成请求，状态为 201。
7. 只读检查最新 `EagleBrowserCapture` 是否使用当前扩展版本，并且上传会话为 `COMPLETED`、存在 assetId。

当前环境已经验证过一条完整路径：插件 `0.1.3` 捕获 `SpaceX Starship - Wikipedia`，三个 API 阶段均返回 201，数据库记录最终为 `COMPLETED`。

浏览器控制注意事项：

- 浏览器接口不能接管 `chrome://extensions`，需要使用 Computer Use 操作同一个 Chrome 窗口。
- 不要通过直接导航 `chrome-extension://...` 绕过浏览器安全策略。
- 扩展重新加载后，旧网页可能记录一次 `Extension context invalidated`；刷新网页后再测试。这个历史错误不等于新版 Service Worker 失败。
- 不要读取或输出 Chrome 存储中的 PAT。测试应使用页面提示、HTTP 日志和去标识化的数据库状态作为证据。

### 3. 安全的数据库验收字段

只需检查时间、显示名称、插件版本、上传状态、是否完成和是否存在 assetId。不要输出 ownerId、PAT 或其他凭据。

```sql
SELECT
  c."createdAt",
  c."displayName",
  c."extensionVersion",
  u.status,
  c."completedAt" IS NOT NULL AS completed,
  c."assetId" IS NOT NULL AS has_asset
FROM "EagleBrowserCapture" c
JOIN "UploadSession" u ON u.id = c."uploadSessionId"
ORDER BY c."createdAt" DESC
LIMIT 5;
```

## 修改时的完成标准

一次浏览器采集改动只有同时满足以下条件才算完成：

- 新行为有先失败后通过的回归测试。
- 插件测试、ESLint 和 Prettier 通过。
- 仓库 lint、typecheck、test 和 build 通过，或对无关并行改动造成的阻塞提供明确证据。
- 涉及真实浏览器行为时完成 Chrome 端到端验证，不能只依赖 Node mock。
- 没有泄露 PAT，没有把 ownerId 放入 DTO，没有让公网 HTTP 绕过显式许可。
