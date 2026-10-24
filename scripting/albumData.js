// The curated list in data/albums.json: what a valid list is and how it is written to disk.
// Used by the admin page and by the admin server, so both agree. Pure functions, no DOM.

import { isValidId } from './sources/musicbrainz.js'

const LEGACY_ID = /^\d+$/

// The clean list, or throws an Error that says what is wrong. Only the known fields are kept.
export function validateAlbums(list) {
    if (!Array.isArray(list)) throw new Error('The list has to be an array.')

    const ids = new Set()
    const legacyIds = new Set()
    return list.map((entry, index) => {
        const at = `Album ${index + 1}`
        if (!entry || typeof entry !== 'object') throw new Error(`${at} is not an object.`)

        const id = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : ''
        const name = typeof entry.name === 'string' ? entry.name.trim() : ''
        const artist = typeof entry.artist === 'string' ? entry.artist.trim() : ''
        if (!isValidId(id)) throw new Error(`${at} has no valid MusicBrainz id.`)
        if (!name) throw new Error(`${at} has no name.`)
        if (!artist) throw new Error(`${name} has no artist.`)
        if (ids.has(id)) throw new Error(`${name} is in the list twice.`)
        ids.add(id)

        const clean = { id }
        if (entry.audiodbId !== undefined && entry.audiodbId !== null && entry.audiodbId !== '') {
            const legacy = String(entry.audiodbId)
            if (!LEGACY_ID.test(legacy)) throw new Error(`${name} has a bad audiodbId.`)
            if (legacyIds.has(legacy)) throw new Error(`${name} has an audiodbId that another album has too.`)
            legacyIds.add(legacy)
            clean.audiodbId = legacy
        }
        return { ...clean, name, artist }
    })
}

// The file as it is written: two spaces, a newline at the end, the fields in a fixed order
export const formatAlbums = list => JSON.stringify(validateAlbums(list), null, 2) + '\n'

// A MusicBrainz id from what someone pasted: the id itself, or a link to a release group
export function idFromText(text) {
    const match = String(text ?? '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    return match ? match[0].toLowerCase() : null
}

// What changed between the list on disk and the list in the page, by id
export function diffAlbums(saved, current) {
    const before = new Set(saved.map(album => album.id))
    const after = new Set(current.map(album => album.id))
    const byId = new Map(saved.map(album => [album.id, album]))
    return {
        added: current.filter(album => !before.has(album.id)),
        removed: saved.filter(album => !after.has(album.id)),
        edited: current.filter(album => {
            const old = byId.get(album.id)
            return old && (old.name !== album.name || old.artist !== album.artist)
        })
    }
}
