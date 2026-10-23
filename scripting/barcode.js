// The barcode on the back of the cd (cd layouts): the real product code of the release, which
// MusicBrainz knows, drawn as an EAN-13 (a UPC-A is an EAN-13 with a zero in front). It is drawn as
// an inline SVG, so that it is crisp at every size and in the export, and scans like a real one.

// Left half, odd parity (L), even parity (G); the right half is the complement of L (R)
export const L_CODES = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
export const G_CODES = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
export const R_CODES = L_CODES.map(code => [...code].map(bit => bit === '1' ? '0' : '1').join(''))
// Which of L and G the six left digits use, chosen by the first digit
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

export function checkDigit(digits12) {
    const sum = [...digits12].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0)
    return (10 - (sum % 10)) % 10
}

// The 13 digits of an EAN-13, or null when this is not a usable code (wrong length, or a wrong check digit)
export function normalizeBarcode(code) {
    const digits = String(code ?? '').replace(/\D/g, '')
    const ean = digits.length === 12 ? `0${digits}` : digits
    if (ean.length !== 13) return null
    return checkDigit(ean.slice(0, 12)) === Number(ean[12]) ? ean : null
}

// The 95 modules (1 is a bar, 0 is a space) of a valid EAN-13, as a string; null when not valid
export function ean13Modules(code) {
    const ean = normalizeBarcode(code)
    if (!ean) return null
    const parity = PARITY[Number(ean[0])]
    const left = [...ean.slice(1, 7)].map((digit, index) => (parity[index] === 'L' ? L_CODES : G_CODES)[Number(digit)])
    const right = [...ean.slice(7)].map(digit => R_CODES[Number(digit)])
    return `101${left.join('')}01010${right.join('')}101`
}

// An SVG of the barcode with the digits below it, in the colours of the text around it (black on a
// white label is set in the stylesheet); null when there is no valid code
export function barcodeSvg(code) {
    const ean = normalizeBarcode(code)
    const modules = ean13Modules(code)
    if (!modules) return null

    const NS = 'http://www.w3.org/2000/svg'
    const QUIET_LEFT = 9, QUIET_RIGHT = 7 // the white space around the bars, in modules
    const BAR = 58, GUARD = 64, WIDTH = QUIET_LEFT + 95 + QUIET_RIGHT, HEIGHT = 74
    const make = (name, attributes) => {
        const element = document.createElementNS(NS, name)
        for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value)
        return element
    }
    const svg = make('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', 'aria-label': `Barcode ${ean}` })

    // The guards (start, middle, end) are longer than the other bars
    const isGuard = index => index < 3 || (index >= 45 && index < 50) || index >= 92
    let path = ''
    for (let index = 0; index < modules.length; index++) {
        if (modules[index] !== '1') continue
        let end = index
        while (modules[end + 1] === '1') end++
        // a run of bars is drawn per piece, because a guard and a digit bar can touch
        for (let part = index; part <= end;) {
            const guard = isGuard(part)
            let stop = part
            while (stop + 1 <= end && isGuard(stop + 1) === guard) stop++
            path += `M${QUIET_LEFT + part} 0h${stop - part + 1}v${guard ? GUARD : BAR}h-${stop - part + 1}z`
            part = stop + 1
        }
        index = end
    }
    svg.append(make('path', { d: path, fill: 'currentColor' }))

    const digit = (text, x) => {
        const element = make('text', { x, y: HEIGHT - 2, 'text-anchor': 'middle', 'font-size': 10, fill: 'currentColor' })
        element.textContent = text
        return element
    }
    svg.append(digit(ean[0], QUIET_LEFT / 2))
    ;[...ean.slice(1, 7)].forEach((value, index) => svg.append(digit(value, QUIET_LEFT + 3 + 7 * index + 3.5)))
    ;[...ean.slice(7)].forEach((value, index) => svg.append(digit(value, QUIET_LEFT + 50 + 7 * index + 3.5)))
    return svg
}
