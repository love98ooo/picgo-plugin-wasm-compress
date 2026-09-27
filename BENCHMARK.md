# Benchmark

## 方法

使用 `node benchmarks/make-fixtures.js` 生成三张确定性的合成样本，再运行：

```sh
npm ci
node benchmarks/make-fixtures.js
npm run bench -- --runs 3 benchmarks/generated/photo-like.jpg benchmarks/generated/screenshot.png benchmarks/generated/motion.gif
```

编码参数与插件默认值相同：AVIF quality 62、speed 6；WebP quality 82。每种格式先测第一次编码，再运行 3 次并取耗时中位数。编码计时不含输入解码、输出解码、画质计算和文件写入。体积按最终 AVIF/WebP 文件计；节省比例以原文件字节数计算。RGB PSNR 比较解码后的输入与输出，对透明像素按源 Alpha 加权；Alpha PSNR 单独计算。PSNR 越高表示像素越接近输入，但不能替代主观画质评估。

样本分别模拟带细噪声的照片、纯色块和文字条组成的界面、以及高频调色板动图。它们只用于回归与复现，不代表真实照片或所有动图的性能。

## 一次实测

2026-09-27，Apple M2，macOS arm64，Node.js v26.9.0。输入 SHA-256 前 12 位分别为 `35e23bfb4cb1`、`d3d7019d7916`、`14e3a61d2393`；输入解码分别耗时 31.7、11.0、29.0 ms。

| 输入 | 原图 | 输出 | 输出大小 | 节省 | 首次编码 | 后续中位数 | RGB PSNR |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| photo-like.jpg，640×480 | 141,506 B | AVIF | 89,845 B | 36.5% | 436.6 ms | 346.5 ms | 36.6 dB |
|  |  | WebP | 103,014 B | 27.2% | 90.3 ms | 68.5 ms | 36.2 dB |
| screenshot.png，640×360 | 984 B | AVIF | 687 B | 30.2% | 216.3 ms | 189.0 ms | 46.2 dB |
|  |  | WebP | 1,716 B | −74.4% | 30.7 ms | 17.4 ms | 45.1 dB |
| motion.gif，256×192、8 帧 | 77,269 B | 动态 AVIF | 106,033 B | −37.2% | 914.5 ms | 983.3 ms | 20.3 dB |
|  |  | 动态 WebP | 31,532 B | 59.2% | 33.1 ms | 22.9 ms | 20.2 dB |

这组样本中，默认策略对照片和界面选 AVIF，对动图选 WebP。三个样本的 Alpha PSNR 均为 ∞，因为源与输出均完全不透明。请用自己的图片复测，再调整质量和速度档位。
