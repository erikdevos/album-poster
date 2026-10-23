import { loadAlbumList, setupSearch, applyDisplayOptions } from './albumList.js'
import { fetchAlbumDetails } from './albumDetails.js'
import { watchCover } from './albumColors.js'
import { parseLocation, isLegacyId, replaceAlbumId, onAlbumChange } from './router.js'

let albums = []

// Old links used TheAudioDB ids; translate them to the MusicBrainz id of the same album
function resolveAlbumId(albumId) {
    if (!isLegacyId(albumId)) return albumId
    const match = albums.find(album => album.audiodbId === albumId)
    if (!match) return albumId
    replaceAlbumId(match.id)
    return match.id
}

const showAlbum = albumId => fetchAlbumDetails(resolveAlbumId(albumId))

async function init() {
    const { albumId, params } = parseLocation()
    applyDisplayOptions(params)
    watchCover(document.getElementById('album-cover'))
    setupSearch(document.getElementById('album-search'))

    albums = await loadAlbumList()

    // Links in the lists are plain `#id` anchors, so the hash handles navigation
    onAlbumChange(showAlbum)

    if (albumId) {
        showAlbum(albumId)
    } else if (albums.length > 0) {
        // No album requested: show a random one
        showAlbum(albums[Math.floor(Math.random() * albums.length)].id)
    }
}

init()
