import { loadAlbumList } from './albumList.js'
import { fetchAlbumDetails } from './albumDetails.js'
import { watchCover } from './albumColors.js'
import { applyDisplayOptions } from './displayOptions.js'
import { setupSearch, rememberAlbum } from './search.js'
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

async function init() {
    const { albumId, params } = parseLocation()
    applyDisplayOptions(params)
    watchCover(document.getElementById('album-cover'))

    albums = await loadAlbumList()
    setupSearch(document.getElementById('album-search'), albums)
    document.getElementById('shuffle-button').addEventListener('click', showRandomAlbum)

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
