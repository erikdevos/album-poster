import { searchAlbums } from './source.js'

export async function loadAlbumList() {
    const albumListEl = document.getElementById('album-list')

    try {
        const response = await fetch('data/albums.json')
        if (!response.ok) throw new Error('Failed to load album list')

        // Newest additions first; albums without a MusicBrainz match cannot be shown
        const albums = (await response.json()).filter(album => album.id).reverse()

        albumListEl.replaceChildren(...albums.map(album =>
            albumItem(album.id, `${album.name} – ${album.artist}`)))

        return albums
    } catch (error) {
        console.error('Error loading album list:', error)
        return []
    }
}

// Typeahead search on all of MusicBrainz. Picking a result goes through the `#id` links.
export function setupSearch(input) {
    const resultsEl = document.getElementById('search-results')
    let timer = null
    let request = null

    input.addEventListener('input', () => {
        clearTimeout(timer)
        request?.abort()
        if (input.value.trim().length < 2) {
            resultsEl.replaceChildren()
            return
        }
        timer = setTimeout(search, 400)
    })

    async function search() {
        request = new AbortController()
        try {
            const results = await searchAlbums(input.value, request.signal)
            resultsEl.replaceChildren(...(results.length
                ? results.map(album => albumItem(album.id, `${album.title} – ${album.artist} (${album.year || '?'})`))
                : [message('No albums found')]))
        } catch (error) {
            if (error.name === 'AbortError') return
            console.error('Search failed:', error)
            resultsEl.replaceChildren(message('Search failed, try again'))
        }
    }
}

function albumItem(id, text) {
    const li = document.createElement('li')
    const a = document.createElement('a')
    a.href = `#${id}`
    a.textContent = text
    li.appendChild(a)
    return li
}

function message(text) {
    const li = document.createElement('li')
    li.textContent = text
    return li
}

// Applies the display options from the URL: debug, size and theme
export function applyDisplayOptions(params) {
    const searchBar = document.getElementById('search-bar')
    searchBar.style.display = params.get('debug') === 'true' ? 'block' : 'none'

    const container = document.getElementById('album-container')
    container.classList.remove('size-s', 'size-m', 'size-l')
    const size = params.get('size')
    if (['s', 'm', 'l'].includes(size)) container.classList.add(`size-${size}`)

    const dark = params.get('theme') === 'dark'
    document.body.classList.toggle('dark-theme', dark)
    document.body.classList.toggle('light-theme', !dark)
}
