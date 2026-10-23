// Poster export: PNG or PDF at several sizes, print and share link.
// html-to-image is only loaded when someone actually exports, so it does not slow down the page.

import { DPI, canvasLimits, planExport } from './exportPlan.js'
import { buildPdf, setPngDpi } from './fileFormats.js'
import { freezeAllLineBreaks } from './lineBreaks.js'

// Only the experiments in the tests turn this off
export const exportSettings = { freezeLineBreaks: true }

const HTML_TO_IMAGE = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm'
const ORIGINAL_TIMEOUT_MS = 30_000

// Draws the poster to a canvas. The page is drawn at the current size and scaled up, so the
// layout is exactly what is on screen, only sharper. Fonts and covers are embedded by the library.
async function renderPosterCanvas(quality) {
    const { toCanvas } = await import(HTML_TO_IMAGE)
    const poster = document.getElementById('album-info')
    const { width, height } = poster.getBoundingClientRect()
    const plan = planExport({ width, height, quality, limits: canvasLimits(navigator.userAgent) })

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
        if (quality !== 'standard') restoreCovers = await useOriginalCovers()

        const canvas = await toCanvas(poster, {
            pixelRatio: plan.pixelRatio,
            backgroundColor: getComputedStyle(document.body).backgroundColor,
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
export async function renderPoster({ format = 'png', quality = 'standard' } = {}) {
    const { canvas, plan } = await renderPosterCanvas(quality)

    if (format === 'pdf') {
        // A JPEG in a PDF page that is as large as the image at 300 dpi
        const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.95)).arrayBuffer())
        const pdf = buildPdf({ jpeg, width: canvas.width, height: canvas.height, dpi: DPI, title: document.title })
        return { blob: new Blob([pdf], { type: 'application/pdf' }), filename: `${fileName()}.pdf`, plan }
    }

    const png = new Uint8Array(await (await toBlob(canvas, 'image/png')).arrayBuffer())
    return { blob: new Blob([setPngDpi(png, DPI)], { type: 'image/png' }), filename: `${fileName()}.png`, plan }
}

// Downloads the poster. Resolves to a message when there is something to tell the person.
export async function downloadPoster(options) {
    const { blob, filename, plan } = await renderPoster(options)
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000)

    return plan.reduced
        ? `Made at ${plan.pixelWidth} px wide, the most this browser can handle.`
        : ''
}

export function printPoster() {
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
