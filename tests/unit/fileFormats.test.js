import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32 as nodeCrc32, deflateSync } from 'node:zlib'
import { crc32, setPngDpi, buildPdf } from '../../scripting/fileFormats.js'

// ---------- PNG helpers for the tests ----------

const chunk = (type, data = new Uint8Array()) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(nodeCrc32(body), 8 + data.length)
    return out
}

// A real 2x2 PNG: signature, IHDR, IDAT, IEND
function png(extraChunks = []) {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(2, 0)
    ihdr.writeUInt32BE(2, 4)
    ihdr[8] = 8  // bit depth
    ihdr[9] = 2  // RGB
    const row = Buffer.from([0, 255, 0, 0, 0, 255, 0])
    const idat = deflateSync(Buffer.concat([row, row]))
    return new Uint8Array(Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr), ...extraChunks, chunk('IDAT', idat), chunk('IEND')
    ]))
}

function chunksOf(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const list = []
    for (let offset = 8; offset < bytes.length;) {
        const length = view.getUint32(offset)
        const type = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString('ascii')
        const data = bytes.subarray(offset + 8, offset + 8 + length)
        const crc = view.getUint32(offset + 8 + length)
        list.push({ type, data, crc, valid: crc === nodeCrc32(Buffer.from(bytes.subarray(offset + 4, offset + 8 + length))) })
        offset += 12 + length
    }
    return list
}

test('crc32 matches the one in Node', () => {
    for (const text of ['', 'a', 'pHYs', 'The quick brown fox jumps over the lazy dog']) {
        assert.equal(crc32(Buffer.from(text)), nodeCrc32(Buffer.from(text)))
    }
})

test('setPngDpi adds a valid pHYs chunk right after IHDR, with 300 dpi in pixels per meter', () => {
    const chunks = chunksOf(setPngDpi(png(), 300))
    assert.deepEqual(chunks.map(c => c.type), ['IHDR', 'pHYs', 'IDAT', 'IEND'])
    assert.ok(chunks.every(c => c.valid), 'every chunk has a correct CRC')

    const view = new DataView(chunks[1].data.buffer, chunks[1].data.byteOffset, 9)
    assert.equal(view.getUint32(0), 11811)
    assert.equal(view.getUint32(4), 11811)
    assert.equal(chunks[1].data[8], 1)
})

test('setPngDpi replaces a pHYs chunk that is already there and leaves the rest alone', () => {
    const old = Buffer.alloc(9)
    old.writeUInt32BE(2835, 0)
    old.writeUInt32BE(2835, 4)
    old[8] = 1
    const input = png([chunk('pHYs', old)])
    const output = setPngDpi(input, 300)

    const chunks = chunksOf(output)
    assert.equal(chunks.filter(c => c.type === 'pHYs').length, 1)
    assert.equal(new DataView(chunks.find(c => c.type === 'pHYs').data.buffer, chunks.find(c => c.type === 'pHYs').data.byteOffset).getUint32(0), 11811)
    assert.deepEqual(
        Buffer.from(chunks.find(c => c.type === 'IDAT').data),
        Buffer.from(chunksOf(input).find(c => c.type === 'IDAT').data))
})

test('setPngDpi refuses something that is not a PNG', () => {
    assert.throws(() => setPngDpi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 300), /Not a PNG/)
})

// ---------- PDF ----------

const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, ...Array.from({ length: 200 }, (_, i) => i % 256), 0xFF, 0xD9])
const latin1 = bytes => Buffer.from(bytes).toString('latin1')

test('buildPdf makes a one page PDF as large as the image at the given dpi', () => {
    const pdf = buildPdf({ jpeg, width: 4000, height: 7025, dpi: 300, title: 'LUX' })
    const text = latin1(pdf)

    assert.ok(text.startsWith('%PDF-1.4'))
    assert.ok(text.trimEnd().endsWith('%%EOF'))
    assert.match(text, /\/MediaBox \[0 0 960\.00 1686\.00\]/) // 4000 / 300 * 72 = 960
    assert.match(text, /\/Width 4000 \/Height 7025/)
    assert.match(text, /\/Filter \/DCTDecode/)
    assert.match(text, /q 960\.00 0 0 1686\.00 0 0 cm \/Im0 Do Q/)
})

test('buildPdf keeps the JPEG bytes as they are and states their length', () => {
    const pdf = buildPdf({ jpeg, width: 10, height: 10, dpi: 300 })
    const text = latin1(pdf)
    assert.match(text, new RegExp(`/Length ${jpeg.length} >>`))

    const start = text.indexOf('stream\n', text.indexOf('/DCTDecode')) + 'stream\n'.length
    assert.deepEqual(new Uint8Array(pdf.subarray(start, start + jpeg.length)), jpeg)
})

test('buildPdf has a cross reference table that points at every object', () => {
    const pdf = buildPdf({ jpeg, width: 10, height: 10, dpi: 300 })
    const text = latin1(pdf)

    const startxref = Number(text.match(/startxref\n(\d+)\n/)[1])
    assert.equal(text.slice(startxref, startxref + 4), 'xref')

    const entries = text.slice(startxref).split('\n').slice(3, 9) // objects 1 to 6
    assert.equal(entries.length, 6)
    entries.forEach((entry, index) => {
        const offset = Number(entry.slice(0, 10))
        assert.equal(text.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`)
    })
    assert.match(text, /\/Size 7 \/Root 1 0 R/)
})

test('buildPdf writes the title as UTF-16 so that accents survive', () => {
    const title = 'ROSALÍA – LUX'
    const text = latin1(buildPdf({ jpeg, width: 10, height: 10, dpi: 300, title }))
    const hex = [...title].map(char => char.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase()
    assert.ok(text.includes(`/Title <FEFF${hex}>`))
    assert.ok(hex.includes('00CD') && hex.includes('2013')) // the accent and the en dash really are in there
})
