// Album data source: MusicBrainz (metadata + tracks) and Cover Art Archive (covers).
// Both send `access-control-allow-origin: *`, also on the redirect to the image files, so the
// covers can be read from a canvas for colour extraction without a proxy.
//
// Every source exposes the same two functions, so another one can be swapped in (see ../source.js):
//   searchAlbums(query, signal) -> [{ id, title, artist, year }]
//   randomAlbumId(signal, random) -> the id of a fairly well known album, picked at random
//   getAlbum(id, signal)        -> { id, title, artist, year, label, genre, tracks, front, back,
//                                    frontFull, backFull }   (the last two are the original, big images)

const MB = 'https://musicbrainz.org/ws/2'
const CAA = 'https://coverartarchive.org'
// MusicBrainz allows about one request per second; tests set the gap to 0
export const settings = { minGapMs: 1100 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isValidId = id => UUID.test(id)

const albumCache = new Map()
let lastMusicBrainzCall = 0
let queue = Promise.resolve()

// Runs MusicBrainz requests one after another, with a gap in between
function throttled(task) {
    const run = queue.then(async () => {
        const wait = lastMusicBrainzCall + settings.minGapMs - Date.now()
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
        lastMusicBrainzCall = Date.now()
        return task()
    })
    queue = run.catch(() => {})
    return run
}

async function getJson(url, signal) {
    const response = await fetch(url, { signal })
    if (!response.ok) {
        const error = new Error(`Request failed (${response.status}): ${url}`)
        error.status = response.status
        throw error
    }
    return response.json()
}

// MusicBrainz regularly answers 503 when it is busy or rate limiting; a retry usually succeeds
async function musicBrainz(path, signal, attempts = 3) {
    try {
        return await throttled(() => getJson(`${MB}/${path}&fmt=json`, signal))
    } catch (error) {
        if (attempts <= 1 || ![429, 503].includes(error.status)) throw error
        return musicBrainz(path, signal, attempts - 1)
    }
}

const credit = artistCredit => artistCredit?.map(part => part.name + (part.joinphrase ?? '')).join('') ?? ''
const year = date => date?.slice(0, 4) ?? ''

// Every word has to match the title or the artist, the last one as a prefix (typeahead).
// MusicBrainz knows nothing about popularity, so the hits are re-ranked: the number of releases
// of an album is a good stand-in (a famous album has been released many times).
const EXCLUDED_TYPES = 'compilation OR live OR remix OR demo OR soundtrack OR mixtape OR dj-mix OR ' +
    'spokenword OR interview OR audiobook OR audio-drama OR field-recording'
const POPULARITY_WEIGHT = 30
const MAX_RESULTS = 8

// The Lucene query for what someone typed, or null when it is too short to search
export function buildSearchQuery(query) {
    const words = query.match(/[\p{L}\p{N}]+/gu) ?? []
    if (query.trim().length < 2 || words.length === 0) return null

    const clauses = words.map((word, index) => {
        const term = index === words.length - 1 && word.length >= 2 ? `${word}*` : word
        return `(releasegroup:${term} OR artist:${term})`
    })
    return `${clauses.join(' AND ')} AND primarytype:album AND NOT secondarytype:(${EXCLUDED_TYPES})`
}

// Most relevant and best known first
export function rankGroups(groups) {
    const rank = group => group.score + POPULARITY_WEIGHT * Math.log10(1 + (group.count ?? 1))
    return [...groups].sort((a, b) => rank(b) - rank(a))
}

export async function searchAlbums(query, signal) {
    const lucene = buildSearchQuery(query)
    if (!lucene) return []

    const data = await musicBrainz(`release-group?query=${encodeURIComponent(lucene)}&limit=25`, signal)

    return rankGroups(data['release-groups'])
        .slice(0, MAX_RESULTS)
        .map(group => ({
            id: group.id,
            title: group.title,
            artist: credit(group['artist-credit']),
            year: year(group['first-release-date'])
        }))
}

// ---------- A random album ----------
// MusicBrainz has no "random", so: a random genre, sometimes a random decade, and an album from a
// random page of what matches. Albums with few releases are left out, so that it is mostly albums
// that people know (and that have a cover).

export const RANDOM_TAGS = [
    'rock', 'pop', 'hip hop', 'electronic', 'jazz', 'soul', 'funk', 'metal', 'punk', 'folk', 'blues',
    'reggae', 'country', 'indie rock', 'alternative rock', 'r&b', 'disco', 'house', 'techno', 'ambient',
    'singer-songwriter', 'synthpop', 'new wave', 'hard rock', 'progressive rock', 'latin'
]
const RANDOM_DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020]
const RANDOM_PAGE_SIZE = 25
const RANDOM_PAGES = 12 // the first 300 matches, which are the better known ones

