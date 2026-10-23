// Poster export: PNG download, print and share link.
// html-to-image is only loaded when someone actually exports, so it does not slow down the page.

const HTML_TO_IMAGE = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm'
const EXPORT_WIDTH = 2400 // pixels, whatever the size of the poster on screen

// Renders the poster to a PNG. The page is drawn at the current size and scaled up, so the
// layout is exactly what is on screen, only sharper. Fonts and covers are embedded by the library.
export async function renderPosterBlob() {
    const { toBlob } = await import(HTML_TO_IMAGE)
    const poster = document.getElementById('album-info')
    const pixelRatio = Math.min(5, EXPORT_WIDTH / poster.getBoundingClientRect().width)

    // The library freezes every computed size, including the height of the tracklist, which is
    // laid out in CSS columns. If a word wraps differently in the rendered copy, the last track
    // would fall into a column that is not there. A little spare room in the list prevents that.
    const trackList = document.getElementById('track-list')
    const spare = Math.ceil(parseFloat(getComputedStyle(trackList).fontSize) * 1.9)
    trackList.style.height = `${trackList.getBoundingClientRect().height + spare}px`

    try {
        const blob = await toBlob(poster, {
            pixelRatio,
            backgroundColor: getComputedStyle(document.body).backgroundColor,
            style: { margin: '0' },
            // An image without a source (the hidden back cover) makes the library fail
            filter: node => !(node instanceof HTMLImageElement && !node.getAttribute('src'))
        })
        if (!blob) throw new Error('The poster could not be rendered')
        return blob
    } finally {
        trackList.style.height = ''
    }
}

export async function downloadPoster() {
    const blob = await renderPosterBlob()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${fileName()}.png`
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
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
