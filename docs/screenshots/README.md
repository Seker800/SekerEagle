# README 截图与图片来源

截图拍摄于 2026-11-01，使用本机隔离演示实例和真实网页界面；未使用私人图库，未改写截图中的界面或检索结果。

- 图库包含 60 张不同的公开摄影作品，在素材与照片两种模式各导入一份。展示图经过缩放和部分裁切。
- 内容检索使用本机 Qwen3-VL-Embedding-2B／MLX 生成的 1024 维图片与文字向量；查询为“海边的建筑”。首个命中使用中性文件名 IMG_0001，没有人工标签。
- 归类建议由同一批真实向量和人工设定的六类标签，通过现有独立 worker 构建标签中心并生成；不是手工填写的推荐结果。
- 拍摄日期、GPS、相机、镜头和评分为演示夹具，不代表原作者的实际拍摄信息。地图仅演示位置浏览，不作为照片原始地点说明。
- 编辑截图展示实际曝光与 HSL 调整，以及署名水印。照片署名保留原作者；未将演示编辑保存到真实图库。
- 截图覆盖网页端的共用工作区；桌面端使用同一管理界面，本次没有另做桌面安装验收。

## 图片许可

摄影作品来自 [Lorem Picsum](https://picsum.photos/) 提供的 Unsplash 图片，按 [Unsplash License](https://unsplash.com/license) 使用。截图中的摄影作品保留各自许可，不适用仓库代码的 Apache-2.0 许可。未将整套原图作为仓库资源发布。

地图截图保留 Protomaps／OpenStreetMap 署名，数据说明见 [地图来源](../photo-map.md)。

| Picsum ID | 作者                  | 原始作品                                            |
| --------- | --------------------- | --------------------------------------------------- |
| 10        | Paul Jarvis           | [Unsplash](https://unsplash.com/photos/6J--NXulQCs) |
| 11        | Paul Jarvis           | [Unsplash](https://unsplash.com/photos/Cm7oKel-X2Q) |
| 12        | Paul Jarvis           | [Unsplash](https://unsplash.com/photos/I_9ILwtsl_k) |
| 13        | Paul Jarvis           | [Unsplash](https://unsplash.com/photos/3MtiSMdnoCo) |
| 14        | Paul Jarvis           | [Unsplash](https://unsplash.com/photos/IQ1kOQTJrOQ) |
| 15        | Paul Jarvis           | [Unsplash](https://unsplash.com/photos/NYDo21ssGao) |
| 16        | Paul Jarvis           | [Unsplash](https://unsplash.com/photos/gkT4FfgHO5o) |
| 17        | Paul Jarvis           | [Unsplash](https://unsplash.com/photos/Ven2CV8IJ5A) |
| 18        | Paul Jarvis           | [Unsplash](https://unsplash.com/photos/Ps2n0rShqaM) |
| 19        | Paul Jarvis           | [Unsplash](https://unsplash.com/photos/P7Lh0usGcuk) |
| 21        | Alejandro Escamilla   | [Unsplash](https://unsplash.com/photos/jVb0mSn0LbE) |
| 22        | Alejandro Escamilla   | [Unsplash](https://unsplash.com/photos/du_OrQAA4r0) |
| 23        | Alejandro Escamilla   | [Unsplash](https://unsplash.com/photos/8yqds_91OLw) |
| 24        | Alejandro Escamilla   | [Unsplash](https://unsplash.com/photos/cZhUxIQjILg) |
| 25        | Alejandro Escamilla   | [Unsplash](https://unsplash.com/photos/Iuq0EL4EINY) |
| 27        | Yoni Kaplan-Nadel     | [Unsplash](https://unsplash.com/photos/iJnZwLBOB1I) |
| 28        | Jerry Adney           | [Unsplash](https://unsplash.com/photos/_WiFMBRT7Aw) |
| 29        | Go Wild               | [Unsplash](https://unsplash.com/photos/V0yAek6BgGk) |
| 30        | Shyamanta Baruah      | [Unsplash](https://unsplash.com/photos/aeVA-j1y2BY) |
| 36        | Vadim Sherbakov       | [Unsplash](https://unsplash.com/photos/osSryggkso4) |
| 37        | Austin Neill          | [Unsplash](https://unsplash.com/photos/erTjj730fMk) |
| 42        | Luke Chesser          | [Unsplash](https://unsplash.com/photos/KR2mdHJ5qMg) |
| 43        | Oleg Chursin          | [Unsplash](https://unsplash.com/photos/IoCWq07GaG4) |
| 49        | Margaret Barley       | [Unsplash](https://unsplash.com/photos/Qo51KwK1dKg) |
| 50        | Tyler Wanlass         | [Unsplash](https://unsplash.com/photos/L7MpmBGpM94) |
| 54        | Nicholas Swanson      | [Unsplash](https://unsplash.com/photos/d19by2PLaPc) |
| 57        | Nicholas Swanson      | [Unsplash](https://unsplash.com/photos/SyBYM8R6VU4) |
| 58        | Tony Naccarato        | [Unsplash](https://unsplash.com/photos/-kEr-QltARg) |
| 64        | Alexander Shustov     | [Unsplash](https://unsplash.com/photos/AHBiSKaENwc) |
| 65        | Alexander Shustov     | [Unsplash](https://unsplash.com/photos/2FrX56QL7P8) |
| 76        | Alexander Shustov     | [Unsplash](https://unsplash.com/photos/OxzhYtL-00Y) |
| 82        | Rula Sibai            | [Unsplash](https://unsplash.com/photos/-vq7mi4oF0s) |
| 84        | Johnny Lam            | [Unsplash](https://unsplash.com/photos/63qfL0TciY8) |
| 96        | Pawel Kadysz          | [Unsplash](https://unsplash.com/photos/CuFYW1c97w8) |
| 101       | Christian Bardenhorst | [Unsplash](https://unsplash.com/photos/8lMhzUjD1Wk) |
| 103       | Ilham Rahmansyah      | [Unsplash](https://unsplash.com/photos/DwTZwZYi9Ww) |
| 104       | Dyaa Eldin            | [Unsplash](https://unsplash.com/photos/2fl-ocJ5MOA) |
| 106       | Arvee Marie           | [Unsplash](https://unsplash.com/photos/YnfGtpt2gf4) |
| 108       | Florian Klauer        | [Unsplash](https://unsplash.com/photos/t1mqA3V3-7g) |
| 110       | Kenneth Thewissen     | [Unsplash](https://unsplash.com/photos/D76DklsG-5U) |
| 116       | Anton Sulsky          | [Unsplash](https://unsplash.com/photos/YcfCXxo7rpc) |
| 122       | Vadim Sherbakov       | [Unsplash](https://unsplash.com/photos/xS_RzdD5CFE) |
| 125       | Rick Waalders         | [Unsplash](https://unsplash.com/photos/3HlgJNdnD7I) |
| 129       | Charlie Foster        | [Unsplash](https://unsplash.com/photos/A88emaZe7d8) |
| 133       | Dietmar Becker        | [Unsplash](https://unsplash.com/photos/8Zt0xOOK4nI) |
| 142       | Vadim Sherbakov       | [Unsplash](https://unsplash.com/photos/KSyemQIWwP8) |
| 146       | Florian Klauer        | [Unsplash](https://unsplash.com/photos/GG0jOrmwqtw) |
| 151       | Edoardo Loru          | [Unsplash](https://unsplash.com/photos/xPfj_Kdcal4) |
| 152       | Steven Spassov        | [Unsplash](https://unsplash.com/photos/tVIqMgGlAG0) |
| 164       | Linh Nguyen           | [Unsplash](https://unsplash.com/photos/agkblvPff5U) |
| 167       | petradr               | [Unsplash](https://unsplash.com/photos/WqK_xV_hbug) |
| 177       | Danka & Peter         | [Unsplash](https://unsplash.com/photos/tvicgTdh7Fg) |
| 180       | Galymzhan Abdugalimov | [Unsplash](https://unsplash.com/photos/ICW6QYOcdlg) |
| 188       | Wojtek Witkowski      | [Unsplash](https://unsplash.com/photos/1fpyA_z2woY) |
| 191       | Alex Talmon           | [Unsplash](https://unsplash.com/photos/6iat9p85VnQ) |
| 193       | Vadim Sherbakov       | [Unsplash](https://unsplash.com/photos/d6ebY-faOO0) |
| 195       | Matthew Skinner       | [Unsplash](https://unsplash.com/photos/t05kfHeygbE) |
| 201       | Craig Garner          | [Unsplash](https://unsplash.com/photos/YoadQb46v6k) |
| 206       | Philipp Reiner        | [Unsplash](https://unsplash.com/photos/qPJ6eRAMmCM) |
| 214       | Kelly Sikkema         | [Unsplash](https://unsplash.com/photos/Ereoqdv5s48) |
