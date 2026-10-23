import { getAlbum, isValidId } from './source.js'

let currentRequest = null

// Fetches and renders an album. A newer call cancels an older one still in flight.
export async function fetchAlbumDetails(albumId) {
    if (!isValidId(albumId)) {
        setStatus('This is not a valid album id.', 'error')
        return
    }

    currentRequest?.abort()
    const controller = new AbortController()
    currentRequest = controller

    setStatus('Loading album…')

    try {
        const album = await getAlbum(albumId, controller.signal)
        renderAlbum(album)
        setStatus('')
    } catch (error) {
        if (error.name === 'AbortError') return
        console.error('Error fetching album details:', error)
        setStatus('Could not load this album. Try again in a moment or pick another one.', 'error')
    }
}

export function renderAlbum(album) {
    document.getElementById('album-name').textContent = album.title
    document.getElementById('album-artist').textContent = album.artist
    document.title = `${album.title} – ${album.artist}`

    // Footer: label, year and genre
    document.querySelector('.album-text-label').classList.toggle('hidden', !album.label)
    setField('album-label', album.label)
    setField('album-year', album.year)
    setField('album-style', '')
    setField('album-genre', album.genre)

    setImage('album-cover', album.front, `Cover of ${album.title} by ${album.artist}`)
    setImage('album-cover-back', album.back, `Back cover of ${album.title} by ${album.artist}`)

    renderTracks(album.tracks)
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
    if (url) {
        img.src = url
    } else {
        img.removeAttribute('src')
    }
}

function setField(id, value) {
    const el = document.getElementById(id)
    el.textContent = value
    el.classList.toggle('hidden', !value)
}

// Status message that does not touch the poster markup, so it can always recover
function setStatus(message, type = 'info') {
    const el = document.getElementById('status')
    el.textContent = message
    el.dataset.type = type
    el.classList.toggle('hidden', !message)
}