const pick = (items, random) => items[Math.floor(random() * items.length)]

// The search for a random album: { query, offset }
export function buildRandomQuery(random = Math.random) {
    const clauses = [
        `tag:"${pick(RANDOM_TAGS, random)}"`,
        'primarytype:album',
        `NOT secondarytype:(${EXCLUDED_TYPES})`,
        'releases:[8 TO *]'
    ]
    if (random() < 0.6) {
        const decade = pick(RANDOM_DECADES, random)
        clauses.push(`firstreleasedate:[${decade} TO ${decade + 9}]`)
    }
    return { query: clauses.join(' AND '), offset: Math.floor(random() * RANDOM_PAGES) * RANDOM_PAGE_SIZE }
}

export async function randomAlbumId(signal, random = Math.random) {
    for (let attempt = 0; attempt < 4; attempt++) {
        const { query, offset } = buildRandomQuery(random)
        // a page past the last result is empty; the next attempt starts again at a new search
        const path = `release-group?query=${encodeURIComponent(query)}&limit=${RANDOM_PAGE_SIZE}&offset=${offset}`
        const { 'release-groups': groups } = await musicBrainz(path, signal)
        if (groups.length > 0) return pick(groups, random).id
    }
    throw new Error('No random album found')
}

export async function getAlbum(id, signal) {
    if (albumCache.has(id)) return albumCache.get(id)

    const art = await getCoverArt(id, signal)
    const releaseId = art?.releaseId ?? await pickRelease(id, signal)

    const release = await musicBrainz(
        `release/${releaseId}?inc=recordings+labels+artist-credits+release-groups+genres`, signal)
    const group = release['release-group'] ?? {}

    const album = {
        id,
        title: group.title ?? release.title,
        artist: credit(release['artist-credit']),
        year: year(group['first-release-date'] ?? release.date),
        label: release['label-info']?.map(info => info.label?.name).find(Boolean) ?? '',
        genre: topGenres(group.genres?.length ? group.genres : release.genres),
        tracks: release.media?.flatMap(medium => medium.tracks ?? []).map(track => ({
            number: track.number,
            title: track.title
        })) ?? [],
        front: art?.front ?? '',
        back: art?.back ?? '',
        frontFull: art?.frontFull ?? '',
        backFull: art?.backFull ?? ''
    }

    albumCache.set(id, album)
    return album
}

// Cover Art Archive redirects a release-group to the release that has the front cover
async function getCoverArt(groupId, signal) {
    try {
        const data = await getJson(`${CAA}/release-group/${groupId}`, signal)
        const image = type => data.images.find(img => img.types.includes(type))
        const front = image('Front')
        const back = image('Back')
        return {
            releaseId: data.release?.split('/').pop(),
            front: front && secure(front.thumbnails['1200'] ?? front.image),
            back: back && secure(back.thumbnails['500'] ?? back.image),
            frontFull: front && secure(front.image),
            backFull: back && secure(back.image)
        }
    } catch (error) {
        if (error.name === 'AbortError') throw error
        return null // no cover art on record for this album
    }
}

// Older entries in the Cover Art Archive still list http:// image URLs, which the browser
// blocks on an https page (mixed content)
export const secure = url => url.replace(/^http:\/\//, 'https://')

// Fallback when there is no cover art: the earliest official release
async function pickRelease(groupId, signal) {
    const data = await musicBrainz(`release-group/${groupId}?inc=releases`, signal)
    const releases = [...data.releases].sort((a, b) =>
        (a.status === 'Official' ? 0 : 1) - (b.status === 'Official' ? 0 : 1) ||
        (a.date || '9999').localeCompare(b.date || '9999'))
    if (!releases.length) throw new Error('This album has no releases')
    return releases[0].id
}

function topGenres(genres = []) {
    return [...genres]
        .sort((a, b) => b.count - a.count)
        .slice(0, 2)
        .map(genre => genre.name)
        .join(' / ')
}
