'use strict'

const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b }
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b }
const ascii = s => Buffer.from(s, 'ascii')
const bytes = (...items) => Buffer.concat(items.flat(Infinity).map(x => typeof x === 'number' ? Buffer.from([x]) : x))
const box = (name, ...parts) => { const body = bytes(...parts); return bytes(u32(body.length + 8), ascii(name), body) }
const full = (name, version, flags, ...parts) => box(name, Buffer.from([version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255]), ...parts)

function extract(still) {
  const configs = []
  let iloc
  for (let p = 0; p + 12 <= still.length; p++) {
    const name = still.toString('ascii', p + 4, p + 8)
    const size = still.readUInt32BE(p)
    if (name === 'av1C' && size >= 12 && size < 100 && p + size <= still.length) configs.push(still.subarray(p + 8, p + size))
    if (name === 'iloc' && size >= 22 && p + size <= still.length) iloc = still.subarray(p + 8, p + size)
  }
  if (!iloc || !configs.length || iloc[0] !== 0 || iloc[4] !== 0x44 || iloc[5] !== 0) throw new Error('AVIF 帧使用了不支持的容器结构')
  let p = 6
  const count = iloc.readUInt16BE(p); p += 2
  const items = new Map()
  for (let i = 0; i < count; i++) {
    const id = iloc.readUInt16BE(p); p += 2
    p += 2 // data reference index
    const extents = iloc.readUInt16BE(p); p += 2
    const parts = []
    for (let e = 0; e < extents; e++) {
      const offset = iloc.readUInt32BE(p); const length = iloc.readUInt32BE(p + 4); p += 8
      if (offset + length > still.length) throw new Error('AVIF 帧数据越界')
      parts.push(still.subarray(offset, offset + length))
    }
    items.set(id, Buffer.concat(parts))
  }
  if (!items.get(1)?.length) throw new Error('AVIF 帧中没有颜色数据')
  return { color: items.get(1), alpha: items.get(2), colorConfig: configs[0], alphaConfig: configs[1] }
}

function makeTrack(id, width, height, durations, samples, av1c, offset, repetitions, alpha = false) {
  const duration = durations.reduce((a, b) => a + b, 0)
  const trackDuration = repetitions < 0 ? 0xffffffffffffffffn : BigInt(duration) * BigInt(repetitions + 1)
  const matrix = bytes(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000))
  const tkhd = full('tkhd', 1, 3, u64(0), u64(0), u32(id), u32(0), u64(trackDuration), Buffer.alloc(8), u16(0), u16(0), u16(0), u16(0), matrix, u32(width << 16), u32(height << 16))
  const edts = box('edts', full('elst', 1, repetitions === 0 ? 0 : 1, u32(1), u64(duration), u64(0), u16(1), u16(0)))
  const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(1000), u32(duration), u16(0x55c4), u16(0))
  const hdlr = full('hdlr', 0, 0, u32(0), ascii('vide'), Buffer.alloc(12), 0)
  const vmhd = full('vmhd', 0, 1, Buffer.alloc(8))
  const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)))
  const auxC = alpha ? box('auxC', ascii('urn:mpeg:mpegB:cicp:systems:auxiliary:alpha'), Buffer.alloc(4)) : Buffer.alloc(0)
  const sampleEntry = box('av01', Buffer.alloc(6), u16(1), Buffer.alloc(16), u16(width), u16(height), u32(0x480000), u32(0x480000), u32(0), u16(1), Buffer.alloc(32), u16(24), u16(0xffff), box('av1C', av1c), auxC)
  const entries = []
  for (const ms of durations) {
    const last = entries.at(-1)
    if (last && last.duration === ms) last.count++
    else entries.push({ count: 1, duration: ms })
  }
  const stbl = box('stbl',
    full('stsd', 0, 0, u32(1), sampleEntry),
    full('stts', 0, 0, u32(entries.length), entries.map(e => bytes(u32(e.count), u32(e.duration)))),
    full('stss', 0, 0, u32(samples.length), samples.map((_, i) => u32(i + 1))),
    full('stsc', 0, 0, u32(1), u32(1), u32(samples.length), u32(1)),
    full('stsz', 0, 0, u32(0), u32(samples.length), samples.map(s => u32(s.length))),
    full('stco', 0, 0, u32(1), u32(offset))
  )
  const tref = alpha ? box('tref', box('auxl', u32(1))) : Buffer.alloc(0)
  return box('trak', tkhd, tref, edts, box('mdia', mdhd, hdlr, box('minf', vmhd, dinf, stbl)))
}

function makeMeta(width, height, av1c, firstOffset, firstLength) {
  const hdlr = full('hdlr', 0, 0, u32(0), ascii('pict'), Buffer.alloc(12), 0)
  const iloc = full('iloc', 0, 0, Buffer.from([0x44, 0]), u16(1), u16(1), u16(0), u16(1), u32(firstOffset), u32(firstLength))
  const infe = full('infe', 2, 0, u16(1), u16(0), ascii('av01'), 0)
  const ipco = box('ipco', full('ispe', 0, 0, u32(width), u32(height)), full('pixi', 0, 0, 3, 8, 8, 8), box('av1C', av1c))
  const ipma = full('ipma', 0, 0, u32(1), u16(1), 3, 1, 2, 3)
  return full('meta', 0, 0, hdlr, full('pitm', 0, 0, u16(1)), iloc, full('iinf', 0, 0, u16(1), infe), box('iprp', ipco, ipma))
}

function mux(stills, width, height, durations, repetitions = -1) {
  if (stills.length < 2 || stills.length !== durations.length) throw new Error('AVIF 动图至少需要两帧')
  const parsed = stills.map(extract)
  const alpha = parsed.every(frame => frame.alpha?.length)
  if (parsed.some(frame => !!frame.alpha !== alpha)) throw new Error('AVIF 各帧透明度不一致')
  const colors = parsed.map(frame => frame.color)
  const alphas = alpha ? parsed.map(frame => frame.alpha) : []
  const totalDuration = durations.reduce((a, b) => a + b, 0)
  const movieDuration = repetitions < 0 ? 0xffffffffffffffffn : BigInt(totalDuration) * BigInt(repetitions + 1)
  const ftyp = box('ftyp', ascii('avis'), u32(0), ascii('avisavifmif1miafiso8'))
  const matrix = bytes(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000))
  const mvhd = full('mvhd', 1, 0, u64(0), u64(0), u32(1000), u64(movieDuration), u32(0x10000), u16(0x100), Buffer.alloc(10), matrix, Buffer.alloc(24), u32(alpha ? 3 : 2))
  const buildMoov = (colorOffset, alphaOffset) => box('moov', mvhd,
    makeTrack(1, width, height, durations, colors, parsed[0].colorConfig, colorOffset, repetitions),
    alpha ? makeTrack(2, width, height, durations, alphas, parsed[0].alphaConfig, alphaOffset, repetitions, true) : Buffer.alloc(0))
  let meta = makeMeta(width, height, parsed[0].colorConfig, 0, colors[0].length)
  let moov = buildMoov(0, 0)
  const dataStart = ftyp.length + meta.length + moov.length + 8
  const alphaStart = dataStart + colors.reduce((n, data) => n + data.length, 0)
  meta = makeMeta(width, height, parsed[0].colorConfig, dataStart, colors[0].length)
  moov = buildMoov(dataStart, alphaStart)
  return Buffer.concat([ftyp, meta, moov, box('mdat', colors, alphas)])
}

module.exports = { mux }
