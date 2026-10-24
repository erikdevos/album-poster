// How a poster goes on paper: the PDF page (paper size, margin, bleed, crop marks) and how many
// pixels the picture needs for the wanted dpi. Pure functions, no DOM. Lengths are in millimetres.

import { maxPixelRatio } from './exportPlan.js'

export const MM_PER_INCH = 25.4

export const PAPERS = [
    { id: 'a5', label: 'A5', width: 148, height: 210 },
    { id: 'a4', label: 'A4', width: 210, height: 297 },
    { id: 'a3', label: 'A3', width: 297, height: 420 },
    { id: 'a2', label: 'A2', width: 420, height: 594 },
    { id: 'a1', label: 'A1', width: 594, height: 841 },
    { id: '30x40', label: '30 × 40 cm', width: 300, height: 400 },
    { id: '40x50', label: '40 × 50 cm', width: 400, height: 500 },
    { id: '50x70', label: '50 × 70 cm', width: 500, height: 700 },
    { id: 'letter', label: 'Letter (8.5 × 11 in)', width: 215.9, height: 279.4 },
    { id: 'tabloid', label: 'Tabloid (11 × 17 in)', width: 279.4, height: 431.8 }
]
export const DPI_CHOICES = [150, 300, 600]
export const MARGIN_CHOICES = [0, 5, 10, 20]
export const ORIENTATIONS = ['auto', 'portrait', 'landscape']

export const DEFAULT_PRINT = {
    paper: 'a4', orientation: 'auto', margin: 10, dpi: 300, bleed: false, marks: false
}

// Print shops want 3 mm of picture beyond the cut line, and marks that show where to cut:
// short lines in the corner, starting at least 3 mm from the trim (so not in the bleed), 5 mm long
export const BLEED_MM = 3
export const MARK_LENGTH_MM = 5
export const MARK_MIN_OFFSET_MM = 3

const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback

// Settings from the page (strings, anything) to settings that can be planned with
export function cleanPrintSettings(raw = {}) {
    const paper = PAPERS.some(item => item.id === raw.paper) ? raw.paper : DEFAULT_PRINT.paper
    return {
        paper,
        orientation: pick(raw.orientation, ORIENTATIONS, DEFAULT_PRINT.orientation),
        margin: pick(Number(raw.margin), MARGIN_CHOICES, DEFAULT_PRINT.margin),
        dpi: pick(Number(raw.dpi), DPI_CHOICES, DEFAULT_PRINT.dpi),
        bleed: raw.bleed === true,
        marks: raw.marks === true
    }
}

// The page and the place of the picture on it.
//   settings: { paper, orientation, margin, dpi, bleed, marks }
//   width, height: the poster as it is on screen, in pixels (only the shape counts, and the scale to draw it at)
//   limits: what the browser can make (canvasLimits), or null for no limit
// Page coordinates start at the bottom left of the whole page (what a PDF uses), `trim` is the size
// the paper is cut to, and `image` is where the picture goes, centred in the trim, inside the margin.
export function planPrint({ settings, width, height, limits = null }) {
    const { paper, orientation, margin, dpi, bleed, marks } = cleanPrintSettings(settings)
    const size = PAPERS.find(item => item.id === paper)

    const portrait = orientation === 'auto' ? height >= width : orientation === 'portrait'
    const trim = {
        width: portrait ? size.width : size.height,
        height: portrait ? size.height : size.width
    }

    // the picture, as large as fits inside the margins
    const room = { width: Math.max(1, trim.width - 2 * margin), height: Math.max(1, trim.height - 2 * margin) }
    const scale = Math.min(room.width / width, room.height / height)
    const image = { width: width * scale, height: height * scale }

    const bleedMm = bleed ? BLEED_MM : 0
    const markOffset = Math.max(bleedMm, MARK_MIN_OFFSET_MM)
    const slug = marks ? markOffset + MARK_LENGTH_MM : bleedMm // the space around the trim, in the PDF
    const media = { width: trim.width + 2 * slug, height: trim.height + 2 * slug }

    const placed = {
        x: slug + (trim.width - image.width) / 2,
        y: slug + (trim.height - image.height) / 2,
        ...image
    }

    // pixels for the wanted dpi, within what the browser can draw
    const wantedWidth = image.width / MM_PER_INCH * dpi
    const wantedRatio = wantedWidth / width
    const pixelRatio = limits ? Math.min(wantedRatio, maxPixelRatio({ width, height, limits })) : wantedRatio
    const pixelWidth = Math.round(width * pixelRatio)

    return {
        paper, orientation: portrait ? 'portrait' : 'landscape', dpi, margin,
        trim, media, slug, bleed: bleedMm, marks, markOffset, markLength: MARK_LENGTH_MM,
        image: placed,
        pixelRatio,
        pixelWidth,
        pixelHeight: Math.round(height * pixelRatio),
        effectiveDpi: Math.round(pixelWidth / (image.width / MM_PER_INCH)),
        reduced: pixelRatio < wantedRatio
    }
}

// One line for the export panel, so that it is clear what the file will be
export function describePrint(plan) {
    const mm = value => Math.round(value)
    const paper = PAPERS.find(item => item.id === plan.paper).label
    const extras = [plan.bleed ? `${plan.bleed} mm bleed` : '', plan.marks ? 'crop marks' : ''].filter(Boolean)
    const dpi = plan.reduced ? `${plan.effectiveDpi} dpi (${plan.dpi} is too much for this browser)` : `${plan.dpi} dpi`
    return `${paper} ${plan.orientation}, poster ${mm(plan.image.width)} × ${mm(plan.image.height)} mm at ${dpi}, ` +
        `${plan.pixelWidth} × ${plan.pixelHeight} px${extras.length ? `, ${extras.join(', ')}` : ''}`
}

// The CSS that makes the browser's own print dialog follow the same settings: the paper, the margin,
// and the poster as wide as it is on the PDF
export function printStyle(plan) {
    const { width, height } = plan.trim
    return `@page { size: ${width}mm ${height}mm; margin: ${plan.margin}mm; }\n` +
        `@media print { #album-container { width: ${plan.image.width.toFixed(2)}mm !important; } }`
}
