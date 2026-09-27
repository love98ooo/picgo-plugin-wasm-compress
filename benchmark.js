'use strict'

const fs = require('node:fs/promises')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { performance } = require('node:perf_hooks')
const { formatOf, decode, encodeWebp, encodeAvifFrames } = require('./codecs')
const { mux } = require('./avif-sequence')

const AVIF_QUALITY = 62
const AVIF_SPEED = 6
const WEBP_QUALITY = 82

function options(args) {
  const files = []
  let runs = 3
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--runs') runs = Number(args[++i])
    else files.push(args[i])
  }
  if (!files.length || !Number.isInteger(runs) || runs < 1 || runs > 10) {
    throw new Error('用法: npm run bench -- [--runs 1..10] image1.png image2.gif ...')
  }
  return { files, runs }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function psnr(error, samples) {
  if (!samples) return 'n/a'
  if (error === 0) return '∞'
  return (10 * Math.log10(255 ** 2 / (error / samples))).toFixed(1)
}

async function quality(image, result) {
  const decoded = result.stills
    ? { frames: [] }
    : await decode(result.buffer, 'webp')
  if (result.stills) {
    for (const still of result.stills) decoded.frames.push((await decode(still, 'avif')).frames[0])
  }
  if (decoded.frames.length !== image.frames.length) return { rgb: 'n/a', alpha: 'n/a' }
  let rgbError = 0; let rgbSamples = 0; let alphaError = 0; let alphaSamples = 0
  for (let f = 0; f < image.frames.length; f++) {
    const source = image.frames[f].data
    const output = decoded.frames[f].data
    if (source.length !== output.length) return { rgb: 'n/a', alpha: 'n/a' }
    for (let i = 0; i < source.length; i += 4) {
      const weight = source[i + 3] / 255
      for (let channel = 0; channel < 3; channel++) {
        rgbError += weight * (source[i + channel] - output[i + channel]) ** 2
        rgbSamples += weight
      }
      alphaError += (source[i + 3] - output[i + 3]) ** 2
      alphaSamples++
    }
  }
  return { rgb: psnr(rgbError, rgbSamples), alpha: psnr(alphaError, alphaSamples) }
}

async function encode(image, format) {
  if (format === 'webp') return { buffer: await encodeWebp(image, WEBP_QUALITY) }
  const stills = await encodeAvifFrames(image, AVIF_QUALITY, AVIF_SPEED)
  const buffer = stills.length === 1 ? stills[0]
    : mux(stills, image.width, image.height, image.frames.map(frame => frame.duration), image.repetitions)
  return { buffer, stills }
}

async function benchmark(file, runs) {
  const source = await fs.readFile(file)
  const format = formatOf(source)
  if (!format || (format === 'avif' && source.toString('ascii', 8, 12) === 'avis')) {
    console.log(`\n${file}: 不支持的输入，跳过`)
    return
  }
  const started = performance.now()
  const image = await decode(source, format)
  const decodeMs = performance.now() - started
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12)
  const duration = image.frames.length > 1 ? image.frames.reduce((sum, frame) => sum + frame.duration, 0) : 0
  console.log(`\n${file}`)
  console.log(`输入: ${format}, ${image.width}×${image.height}, ${image.frames.length} 帧, ${duration} ms, ${source.length} B, SHA-256 ${hash}…`)
  console.log(`输入解码: ${decodeMs.toFixed(1)} ms`)
  console.log('格式   输出(B)    节省     首次编码(ms)  后续中位数(ms)  RGB PSNR(dB)  Alpha PSNR(dB)')
  const results = {}
  for (const target of ['avif', 'webp']) {
    try {
      const firstStart = performance.now()
      const result = await encode(image, target)
      const firstMs = performance.now() - firstStart
      const times = []
      for (let i = 0; i < runs; i++) {
        const start = performance.now()
        await encode(image, target)
        times.push(performance.now() - start)
      }
      const score = await quality(image, result)
      const saving = 100 * (1 - result.buffer.length / source.length)
      results[target] = { size: result.buffer.length, saving }
      console.log(`${target.padEnd(6)} ${String(result.buffer.length).padStart(9)} ${`${saving.toFixed(1)}%`.padStart(8)} ${firstMs.toFixed(1).padStart(14)} ${median(times).toFixed(1).padStart(17)} ${score.rgb.padStart(13)} ${score.alpha.padStart(15)}`)
    } catch (error) { console.log(`${target}: 失败 (${error.message})`) }
  }
  const selected = results.avif?.saving >= 1 ? 'avif' : results.webp?.saving >= 1 ? 'webp' : '原图'
  console.log(`默认策略: ${selected}（至少节省 1%）`)
}

async function main() {
  const { files, runs } = options(process.argv.slice(2))
  console.log(`时间: ${new Date().toISOString()}`)
  console.log(`环境: Node ${process.version}, ${process.platform}/${process.arch}, ${os.cpus()[0]?.model || 'unknown CPU'}`)
  console.log(`参数: AVIF Q${AVIF_QUALITY} speed ${AVIF_SPEED}; WebP Q${WEBP_QUALITY}; 首次编码 + 后续 ${runs} 次取中位数`)
  console.log('编码时间不含输入解码、画质评估和文件写入。PSNR 比较的是解码后的输入与输出，越高越接近输入。')
  for (const file of files) await benchmark(file, runs)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
