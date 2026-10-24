// The active album data source. Swap `musicbrainz` for another source with the same interface.
// getAlbum and searchAlbums are wrapped so that an album that was fetched once is kept in this
// browser and works offline (see albumCache.js).

import * as musicbrainz from './sources/musicbrainz.js'
import { createAlbumStore, indexedDbBackend, createCachedSource, searchLocal } from './albumCache.js'
import { loadAlbumList } from './albumList.js'

export { randomAlbumId, isValidId } from './sources/musicbrainz.js'

export const albumStore = createAlbumStore(indexedDbBackend())

// The details that were prepared in the repository, for the albums of the curated list only (any
// other id would only give a 404)
let listed = null
const listedIds = () => listed ??= loadAlbumList().then(list => new Set(list.map(album => album.id)))

async function loadPrebuilt(id) {
    if (!(await listedIds()).has(id)) return null
    const response = await fetch(new URL(`../data/details/${id}.json`, import.meta.url))
    return response.ok ? response.json() : null
}

export const getAlbum = createCachedSource({ fetchAlbum: musicbrainz.getAlbum, store: albumStore, loadPrebuilt }).getAlbum

// Searching needs MusicBrainz. Without it (offline, or it is not answering) the albums that are
// known here are searched instead: the curated list and the albums that were opened before.
export async function searchAlbums(query, signal) {
    if (globalThis.navigator?.onLine !== false) {
        try {
            return await musicbrainz.searchAlbums(query, signal)
        } catch (error) {
            if (error.name === 'AbortError') throw error
            const local = await searchKnown(query)
            if (local.length === 0) throw error
            return local
        }
    }
    return searchKnown(query)
}

async function searchKnown(query) {
    const [list, stored] = await Promise.all([loadAlbumList(), albumStore.all()])
    return searchLocal(query, { listed: list, stored })
}
