import { getAlbum, isValidId } from './source.js'
import { setLoading, showMessage, clearMessage } from './feedback.js'
import { crossfade } from './crossfade.js'
import { barcodeSvg } from './barcode.js'

let currentRequest = null

// Fetches and renders an album, and returns it. A newer call cancels an older one still in flight.
export async function fetchAlbumDetails(albumId) {
    if (!isValidId(albumId)) {
        showMessage('This is not a valid album id.', { error: true })
        return null
    }

    currentRequest?.abort()
    const controller = new AbortController()
    currentRequest = controller

    clearMessage()
    setLoading(true) // a thin line at the top of the window; nothing in the page moves

    try {
        const album = await getAlbum(albumId, controller.signal)
        await preloadImages(album, controller.signal)
        if (controller !== currentRequest) return null // another album was asked for meanwhile

        // text, covers and colours change together, with the old poster fading out over them
        crossfade(() => renderAlbum(album))
        return album
    } catch (error) {
        if (error.name === 'AbortError') return null
        console.error('Error fetching album details:', error)
        showMessage('Could not load this album. Try again in a moment or pick another one.', { error: true })
        return null
    } finally {
        setLoading(false)
    }
}

const IMAGE_TIMEOUT_MS = 6000

// Loads the covers before the poster changes. Otherwise the new title would stand on screen with
// the cover of the album before it, until the new cover came in. An image that fails or is slow
// does not hold things up: the poster then changes without it.
function preloadImages(album, signal) {
    const load = url => new Promise(resolve => {
        const image = new Image()
        image.crossOrigin = 'anonymous' // the same kind of request as the poster makes, so the cache is used
        const done = () => resolve()
        image.onload = () => image.decode().then(done, done)
        image.onerror = done
        image.src = url
        setTimeout(done, IMAGE_TIMEOUT_MS)
        signal?.addEventListener('abort', done, { once: true })
    })
    return Promise.all([album.front, album.back].filter(Boolean).map(load))
}

export function renderAlbum(album) {
    document.getElementById('album-name').textContent = album.title
    document.getElementById('album-artist').textContent = album.artist
    document.title = `${album.title} – ${album.artist}`

    // Footer: label, year and genre
    setField('album-label', album.label)
    setField('album-year', album.year)
    setField('album-genre', album.genre)

    setImage('album-cover', album.front, album.frontFull, `Cover of ${album.title} by ${album.artist}`)
    setImage('album-cover-back', album.back, album.backFull, `Back cover of ${album.title} by ${album.artist}`)
    setBackdrop(album.front)
    setBarcode(album.barcode)
    document.getElementById('album-info').classList.toggle('no-back', !album.back)

    renderTracks(album.tracks)
    setFit(album)
    document.dispatchEvent(new Event('poster:rendered')) // display mode measures the new poster
}

// Long titles and artists and long tracklists get a smaller type size, via custom properties
// that the stylesheet multiplies into its sizes
export function fitFactors(album) {
    const fit = text => Math.min(1, Math.max(0.5, 22 / text.length))
    // A single long word cannot wrap, so the biggest layouts also shrink for the longest word
    const longestWord = Math.max(...album.title.split(/\s+/).map(word => word.length))
    // The typographic layout sets the artist's words in huge type, one word to a line
    const longestArtistWord = Math.max(...album.artist.split(/\s+/).map(word => word.length))
    return {
        '--fit-title': fit(album.title).toFixed(2),
        '--fit-artist': fit(album.artist).toFixed(2),
        '--fit-word': Math.min(1, 10 / longestWord).toFixed(2),
        '--fit-artist-word': Math.min(1.6, Math.max(0.35, 7 / longestArtistWord)).toFixed(2), // short names may grow
        '--track-count': Math.max(album.tracks.length, 1)
    }
}

function setFit(album) {
    const poster = document.getElementById('album-container')
    for (const [name, value] of Object.entries(fitFactors(album))) poster.style.setProperty(name, value)
}

function renderTracks(tracks) {
    const trackListEl = document.getElementById('track-list')
    const names = tracks.map(track => track.title).filter(Boolean)

    if (names.length === 0) {
        const li = document.createElement('li')
        li.textContent = 'No tracklist data available'
        trackListEl.replaceChildren(li)
        return
    }

    // Side A and side B, like a record: the first half of the tracks and the rest. The vinyl layout shows
    // "A1" in front of a track and "Side A" above the first one of a side; the other layouts ignore this.
    const half = Math.ceil(names.length / 2)
    trackListEl.style.setProperty('--half', half)
    trackListEl.replaceChildren(...names.map((name, index) => {
        const li = document.createElement('li')
        li.textContent = name
        const side = index < half ? 'A' : 'B'
        const number = side === 'A' ? index + 1 : index - half + 1
        li.dataset.label = `${side}${number}`
        if (number === 1) li.dataset.sideStart = `Side ${side}`
        return li
    }))
}

// `fullUrl` is the original image; the export uses it for the higher qualities
function setImage(id, url, fullUrl, alt) {
    const img = document.getElementById(id)
    img.alt = alt
    img.dataset.fullSrc = fullUrl ?? ''
    img.classList.toggle('hidden', !url)
    img.onerror = () => {
        img.classList.add('hidden')
        if (id === 'album-cover-back') document.getElementById('album-info').classList.add('no-back')
    }
    if (url) {
        img.src = url
    } else {
        img.removeAttribute('src')
    }
}

// The blurred background of the blur layout is the front cover again (same URL, so no extra download)
function setBackdrop(url) {
    const img = document.getElementById('album-backdrop')
    if (url) {
        img.src = url
    } else {
        img.removeAttribute('src')
    }
}

// The barcode of the cd layouts; nothing is shown when the release has none or it is not a valid code
function setBarcode(code) {
    const box = document.getElementById('album-barcode')
    const svg = code ? barcodeSvg(code) : null
    box.replaceChildren(...(svg ? [svg] : []))
    box.classList.toggle('hidden', !svg)
}

// Sets a footer value; the wrapping item is hidden when there is nothing to show
function setField(id, value) {
    const el = document.getElementById(id)
    el.textContent = value
    el.closest('.footer-item').classList.toggle('hidden', !value)
}
