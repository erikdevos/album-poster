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

// ---------- The details of an album, as kept in data/details/<id>.json ----------
// { v, fetchedAt, album }: `album` is what getAlbum gives (see sources/musicbrainz.js), `fetchedAt` is
// when it came from MusicBrainz, in milliseconds, and `v` is the version of this shape (albumCache.js)

const MAX_TEXT = 500
const MAX_TRACKS = 500
const text = (value, what, { required = false } = {}) => {
    if (typeof value !== 'string' || value.length > MAX_TEXT) throw new Error(`${what} has to be text.`)
    if (required && !value.trim()) throw new Error(`${what} is empty.`)
    return value
}
const url = (value, what) => {
    if (value !== '' && !/^https:\/\//.test(text(value, what))) throw new Error(`${what} has to be an https link or empty.`)
    return value
}

// The clean record, or throws an Error that says what is wrong
export function validateDetails(record, id) {
    if (!record || typeof record !== 'object') throw new Error('The details are not an object.')
    const { v, fetchedAt, album } = record
    if (!Number.isInteger(v) || v < 1) throw new Error('The details have no version.')
    if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) throw new Error('The details have no date.')
    if (!album || typeof album !== 'object') throw new Error('The details have no album.')
    if (album.id !== id || !isValidId(id)) throw new Error('The details are for another album.')
    if (!Array.isArray(album.tracks) || album.tracks.length > MAX_TRACKS) throw new Error('The tracks are not a list.')

    return {
        v,
        fetchedAt,
        album: {
            id,
            title: text(album.title, 'The title', { required: true }),
            artist: text(album.artist, 'The artist', { required: true }),
            year: text(album.year ?? '', 'The year'),
            barcode: text(album.barcode ?? '', 'The barcode'),
            label: text(album.label ?? '', 'The label'),
            genre: text(album.genre ?? '', 'The genre'),
            tracks: album.tracks.map(track => ({ number: text(String(track.number ?? ''), 'A track number'), title: text(track.title ?? '', 'A track title') })),
            front: url(album.front ?? '', 'The cover'),
            back: url(album.back ?? '', 'The back cover'),
            frontFull: url(album.frontFull ?? '', 'The original cover'),
            backFull: url(album.backFull ?? '', 'The original back cover')
        }
    }
}

export const formatDetails = (record, id) => JSON.stringify(validateDetails(record, id), null, 2) + '\n'
