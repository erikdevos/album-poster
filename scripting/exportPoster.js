// Poster export: PNG or PDF at several sizes, print and share link.
// html-to-image (scripting/vendor) is only loaded when someone actually exports, so it does not slow down the page.

import { DPI, canvasLimits, planExport } from './exportPlan.js'
import { MM_PER_INCH, planPrint, printStyle } from './printPlan.js'
import { buildPdf, setPngDpi } from './fileFormats.js'
import { freezeAllLineBreaks } from './lineBreaks.js'

// Only the experiments in the tests turn this off
export const exportSettings = { freezeLineBreaks: true }

const HTML_TO_IMAGE = './vendor/html-to-image.js' // kept in the repo, so that exporting also works offline
const ORIGINAL_TIMEOUT_MS = 30_000

// The cover on the page is a thumbnail of 1200 px; in a print wider than this the original looks better
const ORIGINAL_COVER_FROM_PX = 1400

// Draws the poster to a canvas. The page is drawn at the current size and scaled up, so the
// layout is exactly what is on screen, only sharper. Fonts and covers are embedded by the library.
// `planFor(width, height, limits)` says at what scale; it returns { pixelRatio, ... }. `useOriginals(plan)`
// says whether the covers should be the original images, which are sharper at a large size.
async function renderPosterCanvas(planFor, useOriginals) {
    const { toCanvas } = await import(HTML_TO_IMAGE)
    const poster = document.getElementById('album-info')
    const { width, height } = poster.getBoundingClientRect()
    const plan = planFor(width, height, canvasLimits(navigator.userAgent))

    // The library freezes every computed size, and the image is drawn at a different scale than the
    // screen, so text can wrap differently in the image. Two things keep the image like the screen:
    // - the line breaks that are on screen are put into the text (see lineBreaks.js), and
    // - the tracklist, laid out in CSS columns, gets a little spare room, so that a track that does
    //   end up wider cannot fall into a column that is not there.
    const unfreeze = exportSettings.freezeLineBreaks ? freezeAllLineBreaks() : () => {}
    const trackList = document.getElementById('track-list')
    const spare = Math.ceil(parseFloat(getComputedStyle(trackList).fontSize) * 1.9)
    trackList.style.height = `${trackList.getBoundingClientRect().height + spare}px`
    let restoreCovers = () => {}

    try {
        // The page shows a 1200 pixel cover, which is soft at a large size: use the original
        if (useOriginals(plan)) restoreCovers = await useOriginalCovers()

        const canvas = await toCanvas(poster, {
            pixelRatio: plan.pixelRatio,
            backgroundColor: posterBackground(poster),
            style: { margin: '0' },
            // An image without a source (the hidden back cover) makes the library fail
            filter: node => !(node instanceof HTMLImageElement && !node.getAttribute('src'))
        })
        return { canvas, plan }
    } finally {
        restoreCovers()
        trackList.style.height = ''
        unfreeze()
    }
}

// Swaps the covers for the original images while the poster is drawn. An original that cannot be
// loaded (or takes too long) is left out: that cover just stays at the size it has.
async function useOriginalCovers() {
    const swaps = [...document.querySelectorAll('#album-info img[data-full-src]')]
        .filter(img => img.dataset.fullSrc && !img.classList.contains('hidden'))
        .map(img => ({ img, thumbnail: img.src, full: img.dataset.fullSrc }))

    await Promise.all(swaps.map(async swap => {
        const big = new Image()
        big.crossOrigin = 'anonymous'
        big.src = swap.full
        try {
            await Promise.race([
                big.decode(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ORIGINAL_TIMEOUT_MS))
            ])
            swap.img.dataset.exporting = 'true'
            swap.img.src = swap.full
            await swap.img.decode()
        } catch {
            swap.failed = true
        }
    }))

    return () => swaps.forEach(({ img, thumbnail, full, failed }) => {
        // another album may have come on the poster meanwhile (a slideshow): then leave it alone
        if (!failed && img.dataset.fullSrc === full) img.src = thumbnail
        delete img.dataset.exporting
    })
}

const toBlob = (canvas, type, quality) =>
    new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The image could not be made')), type, quality))

