# picgo-plugin-wasm-compress

PicGo 上传前压缩图片的插件。编码在本机完成，运行依赖只有 JavaScript 与 WebAssembly；无需 Sharp、系统命令、Rosetta 或按操作系统下载的可执行文件。

## 功能

- 输入：JPEG、PNG/APNG、GIF、WebP 动图或静图、静态 AVIF。
- 输出：AVIF 或 WebP；动图默认输出 AVIF，保留帧时长、透明度和循环次数。
- 默认先尝试 AVIF；如果 AVIF 编码失败或未比原图小，再尝试 WebP。都不合算时保留原文件。
- `auto` 模式同时编码 AVIF 和 WebP，从符合最低节省比例的结果中选体积更小的。
- JPEG 会在转码前应用 EXIF 方向。元数据不会复制到压缩结果。
- 对输入的 AVIF 动图直接保留原文件，避免当前 WASM 解码器只解出首帧造成动画丢失。

## 开发和安装

要求 PicGo 使用 Node.js 20.9 或更新版本。

```sh
cd ~/Projects/picgo-plugin-wasm-compress
npm install
npm test
```

PicGo 2.3.0+ 的 GUI 可在「插件设置」中导入本地插件文件夹，选择 `~/Projects/picgo-plugin-wasm-compress`。或者在 PicGo 配置文件所在的目录执行 `npm install ~/Projects/picgo-plugin-wasm-compress`。安装后需要**完全退出并重新启动** PicGo 才能加载修改。详见 [PicGo 官方本地插件开发文档](https://docs.picgo.app/core/dev-guide/deploy)。

**暂未发布到 npm。** `package.json` 保留 `private: true`，避免误发布。

## 配置

| 名称 | 默认 | 说明 |
| --- | --- | --- |
| `format` | `avif` | 静图：`avif` / `webp` / `auto` / `keep` |
| `animatedFormat` | `avif` | 动图：`avif` / `webp` / `auto` / `keep` |
| `preset` | `balanced` | AVIF 编码速度：`fast` / `balanced` / `small`；越慢通常体积越小 |
| `avifQuality` | `62` | AVIF 画质 1–100 |
| `webpQuality` | `82` | WebP 画质 1–100 |
| `minSavingPercent` | `1` | 压缩至少节省该比例才替换原图 |
| `maxFrames` | `200` | 超过此帧数时跳过 |
| `maxPixels` | `16000000` | 单帧超过此像素数时跳过 |

`keep` 会优化原本就是 AVIF 或 WebP 的文件。输入格式为 JPEG、PNG 或 GIF 时保留原文件，因为本插件的编码器只输出 AVIF/WebP。

可以用自己的图片比较体积和耗时：

```sh
npm run bench -- /path/to/photo.jpg /path/to/animation.gif
```

## 取舍

纯 WASM 兼容性好，但速度通常慢于同设备上的原生编码器。动图 AVIF 使用逐帧 AV1 编码与 JS 容器封装，保留帧时长和循环，但通常不及使用帧间预测的 AV1 视频编码器省空间。默认选 AVIF 是格式偏好，并不保证它对每张图都是最小或最快；可以用 `auto` 比较文件体积，用 `fast` 缩短编码时间。

对动画、EXIF 方向以及保留原图的情况有自动测试。项目创建时还用 libavif 的 `avifdec --info` 独立验证了 AVIF 动图的帧数、100/200 ms 时长、透明通道，以及无限/有限循环。这个命令只用于开发验证，不是运行依赖。
