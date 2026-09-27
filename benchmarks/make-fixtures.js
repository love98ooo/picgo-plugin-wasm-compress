'use strict'

const fs = require('node:fs')
const path = require('node:path')
const jpeg = require('jpeg-js')
const UPNG = require('upng-js')
const { GifWriter } = require('omggif')

const output = path.join(__dirname, 'generated')
fs.mkdirSync(output, { recursive: true })

function save(name, bytes) {
  fs.writeFileSync(path.join(output, name), bytes)
  console.log(`${name}: ${bytes.length} B`)
}

const photoWidth = 640; const photoHeight = 480
const photo = new Uint8Array(photoWidth * photoHeight * 4)
let seed = 20260927
for (let y = 0; y < photoHeight; y++) for (let x = 0; x < photoWidth; x++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  const noise = (seed >>> 24) - 128
  const i = (y * photoWidth + x) * 4
  const sky = y < 245 + 18 * Math.sin(x / 70)
  photo[i] = Math.max(0, Math.min(255, (sky ? 80 : 55) + x / 8 + noise / 5))
  photo[i + 1] = Math.max(0, Math.min(255, (sky ? 140 : 90) + y / 7 + noise / 5))
  photo[i + 2] = Math.max(0, Math.min(255, (sky ? 205 : 45) + noise / 6))
  photo[i + 3] = 255
}
save('photo-like.jpg', jpeg.encode({ data: photo, width: photoWidth, height: photoHeight }, 90).data)

const screenWidth = 640; const screenHeight = 360
const screen = new Uint8Array(screenWidth * screenHeight * 4)
function fill(x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * screenWidth + x) * 4
    screen[i] = color[0]; screen[i + 1] = color[1]; screen[i + 2] = color[2]; screen[i + 3] = 255
  }
}
fill(0, 0, 640, 360, [246, 248, 250])
fill(0, 0, 640, 52, [24, 96, 133])
fill(28, 84, 298, 324, [255, 255, 255])
fill(320, 84, 612, 324, [255, 255, 255])
for (let i = 0; i < 7; i++) {
  fill(48, 105 + i * 29, 245 - i % 3 * 28, 112 + i * 29, [68, 79, 88])
  fill(340, 105 + i * 29, 580 - i % 2 * 36, 112 + i * 29, [68, 79, 88])
}
save('screenshot.png', Buffer.from(UPNG.encode([screen.buffer], screenWidth, screenHeight, 0)))

const gifWidth = 256; const gifHeight = 192; const frameCount = 8
const palette = Array.from({ length: 256 }, (_, i) => ((i * 5 & 255) << 16) | ((i * 3 & 255) << 8) | (i * 7 & 255))
const gifBytes = Buffer.alloc(gifWidth * gifHeight * frameCount * 4)
const gif = new GifWriter(gifBytes, gifWidth, gifHeight, { palette, loop: 0 })
for (let frame = 0; frame < frameCount; frame++) {
  const indexes = new Uint8Array(gifWidth * gifHeight)
  for (let y = 0; y < gifHeight; y++) for (let x = 0; x < gifWidth; x++) {
    const dx = x - (32 + frame * 28); const dy = y - 96
    indexes[y * gifWidth + x] = dx * dx + dy * dy < 35 * 35 ? 180 + frame * 6 : (x + y * 3) & 255
  }
  gif.addFrame(0, 0, gifWidth, gifHeight, indexes, { delay: frame % 2 ? 12 : 8 })
}
save('motion.gif', gifBytes.subarray(0, gif.end()))
