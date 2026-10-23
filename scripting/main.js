import { loadAlbumList } from './albumList.js'
import { fetchAlbumDetails, setStatus } from './albumDetails.js'
import { watchCover } from './albumColors.js'
import { applyDisplayOptions, setLayout, setupThemeToggle } from './displayOptions.js'
import { setupSearch, rememberAlbum } from './search.js'
import { downloadPoster, printPoster, sharePoster } from './exportPoster.js'
import { parseLocation, isLegacyId, replaceAlbumId, navigateToAlbum, onAlbumChange } from './router.js'

let albums = []

// Old links used TheAudioDB ids; translate them to the MusicBrainz id of the same album
function resolveAlbumId(albumId) {
    if (!isLegacyId(albumId)) return albumId
    const match = albums.find(album => album.audiodbId === albumId)
    if (!match) return albumId
    replaceAlbumId(match.id)
    return match.id
}

async function showAlbum(albumId) {
    const album = await fetchAlbumDetails(resolveAlbumId(albumId))
    if (album) rememberAlbum(album)
}

function showRandomAlbum() {
    const current = parseLocation().albumId
    const others = albums.filter(album => album.id !== current)
    if (others.length > 0) navigateToAlbum(others[Math.floor(Math.random() * others.length)].id)
}

// Runs a button action: the button is disabled meanwhile, a failure is shown in the status line,
// and the message the action returns (if any) is shown for a few seconds
function onClick(id, action, { busy = '' } = {}) {
    const button = document.getElementById(id)
    button.addEventListener('click', async () => {
        button.disabled = true
        if (busy) setStatus(busy)
        try {
            const message = await action()
            setStatus(message ?? '')
            if (message) setTimeout(() => setStatus(''), 6000)
        } catch (error) {
            console.error(`${id} failed:`, error)
            setStatus('That did not work. Try again.', 'error')
        } finally {
            button.disabled = false
        }
    })
}

async function init() {
    const { albumId, params } = parseLocation()
    applyDisplayOptions(params)
    watchCover(document.getElementById('album-cover'))

    albums = await loadAlbumList()
    setupSearch(document.getElementById('album-search'), albums)
    document.getElementById('shuffle-button').addEventListener('click', showRandomAlbum)
    setupThemeToggle()
    document.getElementById('layout-select').addEventListener('change', event => setLayout(event.target.value))
    onClick('download-button', () => downloadPoster({
        format: document.getElementById('export-format').value,
        quality: document.getElementById('export-quality').value
    }), { busy: 'Creating the file…' })
    onClick('print-button', printPoster)
    onClick('share-button', async () => (await sharePoster()) === 'copied' ? 'Link copied to the clipboard' : '')

    // Search results and lists navigate by changing the `#id` in the URL
    onAlbumChange(showAlbum)

    if (albumId) {
        showAlbum(albumId)
    } else if (albums.length > 0) {
        // No album requested: show a random one, and put it in the URL so it can be shared
        const random = albums[Math.floor(Math.random() * albums.length)].id
        replaceAlbumId(random)
        showAlbum(random)
    }
}

init()
