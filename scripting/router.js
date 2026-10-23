// The URL is the single source of truth: `?size=s&theme=dark#<album id>`.
// The legacy form `#<id>?theme=dark` is still understood, so old links keep working.
// Albums are MusicBrainz release-group ids. Old links with a numeric TheAudioDB id are
// translated by main.js using `audiodbId` in data/albums.json.

import { isValidId } from './source.js'

const LEGACY_ID = /^\d+$/

export function parseLocation() {
    const [rawId, hashQuery = ''] = window.location.hash.replace(/^#/, '').split('?')
    const params = new URLSearchParams(window.location.search)
    new URLSearchParams(hashQuery).forEach((value, key) => {
        if (!params.has(key)) params.set(key, value)
    })

    return { albumId: rawId.trim(), params }
}

export const isLegacyId = id => LEGACY_ID.test(id)
export { isValidId }

export function navigateToAlbum(albumId) {
    window.location.hash = albumId
}

// Swaps the album id in the hash without adding a history entry
export function replaceAlbumId(albumId) {
    const url = new URL(window.location.href)
    url.hash = albumId
    history.replaceState(null, '', url)
}

export function onAlbumChange(callback) {
    window.addEventListener('hashchange', () => callback(parseLocation().albumId))
}
