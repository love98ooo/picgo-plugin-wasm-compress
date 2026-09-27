'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const jpeg = require('jpeg-js')
const exif = require('exif-parser')
const UPNG = require('upng-js')
const { parseGIF, decompressFrames } = require('gifuct-js')

let avifEncoder
let avifDecoder
let webpCodec

function arrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

async function avifEncode() {
  if (!avifEncoder) avifEncoder = (async () => {
    const codec = await import('@jsquash/avif/encode.js')
    const file = path.join(path.dirname(require.resolve('@jsquash/avif/package.json')), 'codec/enc/avif_enc.wasm')
    await codec.init(await WebAssembly.compile(await fs.readFile(file)))
    return codec.default
  })()
  return avifEncoder
}

async function avifDecode() {
  if (!avifDecoder) avifDecoder = (async () => {
    const codec = await import('@jsquash/avif/decode.js')
    const file = path.join(path.dirname(require.resolve('@jsquash/avif/package.json')), 'codec/dec/avif_dec.wasm')
    await codec.init(await WebAssembly.compile(await fs.readFile(file)))
    return codec.default
  })()
  return avifDecoder
}

async function webp() {
  if (!webpCodec) webpCodec = (async () => {
    // wasm-webp's package entry is CJS inside a type:module package. Its ESM
    // WASM factory is valid in Node and avoids the broken package entry.
    const file = path.join(path.dirname(require.resolve('wasm-webp/package.json')), 'dist/esm/webp-wasm.js')
    const { default: create } = await import(pathToFileURL(file).href)
    return create()
  })()
  return webpCodec
}

function formatOf(bytes) {
  if (bytes.subarray(0, 3).toString('ascii') === 'GIF') return 'gif'
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  if (bytes.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(bytes.toString('ascii', 8, 32))) return 'avif'
  return null
}

function decodeGif(bytes) {
  const gif = parseGIF(arrayBuffer(bytes))
  const width = gif.lsd.width
  const height = gif.lsd.height
  const patches = decompressFrames(gif, true)
  const loopBlock = gif.frames.find(frame => frame.application?.id === 'NETSCAPE2.0')?.application.blocks
  const gifLoops = loopBlock?.[0] === 1 ? loopBlock[1] | (loopBlock[2] << 8) : null
  const canvas = new Uint8Array(width * height * 4)
  const frames = []
  let previous = null
  let restore = null
  for (const frame of patches) {
    if (previous?.disposalType === 2) {
      const { left, top, width: w, height: h } = previous.dims
      for (let y = top; y < Math.min(height, top + h); y++) canvas.fill(0, (y * width + left) * 4, (y * width + Math.min(width, left + w)) * 4)
    } else if (previous?.disposalType === 3 && restore) canvas.set(restore)
    restore = frame.disposalType === 3 ? canvas.slice() : null
    const { left, top, width: w, height: h } = frame.dims
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const destX = left + x; const destY = top + y
      if (destX >= width || destY >= height) continue
      const src = (y * w + x) * 4; const dst = (destY * width + destX) * 4
      if (frame.patch[src + 3]) canvas.set(frame.patch.subarray(src, src + 4), dst)
    }
    frames.push({ data: canvas.slice(), duration: Math.max(10, frame.delay || 100) })
    previous = frame
  }
  return { width, height, frames, repetitions: gifLoops == null ? 0 : gifLoops === 0 ? -1 : gifLoops }
}

function webpChunk(bytes, name) {
  for (let p = 12; p + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(p + 4)
    if (bytes.toString('ascii', p, p + 4) === name) return p
    p += 8 + size + (size & 1)
  }
  return -1
}

function orientJpeg(image, orientation) {
  if (orientation < 2 || orientation > 8) return image
  const { width, height, data } = image
  const swap = orientation >= 5
  const outWidth = swap ? height : width
  const outHeight = swap ? width : height
  const pixels = new Uint8Array(data.length)
  for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
    const [sx, sy] = {
      2: [width - 1 - x, y], 3: [width - 1 - x, height - 1 - y], 4: [x, height - 1 - y],
      5: [y, x], 6: [y, height - 1 - x], 7: [width - 1 - y, height - 1 - x], 8: [width - 1 - y, x]
    }[orientation]
    const src = (sy * width + sx) * 4
    pixels.set(data.subarray(src, src + 4), (y * outWidth + x) * 4)
  }
  return { width: outWidth, height: outHeight, data: pixels }
}

