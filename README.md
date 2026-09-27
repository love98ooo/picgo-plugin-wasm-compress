# picgo-plugin-wasm-compress

PicGo 上传前图片压缩插件，使用 JavaScript 和 WebAssembly，在各平台运行时无需原生模块或外部编码器。

## 支持范围

| 输入 | 输出 |
| --- | --- |
| JPEG、PNG、静态 AVIF、静态 WebP | AVIF 或 WebP |
| GIF、APNG、动态 WebP | 动态 AVIF 或动态 WebP |

默认输出 AVIF；如果编码失败或未达到最小节省比例，会尝试 WebP，仍不合算则保留原图。`auto` 会同时编码两种格式并选较小结果。动图保留帧时长、透明度和循环次数；JPEG 会先应用 EXIF 方向。

## 安装

要求 Node.js 20.9+ 和 PicGo 2.3.0+。在 PicGo「插件设置」搜索 `wasm-compress` 并安装，随后完全退出并重启 PicGo。PicGo CLI 可运行：

```sh
picgo install wasm-compress
```

从源码测试时，在项目目录运行 `npm ci` 和 `npm test`，再按 [PicGo 本地插件文档](https://docs.picgo.app/core/dev-guide/deploy)导入项目文件夹。

## 配置

| 配置项 | 默认值 | 作用 |
| --- | --- | --- |
| `format` | `avif` | 静图输出：`avif`、`webp`、`auto`、`keep` |
| `animatedFormat` | `avif` | 动图输出：`avif`、`webp`、`auto`、`keep` |
| `preset` | `balanced` | AVIF 速度档：`fast`、`balanced`、`small` |
| `avifQuality` | `62` | AVIF 画质，1–100 |
| `webpQuality` | `82` | WebP 画质，1–100 |
| `minSavingPercent` | `1` | 至少节省的百分比 |
| `maxFrames` | `200` | 动图帧数上限 |
| `maxPixels` | `16000000` | 单帧像素上限 |

`keep` 仅重压原本就是 AVIF/WebP 的图片；其他格式保持原文件。

## Benchmark

在源码仓库中可生成样本，也可以直接传入自己的图片：

```sh
node benchmarks/make-fixtures.js
npm run bench -- benchmarks/generated/photo-like.jpg benchmarks/generated/screenshot.png benchmarks/generated/motion.gif
npm run bench -- /path/to/your-image.jpg
```

输出包含原图与两种格式的体积、节省比例、首次和后续编码耗时、RGB/Alpha PSNR、运行环境和实际采用的格式。方法与一组可复现结果见 [BENCHMARK.md](BENCHMARK.md)。

## 限制

- 输入的动态 AVIF 原样保留；当前 WASM 解码器只提供首帧解码。
- 动态 AVIF 逐帧编码，不使用帧间预测；某些动画的 WebP 会更小、更快。
- 转码后不复制原文件的 EXIF、ICC 等元数据。