// Renders the poster as a file: { blob, filename, plan }
//   format 'png' with a `quality` (the width in pixels), or
//   format 'pdf' with `print` settings (paper, margin, dpi, bleed, crop marks; see printPlan.js).
//   A pdf without `print` is one page as large as the image at 300 dpi.
export async function renderPoster({ format = 'png', quality = 'standard', print = null } = {}) {
    if (format === 'pdf' && print) return renderPrintPdf(print)

    const { canvas, plan } = await renderPosterCanvas(
        (width, height, limits) => planExport({ width, height, quality, limits }),
        () => quality !== 'standard')

    if (format === 'pdf') {
        // A JPEG in a PDF page that is as large as the image at 300 dpi
        const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.95)).arrayBuffer())
        const pdf = buildPdf({ jpeg, width: canvas.width, height: canvas.height, dpi: DPI, title: document.title })
        return { blob: new Blob([pdf], { type: 'application/pdf' }), filename: `${fileName()}.pdf`, plan }
    }

    const png = new Uint8Array(await (await toBlob(canvas, 'image/png')).arrayBuffer())
    return { blob: new Blob([setPngDpi(png, DPI)], { type: 'image/png' }), filename: `${fileName()}.png`, plan }
}

// A PDF for a printer: the paper size, a margin, bleed and crop marks, and a picture with the wanted dpi
async function renderPrintPdf(settings) {
    let planned
    const { canvas } = await renderPosterCanvas((width, height, limits) => {
        planned = planPrint({ settings, width, height, limits })
        return planned
    }, plan => plan.pixelWidth > ORIGINAL_COVER_FROM_PX)

    // The picture can be a little taller than the poster on screen (see renderPosterCanvas), so the
    // place on the page is worked out again from the picture that was really made
    const final = planPrint({ settings, width: canvas.width / planned.pixelRatio, height: canvas.height / planned.pixelRatio })
    const plan = {
        ...final,
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
        effectiveDpi: Math.round(canvas.width / (final.image.width / MM_PER_INCH)),
        reduced: planned.reduced
    }

    const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.95)).arrayBuffer())
    const pdf = buildPdf({ jpeg, width: canvas.width, height: canvas.height, plan, background: pageBackground(), title: document.title })
    return {
        blob: new Blob([pdf], { type: 'application/pdf' }),
        filename: `${fileName()} (${plan.paper.toUpperCase()}, ${plan.effectiveDpi} dpi).pdf`,
        plan
    }
}

// The background of the picture. html-to-image paints this colour over the background of the poster
// itself, so it has to be the poster's own colour when it has one (the dark film poster, the paper of
// the receipt, the colours of the cover), and the page's colour when the poster is see-through.
function posterBackground(poster) {
    const own = getComputedStyle(poster).backgroundColor
    const transparent = /^rgba\(.*,\s*0\)$/.test(own) || own === 'transparent'
    return transparent ? getComputedStyle(document.body).backgroundColor : own
}

// The colour of the page behind the poster, as [r, g, b]: it fills the margin and the bleed
function pageBackground() {
    const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g).map(Number)
    return [r, g, b]
}

// Downloads the poster. Resolves to a message when there is something to tell the person.
export async function downloadPoster(options) {
    const { blob, filename, plan } = await renderPoster(options)
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000)

    if (!plan.reduced) return ''
    return plan.effectiveDpi
        ? `Made at ${plan.effectiveDpi} dpi, the most this browser can handle.`
        : `Made at ${plan.pixelWidth} px wide, the most this browser can handle.`
}

// The browser's own print dialog, with the paper, the margin and the poster size of the print settings.
// (Bleed and crop marks are only in the PDF; a browser cannot print those.)
export function printPoster(settings) {
    const { width, height } = document.getElementById('album-info').getBoundingClientRect()
    const style = document.createElement('style')
    style.textContent = printStyle(planPrint({ settings, width, height }))
    document.head.append(style)
    window.addEventListener('afterprint', () => style.remove(), { once: true })
    window.print()
}

// Native share sheet where there is one, otherwise the link goes to the clipboard.
// Resolves to what happened, so the caller can tell the user.
export async function sharePoster() {
    const data = { title: document.title, url: window.location.href }

    if (navigator.share) {
        try {
            await navigator.share(data)
            return 'shared'
        } catch (error) {
            if (error.name === 'AbortError') return 'cancelled'
        }
    }

    try {
        await navigator.clipboard.writeText(data.url)
        return 'copied'
    } catch {
        // No clipboard access (an insecure page or no focus): let the person copy it themselves
        window.prompt('Copy this link', data.url)
        return 'prompted'
    }
}

// "Artist - Album", safe to use as a file name
function fileName() {
    const album = document.getElementById('album-name').textContent
    const artist = document.getElementById('album-artist').textContent
    return `${artist} - ${album}`.replace(/[\\/:*?"<>|]+/g, '').trim() || 'album-poster'
}
