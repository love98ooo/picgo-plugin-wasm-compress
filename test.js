'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const UPNG = require('upng-js')
const jpeg = require('jpeg-js')
const { GifWriter } = require('omggif')
const plugin = require('./')
const { decode, encodeWebp } = require('./codecs')

function context(output, config = {}) {
  const warnings = []
  const ctx = {
    output,
    getConfig: () => config,
    log: { info() {}, warn(message) { warnings.push(message) } },
    helper: { beforeUploadPlugins: { register(id, hook) { ctx.hook = hook; ctx.id = id } } }
  }
  plugin(ctx).register()
  return { ctx, warnings }
}

function pixels(width, height, frame = 0) {
  const data = new Uint8Array(width * height * 4)
  let seed = 1234567 + frame
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const noise = (seed >>> 24) - 128
    const i = (y * width + x) * 4
    data[i] = (x + y + noise / 2 + frame * 50) & 255
    data[i + 1] = (x * 3 + y * 2 + noise / 3 + frame * 30) & 255
    data[i + 2] = (x * 4 + y * 3 + noise / 4 + frame * 20) & 255
    data[i + 3] = 255
  }
  return data
}

function gif(width, height) {
  const buf = Buffer.alloc(width * height * 4)
  const palette = Array.from({ length: 256 }, (_, i) => (i << 16) | (((i * 3) & 255) << 8) | ((i * 7) & 255))
  const writer = new GifWriter(buf, width, height, { palette, loop: 0 })
  for (let frame = 0; frame < 2; frame++) {
    let seed = 24681357 + frame
    const indexes = Uint8Array.from({ length: width * height }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed >>> 24
    })
    writer.addFrame(0, 0, width, height, indexes, { delay: frame ? 20 : 10 })
  }
  return buf.subarray(0, writer.end())
}

test('registers and compresses PNG to static AVIF', async () => {
  const source = Buffer.from(UPNG.encode([pixels(256, 256).buffer], 256, 256, 0))
  const item = { buffer: source, fileName: 'sample.png', extname: '.png' }
  const { ctx, warnings } = context([item])
  assert.equal(ctx.id, 'wasm-compress')
  await ctx.hook.handle(ctx)
  assert.equal(item.extname, '.avif', warnings.join('\n'))
  assert.ok(item.buffer.length < source.length)
  const decoded = await decode(item.buffer, 'avif')
  assert.equal(decoded.width, 256)
  assert.equal(decoded.frames.length, 1)
})

test('converts animated GIF to AVIF with two frames', async () => {
  const source = gif(256, 256)
  const item = { buffer: source, fileName: 'moving.gif', extname: '.gif' }
  const { ctx, warnings } = context([item])
  await ctx.hook.handle(ctx)
  assert.equal(item.extname, '.avif', warnings.join('\n'))
  assert.equal(item.buffer.toString('ascii', 8, 12), 'avis')
  assert.ok(item.buffer.includes(Buffer.from('stts')))
  assert.ok(item.buffer.length < source.length)
})

test('converts animated GIF to WebP and preserves frame durations', async () => {
  const source = gif(256, 256)
  const item = { buffer: source, fileName: 'moving.gif', extname: '.gif' }
  const { ctx, warnings } = context([item], { animatedFormat: 'webp' })
  await ctx.hook.handle(ctx)
  assert.equal(item.extname, '.webp', warnings.join('\n'))
  const decoded = await decode(item.buffer, 'webp')
  assert.deepEqual(decoded.frames.map(frame => frame.duration), [100, 200])
  assert.equal(decoded.repetitions, -1)
})

test('decodes APNG frames and their delays', async () => {
  const source = Buffer.from(UPNG.encode([pixels(128, 128, 0).buffer, pixels(128, 128, 1).buffer], 128, 128, 0, [90, 210]))
  const image = await decode(source, 'png')
  assert.deepEqual(image.frames.map(frame => frame.duration), [90, 210])
  assert.equal(image.repetitions, -1)
})

test('applies JPEG EXIF orientation before compressing', async () => {
  const raw = jpeg.encode({ data: pixels(3, 2), width: 3, height: 2 }, 90).data
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0])
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff])
  const length = Buffer.alloc(2); length.writeUInt16BE(payload.length + 2)
  const source = Buffer.concat([raw.subarray(0, 2), Buffer.from([0xff, 0xe1]), length, payload, raw.subarray(2)])
  const image = await decode(source, 'jpeg')
  assert.equal(image.width, 2)
  assert.equal(image.height, 3)
})

test('converts animated WebP input without dropping frames', async () => {
  const image = { width: 256, height: 256, frames: [
    { data: pixels(256, 256, 0), duration: 100 },
    { data: pixels(256, 256, 1), duration: 200 }
  ] }
  const source = await encodeWebp(image, 95)
  const item = { buffer: source, fileName: 'moving.webp', extname: '.webp' }
  const { ctx, warnings } = context([item], { animatedFormat: 'webp', webpQuality: 60 })
  await ctx.hook.handle(ctx)
  assert.equal(item.extname, '.webp', warnings.join('\n'))
  assert.ok(item.buffer.length < source.length)
  const decoded = await decode(item.buffer, 'webp')
  assert.deepEqual(decoded.frames.map(frame => frame.duration), [100, 200])
})

test('rejects a WebP encoder result that merges animation frames', async () => {
  const data = pixels(32, 32)
  await assert.rejects(() => encodeWebp({ width: 32, height: 32, frames: [
    { data, duration: 100 }, { data: data.slice(), duration: 200 }
  ] }, 82), /合并了动图帧/)
})

test('keeps a tiny original when no candidate saves space', async () => {
  const source = Buffer.from(UPNG.encode([pixels(1, 1).buffer], 1, 1, 0))
  const item = { buffer: source, fileName: 'tiny.png', extname: '.png' }
  const { ctx } = context([item])
  await ctx.hook.handle(ctx)
  assert.strictEqual(item.buffer, source)
  assert.equal(item.fileName, 'tiny.png')
})
