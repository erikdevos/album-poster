// What the wall (the grid of all albums) shows, and in which order you browse the list.
// Pure functions, no DOM.

export const SORTS = ['added', 'artist', 'title']
export const GROUPS = ['none', 'artist']

// Lower case without accents, so "Rosalía" is found by "rosalia" and "Ænima" by "aenima"
const LIGATURES = { æ: 'ae', œ: 'oe', ø: 'o', ß: 'ss' }
const plain = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[æœøß]/g, letter => LIGATURES[letter]).trim()

// What a name is sorted on: "The Beatles" is under B
const sortKey = text => plain(text).replace(/^(the|a|an) /, '')

const compare = (a, b) => sortKey(a).localeCompare(sortKey(b), 'en', { numeric: true, sensitivity: 'base' })

// `albums` come newest first, as albumList.js loads them. "added" keeps that order.
export function sortAlbums(albums, sort) {
    const copy = [...albums]
    if (sort === 'title') return copy.sort((a, b) => compare(a.name, b.name) || compare(a.artist, b.artist))
    if (sort === 'artist') return copy.sort((a, b) => compare(a.artist, b.artist) || compare(a.name, b.name))
    return copy
}

// Every word has to be in the title or the artist
export function filterAlbums(albums, query) {
    const words = plain(query ?? '').split(/\s+/).filter(Boolean)
    if (words.length === 0) return albums
    return albums.filter(album => {
        const text = plain(`${album.name} ${album.artist}`)
        return words.every(word => text.includes(word))
    })
}

// [{ artist, albums }], in the order the artists first come up
export function groupByArtist(albums) {
    const groups = new Map()
    for (const album of albums) {
        if (!groups.has(album.artist)) groups.set(album.artist, [])
        groups.get(album.artist).push(album)
    }
    return [...groups].map(([artist, list]) => ({ artist, albums: list }))
}

// The order in which the previous and next buttons go through the list: by artist, then by title
export const browseOrder = albums => sortAlbums(albums, 'artist')

// The albums before and after `id` in the browse order, going round at the ends.
// Null when the album is not in the list (one found with the search box).
export function neighbours(albums, id) {
    const order = browseOrder(albums)
    const index = order.findIndex(album => album.id === id)
    if (index === -1) return null
    return {
        previous: order[(index - 1 + order.length) % order.length],
        next: order[(index + 1) % order.length]
    }
}

export const MIN_COVER_REM = 6
export const MAX_COVER_REM = 20
export const DEFAULT_COVER_REM = 10

// The wall's settings from the URL: ?q=muse&sort=artist&group=artist&size=12
export function wallOptions(params) {
    const size = Number(params.get('size'))
    return {
        query: params.get('q') ?? '',
        sort: SORTS.includes(params.get('sort')) ? params.get('sort') : 'artist',
        group: GROUPS.includes(params.get('group')) ? params.get('group') : 'none',
        size: Number.isFinite(size) && params.has('size')
            ? Math.min(MAX_COVER_REM, Math.max(MIN_COVER_REM, size))
            : DEFAULT_COVER_REM
    }
}

// The URL parameters for these settings; what is the default is left out
export function wallParams({ query, sort, group, size }, base = new URLSearchParams()) {
    const params = new URLSearchParams(base)
    const set = (name, value, isDefault) => isDefault ? params.delete(name) : params.set(name, value)
    set('q', query, !query)
    set('sort', sort, sort === 'artist')
    set('group', group, group === 'none')
    set('size', size, size === DEFAULT_COVER_REM)
    return params
}

// The options of the poster page that stay when you go from the wall to an album
export const POSTER_PARAMS = ['layout', 'theme', 'colors']

export function posterLink(id, params) {
    const kept = new URLSearchParams()
    for (const name of POSTER_PARAMS) {
        if (params.has(name)) kept.set(name, params.get(name))
    }
    const query = kept.toString()
    return `../${query ? `?${query}` : ''}#${id}`
}
