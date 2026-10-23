// Writing the export files. Pure functions on bytes, no DOM.

const encoder = new TextEncoder()

const concat = parts => {
    const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        bytes.set(part, offset)
        offset += part.length
    }
    return bytes
}

// ---------- CRC32 (needed for the PNG chunks) ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
})

export function crc32(bytes) {
    let crc = 0xFFFFFFFF
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
    return (crc ^ 0xFFFFFFFF) >>> 0
}

// ---------- PNG: the print resolution ----------

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

// Returns the PNG with a pHYs chunk, so that programs know how large it is when printed.
// A pHYs chunk that is already there is replaced.
export function setPngDpi(png, dpi) {
    if (!PNG_SIGNATURE.every((byte, i) => png[i] === byte)) throw new Error('Not a PNG file')

    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    const pixelsPerMeter = Math.round(dpi / 0.0254)

    const data = new Uint8Array(9)
    new DataView(data.buffer).setUint32(0, pixelsPerMeter)
    new DataView(data.buffer).setUint32(4, pixelsPerMeter)
    data[8] = 1 // the unit is the meter

    const type = encoder.encode('pHYs')
    const typeAndData = concat([type, data])
    const chunk = new Uint8Array(12 + data.length)
    const chunkView = new DataView(chunk.buffer)
    chunkView.setUint32(0, data.length)
    chunk.set(typeAndData, 4)
    chunkView.setUint32(8 + data.length, crc32(typeAndData))

    const parts = [png.subarray(0, 8)]
    let offset = 8
    while (offset < png.length) {
        const length = view.getUint32(offset)
        const name = String.fromCharCode(...png.subarray(offset + 4, offset + 8))
        const end = offset + 12 + length
        if (name !== 'pHYs') parts.push(png.subarray(offset, end))
        if (name === 'IHDR') parts.push(chunk) // pHYs has to come before the image data
        offset = end
    }
    return concat(parts)
}

// ---------- PDF: one page that is one JPEG ----------

const POINTS_PER_INCH = 72

// A PDF with a single page, as large as the image is at `dpi`. The JPEG has to be an ordinary
// 8 bit colour JPEG, which is what a browser canvas produces.
export function buildPdf({ jpeg, width, height, dpi, title = '' }) {
    const pageWidth = (width / dpi * POINTS_PER_INCH).toFixed(2)
    const pageHeight = (height / dpi * POINTS_PER_INCH).toFixed(2)
    const content = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`

    // A title in UTF-16BE (a string's code units are UTF-16), so that accents and other letters survive
    const titleHex = 'FEFF' + Array.from({ length: title.length }, (_, i) =>
        title.charCodeAt(i).toString(16).padStart(4, '0')).join('').toUpperCase()

    const objects = [
        encoder.encode('<< /Type /Catalog /Pages 2 0 R >>'),
        encoder.encode('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
        encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
            '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),
        concat([
            encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
                `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
            jpeg,
            encoder.encode('\nendstream')
        ]),
        encoder.encode(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`),
        encoder.encode(`<< /Title <${titleHex}> /Producer (Album poster) >>`)
    ]

    const parts = [encoder.encode('%PDF-1.4\n%âãÏÓ\n')] // the odd characters mark it as binary
    const offsets = []
    let position = parts[0].length
    objects.forEach((body, index) => {
        offsets.push(position)
        const object = concat([encoder.encode(`${index + 1} 0 obj\n`), body, encoder.encode('\nendobj\n')])
        parts.push(object)
        position += object.length
    })

    const xref = ['xref', `0 ${objects.length + 1}`, '0000000000 65535 f ',
        ...offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n `)].join('\n')
    parts.push(encoder.encode(`${xref}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\n` +
        `startxref\n${position}\n%%EOF\n`))

    return concat(parts)
}
