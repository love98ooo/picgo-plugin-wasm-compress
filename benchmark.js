'use strict'

const fs = require('node:fs/promises')
const { performance } = require('node:perf_hooks')
const { formatOf, decode, encodeWebp, encodeAvifFrames } = require('./codecs')
const { mux } = require('./avif-sequence')

async function main(files) {
  if (!files.length) throw new Error('用法: npm run bench -- image1.png image2.gif ...')
  for (const file of files) {
    const source = await fs.readFile(file)
    const format = formatOf(source)
    if (!format || (format === 'avif' && source.toString('ascii', 8, 12) === 'avis')) {
      console.log(`${file}: 跳过不支持的输入`)
      continue
    }
    const started = performance.now()
    const image = await decode(source, format)
    const decodeMs = performance.now() - started
    console.log(`${file}: ${format}, ${image.width}x${image.height}, ${image.frames.length} 帧, 原始 ${source.length} B, 解码 ${decodeMs.toFixed(0)} ms`)
    for (const target of ['avif', 'webp']) {
      const t = performance.now()
      try {
        let output
        if (target === 'webp') output = await encodeWebp(image, 82)
        else {
          const stills = await encodeAvifFrames(image, 62, 6)
          output = stills.length === 1 ? stills[0] : mux(stills, image.width, image.height, image.frames.map(frame => frame.duration), image.repetitions)
        }
        const ratio = (100 * output.length / source.length).toFixed(1)
        console.log(`  ${target}: ${output.length} B (${ratio}%), ${(performance.now() - t).toFixed(0)} ms`)
      } catch (error) { console.log(`  ${target}: ${error.message}`) }
    }
  }
}

main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
