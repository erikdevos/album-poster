import { getAlbum, isValidId } from './source.js'

let currentRequest = null

// Fetches and renders an album, and returns it. A newer call cancels an older one still in flight.
export async function fetchAlbumDetails(albumId) {
    if (!isValidId(albumId)) {
        setStatus('This is not a valid album id.', 'error')
        return null
    }

    currentRequest?.abort()
    const controller = new AbortController()
    currentRequest = controller

    setStatus('Loading album…')

    try {
        const album = await getAlbum(albumId, controller.signal)
        renderAlbum(album)
        setStatus('')
        return album
    } catch (error) {
        if (error.name === 'AbortError') return null
        console.error('Error fetching album details:', error)
        setStatus('Could not load this album. Try again in a moment or pick another one.', 'error')
        return null
    }
}

export function renderAlbum(album) {
    document.getElementById('album-name').textContent = album.title
    document.getElementById('album-artist').textContent = album.artist
    document.title = `${album.title} – ${album.artist}`

    // Footer: label, year and genre
    setField('album-label', album.label)
    setField('album-year', album.year)
    setField('album-genre', album.genre)

    setImage('album-cover', album.front, `Cover of ${album.title} by ${album.artist}`)
    setImage('album-cover-back', album.back, `Back cover of ${album.title} by ${album.artist}`)
    document.getElementById('album-info').classList.toggle('no-back', !album.back)

    renderTracks(album.tracks)
    setFit(album)
}

// Long titles and artists and long tracklists get a smaller type size, via custom properties
// that the stylesheet multiplies into its sizes
function setFit(album) {
    const poster = document.getElementById('album-container')
    const fit = text => Math.min(1, Math.max(0.5, 22 / text.length))
    poster.style.setProperty('--fit-title', fit(album.title).toFixed(2))
    poster.style.setProperty('--fit-artist', fit(album.artist).toFixed(2))
    // A single long word cannot wrap, so the biggest layouts also shrink for the longest word
    const longestWord = Math.max(...album.title.split(/\s+/).map(word => word.length))
    poster.style.setProperty('--fit-word', Math.min(1, 10 / longestWord).toFixed(2))
    poster.style.setProperty('--track-count', Math.max(album.tracks.length, 1))
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

    trackListEl.replaceChildren(...names.map(name => {
        const li = document.createElement('li')
        li.textContent = name
        return li
    }))
}

function setImage(id, url, alt) {
    const img = document.getElementById(id)
    img.alt = alt
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

// Sets a footer value; the wrapping item is hidden when there is nothing to show
function setField(id, value) {
    const el = document.getElementById(id)
    el.textContent = value
    el.closest('.footer-item').classList.toggle('hidden', !value)
}

// Status message that does not touch the poster markup, so it can always recover
export function setStatus(message, type = 'info') {
    const el = document.getElementById('status')
    el.textContent = message
    el.dataset.type = type
    el.classList.toggle('hidden', !message)
}
