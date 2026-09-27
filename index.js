'use strict'

const path = require('node:path')
const { formatOf, decode, encodeWebp, encodeAvifFrames } = require('./codecs')
const { mux } = require('./avif-sequence')

const PLUGIN = 'picgo-plugin-wasm-compress'
const DEFAULTS = {
  format: 'avif',
  animatedFormat: 'avif',
  preset: 'balanced',
  avifQuality: 62,
  webpQuality: 82,
  minSavingPercent: 1,
  maxFrames: 200,
  maxPixels: 16000000
}
const SPEED = { fast: 9, balanced: 6, small: 3 }

function settings(ctx) {
  const config = { ...DEFAULTS, ...(ctx.getConfig(PLUGIN) || {}) }
  for (const key of ['format', 'animatedFormat']) {
    if (!['avif', 'webp', 'auto', 'keep'].includes(config[key])) config[key] = DEFAULTS[key]
  }
  if (!Object.hasOwn(SPEED, config.preset)) config.preset = DEFAULTS.preset
  for (const [key, min, max] of [
    ['avifQuality', 1, 100], ['webpQuality', 1, 100],
    ['minSavingPercent', 0, 99], ['maxFrames', 2, 1000], ['maxPixels', 1000, 100000000]
  ]) {
    const value = Number(config[key])
    config[key] = Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : DEFAULTS[key]
  }
  return config
}

function inputBuffer(item) {
  if (Buffer.isBuffer(item.buffer)) return item.buffer
  if (typeof item.base64Image !== 'string') return null
  const data = item.base64Image.replace(/^data:[^,]*;base64,/, '')
  return /^[A-Za-z0-9+/\s]*={0,2}$/.test(data) ? Buffer.from(data, 'base64') : null
}

function candidates(mode, original) {
  if (mode === 'keep') return original === 'avif' || original === 'webp' ? [original] : []
  if (mode === 'auto') return ['avif', 'webp']
  return [mode, mode === 'avif' ? 'webp' : 'avif']
}

async function encode(image, format, config) {
  if (format === 'webp') return encodeWebp(image, config.webpQuality)
  const stills = await encodeAvifFrames(image, config.avifQuality, SPEED[config.preset])
  return image.frames.length === 1 ? stills[0] : mux(stills, image.width, image.height, image.frames.map(frame => frame.duration), image.repetitions)
}

async function handle(ctx) {
  const config = settings(ctx)
  for (const item of ctx.output || []) {
    const source = inputBuffer(item)
    const original = source && formatOf(source)
    if (!original) continue
    try {
      // The current WASM AVIF decoder returns only the first frame. Never flatten an input sequence.
      if (original === 'avif' && source.toString('ascii', 8, 12) === 'avis') continue
      const image = await decode(source, original)
      if (image.width * image.height > config.maxPixels || image.frames.length > config.maxFrames) {
        ctx.log.warn(`[wasm-compress] 跳过超出限制的图片: ${item.fileName || 'image'}`)
        continue
      }
      const mode = image.frames.length > 1 ? config.animatedFormat : config.format
      let best = { buffer: source, format: original }
      for (const format of candidates(mode, original)) {
        try {
          const output = await encode(image, format, config)
          if (output && output.length < best.buffer.length) best = { buffer: output, format }
          if (mode !== 'auto' && best.format === mode) break
        } catch (error) {
          ctx.log.warn(`[wasm-compress] ${format}: ${error.message}`)
        }
      }
      const saving = 100 * (1 - best.buffer.length / source.length)
      if (best.buffer === source || saving < config.minSavingPercent) continue
      const basename = path.parse(item.fileName || `image.${original}`).name || 'image'
      item.buffer = best.buffer
      delete item.base64Image
      item.fileName = `${basename}.${best.format}`
      item.extname = `.${best.format}`
      item.width = image.width
      item.height = image.height
      ctx.log.info(`[wasm-compress] ${item.fileName}: ${source.length} -> ${best.buffer.length} bytes (${saving.toFixed(1)}%)`)
    } catch (error) {
      ctx.log.warn(`[wasm-compress] 跳过 ${item.fileName || 'image'}: ${error.message}`)
    }
  }
  return ctx
}

function configFields(ctx) {
  const saved = settings(ctx)
  return [
    { name: 'format', type: 'list', alias: '静态图输出', choices: ['avif', 'webp', 'auto', 'keep'], default: saved.format },
    { name: 'animatedFormat', type: 'list', alias: '动图输出', choices: ['avif', 'webp', 'auto', 'keep'], default: saved.animatedFormat },
    { name: 'preset', type: 'list', alias: 'AVIF 编码速度', choices: ['fast', 'balanced', 'small'], default: saved.preset },
    { name: 'avifQuality', type: 'input', alias: 'AVIF 画质 (1-100)', default: String(saved.avifQuality) },
    { name: 'webpQuality', type: 'input', alias: 'WebP 画质 (1-100)', default: String(saved.webpQuality) },
    { name: 'minSavingPercent', type: 'input', alias: '最小节省百分比', default: String(saved.minSavingPercent) },
    { name: 'maxFrames', type: 'input', alias: '动图最大帧数', default: String(saved.maxFrames) },
    { name: 'maxPixels', type: 'input', alias: '单帧最大像素', default: String(saved.maxPixels) }
  ]
}

module.exports = ctx => ({
  register() { ctx.helper.beforeUploadPlugins.register('wasm-compress', { handle }) },
  config: configFields
})
module.exports.handle = handle