async function decode(bytes, format) {
  if (format === 'gif') return decodeGif(bytes)
  if (format === 'png') {
    const image = UPNG.decode(arrayBuffer(bytes))
    const pixels = UPNG.toRGBA8(image)
    const plays = image.tabs?.acTL?.num_plays
    return { width: image.width, height: image.height, repetitions: plays == null ? 0 : plays === 0 ? -1 : plays - 1,
      frames: pixels.map((data, i) => ({
      data: new Uint8Array(data), duration: Math.max(1, image.frames?.[i]?.delay || 100)
      })) }
  }
  if (format === 'jpeg') {
    let orientation = 1
    try { orientation = exif.create(bytes).parse().tags.Orientation || 1 } catch {}
    const image = orientJpeg(jpeg.decode(bytes, { useTArray: true }), orientation)
    return { width: image.width, height: image.height, frames: [{ data: image.data, duration: 100 }] }
  }
  if (format === 'webp') {
    const codec = await webp()
    const anim = webpChunk(bytes, 'ANIM')
    const animated = anim >= 0
    if (animated) {
      const frames = codec.decodeAnimation(bytes, true)
      if (!frames?.length) throw new Error('WebP 动图解码失败')
      const plays = bytes.readUInt16LE(anim + 12)
      return { width: frames[0].width, height: frames[0].height, repetitions: plays === 0 ? -1 : plays - 1,
        frames: frames.map(frame => ({ data: frame.data, duration: Math.max(1, frame.duration) })) }
    }
    const image = codec.decodeRGBA(bytes)
    if (!image) throw new Error('WebP 解码失败')
    return { width: image.width, height: image.height, frames: [{ data: image.data, duration: 100 }] }
  }
  if (format === 'avif') {
    const image = await (await avifDecode())(arrayBuffer(bytes))
    return { width: image.width, height: image.height, frames: [{ data: image.data, duration: 100 }] }
  }
  throw new Error(`不支持 ${format}`)
}

async function encodeWebp(image, quality) {
  const codec = await webp()
  const config = { lossless: 0, quality }
  if (image.frames.length === 1) return Buffer.from(codec.encode(image.frames[0].data, image.width, image.height, true, config))
  const vector = new codec.VectorWebPAnimationFrame()
  for (const frame of image.frames) vector.push_back({ data: frame.data, duration: frame.duration, config, has_config: true })
  const result = codec.encodeAnimation(image.width, image.height, true, vector)
  if (!result) throw new Error('WebP 动图编码失败')
  const bytes = Buffer.from(result)
  // wasm-webp omits the final WebPAnimEncoderAdd(NULL, final_timestamp),
  // so its last frame inherits the preceding duration. Patch that ANMF field.
  let last = -1
  let count = 0
  for (let p = 12; p + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(p + 4)
    if (bytes.toString('ascii', p, p + 4) === 'ANMF') { last = p; count++ }
    p += 8 + size + (size & 1)
  }
  if (count !== image.frames.length) throw new Error('WebP 编码器合并了动图帧')
  if (last >= 0) {
    const ms = Math.min(0xffffff, Math.max(1, image.frames.at(-1).duration))
    bytes[last + 20] = ms & 255; bytes[last + 21] = (ms >> 8) & 255; bytes[last + 22] = (ms >> 16) & 255
  }
  const anim = webpChunk(bytes, 'ANIM')
  if (anim >= 0) {
    const plays = image.repetitions == null || image.repetitions < 0 ? 0 : Math.min(65535, image.repetitions + 1)
    bytes.writeUInt16LE(plays, anim + 12)
  }
  return bytes
}

async function encodeAvifFrames(image, quality, speed) {
  const encodeFrame = await avifEncode()
  const frames = []
  for (const frame of image.frames) {
    const data = new Uint8ClampedArray(frame.data)
    const bytes = await encodeFrame({ data, width: image.width, height: image.height }, { quality, qualityAlpha: quality, speed })
    frames.push(Buffer.from(bytes))
  }
  return frames
}

module.exports = { formatOf, decode, encodeWebp, encodeAvifFrames }
