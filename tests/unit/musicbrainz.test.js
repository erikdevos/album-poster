import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
    settings, buildSearchQuery, rankGroups, secure, searchAlbums, getAlbum, isValidId,
    buildRandomQuery, randomAlbumId, RANDOM_TAGS, normalize
} from '../../scripting/sources/musicbrainz.js'

settings.minGapMs = 0 // no waiting between requests in tests

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

// Every test installs its own fake fetch: routes are [substring of the URL, handler]
let calls
function fakeFetch(routes) {
    calls = []
    globalThis.fetch = async url => {
        calls.push(String(url))
        const route = routes.find(([part]) => String(url).includes(part))
        if (!route) throw new Error(`unexpected request: ${url}`)
        return route[1](String(url))
    }
}

beforeEach(() => { calls = [] })

const release = {
    title: 'Release title',
    date: '2001-05-06',
    'artist-credit': [{ name: 'A', joinphrase: ' & ' }, { name: 'B' }],
    'label-info': [{ label: null }, { label: { name: 'Columbia' } }],
    'release-group': {
        title: 'Album title',
        'first-release-date': '2001-05-06',
        genres: [{ name: 'pop', count: 2 }, { name: 'rock', count: 5 }, { name: 'folk', count: 1 }]
    },
    media: [
        { tracks: [{ number: '1', title: 'One' }, { number: '2', title: 'Two' }] },
        { tracks: [{ number: '3', title: 'Three' }] }
    ]
}

test('isValidId only accepts a MusicBrainz id', () => {
    assert.equal(isValidId(uuid(1)), true)
    assert.equal(isValidId(uuid(1).toUpperCase()), true)
    assert.equal(isValidId('123'), false)
    assert.equal(isValidId(`${uuid(1)}x`), false)
})

test('search query: every word must match, the last one as a prefix, and the whole text as a phrase', () => {
    const query = buildSearchQuery('abbey road')
    assert.match(query, /\(releasegroup:abbey OR artist:abbey\) AND \(releasegroup:road\* OR artist:road\*\)/)
    assert.match(query, /releasegroup:"abbey road"\^5 OR artist:"abbey road"\^5/)
})

test('search query: albums and EPs, without live albums, compilations and the like', () => {
    const query = buildSearchQuery('katseye')
    assert.match(query, /\(primarytype:album OR primarytype:ep\)/)
    assert.match(query, /NOT secondarytype:\(compilation OR live OR remix/)
    assert.doesNotMatch(query, /releases:/)
})

test('search query: the popular variant asks for many releases, the singles variant drops the type', () => {
    assert.match(buildSearchQuery('beatles', { popular: true }), /releases:\[15 TO \*\]/)
    const singles = buildSearchQuery('katseye', { singles: true })
    assert.doesNotMatch(singles, /primarytype/)
    assert.match(singles, /NOT secondarytype/)
})

test('search query: handles accents and strips Lucene syntax', () => {
    assert.match(buildSearchQuery('Rosalía'), /releasegroup:Rosalía\*/)
    const query = buildSearchQuery('a"b) OR (c')
    assert.doesNotMatch(query.split(' AND NOT secondarytype')[0], /["()]\s*OR \(c/)
    assert.match(query, /"a b OR c"\^5/) // only letters and digits are left of what was typed
})

test('search query: too short or empty gives nothing to search for', () => {
    assert.equal(buildSearchQuery(''), null)
    assert.equal(buildSearchQuery(' a'), null)
    assert.equal(buildSearchQuery('!!'), null)
})

test('normalize ignores case, accents and punctuation', () => {
    assert.equal(normalize('ROSALÍA'), normalize('rosalia'))
    assert.equal(normalize("Sgt. Pepper's"), 'sgtpeppers')
    assert.equal(normalize('KATSEYE'), 'katseye')
})

const group = (id, title, artist, { score = 100, count = 1, type = 'Album' } = {}) =>
    ({ id, title, score, count, 'primary-type': type, 'artist-credit': [{ name: artist }] })

test('ranking: a well known album beats an obscure one with a better score', () => {
    const ranked = rankGroups([
        group('obscure', 'Beatles Tribute', 'Nobody', { score: 100, count: 1 }),
        group('famous', 'Abbey Road', 'The Beatles', { score: 76, count: 73 }),
        group('unknown-count', 'Something', 'Someone', { score: 50, count: undefined })
    ], 'beatles')
    assert.deepEqual(ranked.map(item => item.id), ['famous', 'obscure', 'unknown-count'])
})

test('ranking: an exact title or artist is put first, also with other letters and accents', () => {
    const ranked = rankGroups([
        group('other', 'Lux Aeterna', 'Clint Mansell', { score: 100, count: 5 }),
        group('exact', 'LUX', 'ROSALÍA', { score: 51, count: 6 }),
        group('artist', 'Motomami', 'Lux', { score: 51, count: 6 })
    ], 'lux')
    assert.deepEqual(ranked.map(item => item.id).slice(0, 2).sort(), ['artist', 'exact'])
    assert.equal(rankGroups([group('a', 'Dile', 'Rosalía'), group('b', 'Xyz', 'Someone')], 'ROSALIA')[0].id, 'a')
})

test('ranking: an EP counts for less than an album, but popular EPs of one artist keep their order', () => {
    assert.equal(rankGroups([group('ep', 'Thriller', 'Thriller', { type: 'EP', count: 1 }), group('album', 'Thriller', 'Michael Jackson', { count: 85 })], 'thriller')[0].id, 'album')

    const katseye = rankGroups([
        group('sis', 'SIS (Soft Is Strong)', 'KATSEYE', { type: 'EP', count: 14 }),
        group('wild', 'WILD', 'KATSEYE', { type: 'EP', count: 37 }),
        group('chaos', 'BEAUTIFUL CHAOS', 'KATSEYE', { type: 'EP', count: 23 })
    ], 'katseye')
    assert.deepEqual(katseye.map(item => item.id), ['wild', 'chaos', 'sis'])
})

test('ranking: all albums of an exact artist are equally relevant, so the best known comes first', () => {
    // Abbey Road does not have "beatles" in its title, so MusicBrainz scores it lower than "The Beatles"
    const ranked = rankGroups([
        group('white', 'The Beatles', 'The Beatles', { score: 100, count: 58 }),
        group('abbey', 'Abbey Road', 'The Beatles', { score: 76, count: 73 }),
        group('sale', 'Beatles for Sale', 'The Beatles', { score: 93, count: 53 })
    ], 'beatles')
    assert.deepEqual(ranked.map(item => item.id), ['abbey', 'white', 'sale'])
})

test('ranking: "the" at the start of a name does not matter when comparing', () => {
    const ranked = rankGroups([
        group('x', 'Something', 'Someone Else', { score: 100, count: 30 }),
        group('weeknd', 'After Hours', 'The Weeknd', { score: 60, count: 20 })
    ], 'weeknd')
    assert.equal(ranked[0].id, 'weeknd')
})

test('ranking does not change the list it is given', () => {
    const input = [group('a', 'A', 'X', { count: 1 }), group('b', 'B', 'Y', { count: 50 })]
    rankGroups(input, 'q')
    assert.deepEqual(input.map(item => item.id), ['a', 'b'])
})

test('old http cover urls are upgraded to https', () => {
    assert.equal(secure('http://coverartarchive.org/x.jpg'), 'https://coverartarchive.org/x.jpg')
    assert.equal(secure('https://coverartarchive.org/x.jpg'), 'https://coverartarchive.org/x.jpg')
})

test('searchAlbums does the best matches and the popular ones together, ranked, at most 8', async () => {
    const make = (count, offset) => Array.from({ length: count }, (_, i) =>
        ({ ...group(uuid(offset + i), `Album ${offset + i}`, 'Band', { score: 90, count: 1 + i }), 'first-release-date': '1999-01-01' }))
    fakeFetch([['release-group?query=', url => json({ 'release-groups': url.includes('releases%3A%5B15') ? make(5, 200) : make(8, 100) })]])

    const results = await searchAlbums('album')
    assert.equal(calls.length, 2, 'one search for the best matches, one for the popular ones')
    assert.ok(calls.some(url => url.includes('releases%3A%5B15')))
    assert.equal(results.length, 8)
    assert.deepEqual(results[0], { id: uuid(107), title: 'Album 107', artist: 'Band', year: '1999' }) // most releases first
    assert.equal(new Set(results.map(item => item.id)).size, 8, 'no album twice')
})

test('searchAlbums does not list an album twice when both searches find it', async () => {
    const same = [group(uuid(40), 'Abbey Road', 'The Beatles', { count: 73 })]
    fakeFetch([['release-group?query=', () => json({ 'release-groups': same })]])
    assert.equal((await searchAlbums('abbey road')).length, 1)
})

test('searchAlbums finds an artist that only has EPs, like KATSEYE', async () => {
    const eps = [
        group(uuid(50), 'SIS (Soft Is Strong)', 'KATSEYE', { type: 'EP', count: 14 }),
        group(uuid(51), 'BEAUTIFUL CHAOS', 'KATSEYE', { type: 'EP', count: 23 })
    ]
    fakeFetch([['release-group?query=', () => json({ 'release-groups': eps })]])
    const results = await searchAlbums('KATSEYE')
    assert.deepEqual(results.map(item => item.title), ['BEAUTIFUL CHAOS', 'SIS (Soft Is Strong)'])
    assert.equal(calls.length, 2)
})

test('searchAlbums includes singles only when there is nothing else', async () => {
    fakeFetch([['release-group?query=', url => json({
        'release-groups': url.includes('primarytype') ? [] : [group(uuid(60), 'Only a single', 'Some Artist', { type: 'Single' })]
    })]])
    const results = await searchAlbums('some artist')
    assert.deepEqual(results.map(item => item.title), ['Only a single'])
    assert.equal(calls.length, 3, 'best, popular, and then the singles')
    assert.doesNotMatch(calls.at(-1), /primarytype/)
})

test('searchAlbums gives an empty list when nothing is found at all', async () => {
    fakeFetch([['release-group?query=', () => json({ 'release-groups': [] })]])
    assert.deepEqual(await searchAlbums('zzzzzz'), [])
})

test('searchAlbums does not call the network for a query that is too short', async () => {
    fakeFetch([])
    assert.deepEqual(await searchAlbums('a'), [])
    assert.equal(calls.length, 0)
})

test('getAlbum combines Cover Art Archive and MusicBrainz', async () => {
    const id = uuid(1)
    fakeFetch([
        [`coverartarchive.org/release-group/${id}`, () => json({
            release: 'https://musicbrainz.org/release/' + uuid(2),
            images: [
                { types: ['Back'], image: 'http://x/back.jpg', thumbnails: { 500: 'http://x/back-500.jpg' } },
                { types: ['Front'], image: 'http://x/front.jpg', thumbnails: { 1200: 'http://x/front-1200.jpg' } }
            ]
        })],
        [`musicbrainz.org/ws/2/release/${uuid(2)}`, () => json(release)]
    ])

    const album = await getAlbum(id)
    assert.deepEqual(album, {
        id,
        title: 'Album title',
        artist: 'A & B',
        year: '2001',
        label: 'Columbia',
        genre: 'rock / pop',
        tracks: [{ number: '1', title: 'One' }, { number: '2', title: 'Two' }, { number: '3', title: 'Three' }],
        front: 'https://x/front-1200.jpg',
        back: 'https://x/back-500.jpg',
        frontFull: 'https://x/front.jpg',
        backFull: 'https://x/back.jpg'
    })
})

test('getAlbum remembers albums it has already fetched', async () => {
    const id = uuid(3)
    fakeFetch([
        [`coverartarchive.org/release-group/${id}`, () => json({ release: 'https://musicbrainz.org/release/' + uuid(4), images: [] })],
        [`release/${uuid(4)}`, () => json(release)]
    ])
    await getAlbum(id)
    const before = calls.length
    await getAlbum(id)
    assert.equal(calls.length, before)
})

test('without cover art the earliest official release is used, and there are no covers', async () => {
    const id = uuid(5)
    fakeFetch([
        [`coverartarchive.org/release-group/${id}`, () => json({}, 404)],
        [`release-group/${id}?inc=releases`, () => json({
            releases: [
                { id: uuid(6), status: 'Bootleg', date: '1990-01-01' },
                { id: uuid(7), status: 'Official', date: '2005-01-01' },
                { id: uuid(8), status: 'Official', date: '2001-01-01' }
            ]
        })],
        [`release/${uuid(8)}`, () => json(release)]
    ])

    const album = await getAlbum(id)
    assert.equal(album.front, '')
    assert.equal(album.back, '')
    assert.equal(album.frontFull, '')
    assert.equal(album.tracks.length, 3)
    assert.ok(calls.some(url => url.includes(`release/${uuid(8)}`)))
})

test('a 503 from MusicBrainz is retried', async () => {
    const id = uuid(9)
    let attempts = 0
    fakeFetch([
        [`coverartarchive.org/release-group/${id}`, () => json({ release: 'https://musicbrainz.org/release/' + uuid(10), images: [] })],
        [`release/${uuid(10)}`, () => (++attempts < 3 ? json({}, 503) : json(release))]
    ])
    const album = await getAlbum(id)
    assert.equal(album.title, 'Album title')
    assert.equal(attempts, 3)
})

test('a persistent 503 ends in an error after three attempts', async () => {
    const id = uuid(11)
    let attempts = 0
    fakeFetch([
        [`coverartarchive.org/release-group/${id}`, () => json({ release: 'https://musicbrainz.org/release/' + uuid(12), images: [] })],
        [`release/${uuid(12)}`, () => { attempts++; return json({}, 503) }]
    ])
    await assert.rejects(() => getAlbum(id), error => error.status === 503)
    assert.equal(attempts, 3)
})

test('a 404 from MusicBrainz is not retried', async () => {
    const id = uuid(13)
    let attempts = 0
    fakeFetch([
        [`coverartarchive.org/release-group/${id}`, () => json({}, 404)],
        [`release-group/${id}?inc=releases`, () => { attempts++; return json({}, 404) }]
    ])
    await assert.rejects(() => getAlbum(id), error => error.status === 404)
    assert.equal(attempts, 1)
})

test('the random query: a genre, only albums, no live or compilations, a minimum of releases', () => {
    const { query, offset } = buildRandomQuery(() => 0.99) // 0.99 means no decade
    assert.match(query, new RegExp(`tag:"${RANDOM_TAGS.at(-1)}"`))
    assert.match(query, /primarytype:album/)
    assert.match(query, /NOT secondarytype:\(compilation OR live/)
    assert.match(query, /releases:\[8 TO \*\]/)
    assert.doesNotMatch(query, /firstreleasedate/)
    assert.equal(offset, 275) // the last page of 25 within the first 300
})

test('the random query sometimes limits to a decade, and always pages in steps of 25', () => {
    const { query, offset } = buildRandomQuery(() => 0.1)
    assert.match(query, /firstreleasedate:\[1960 TO 1969\]/)
    assert.equal(offset, 25) // floor(0.1 * 12) pages of 25

    for (let i = 0; i < 50; i++) assert.equal(buildRandomQuery().offset % 25, 0)
})

test('randomAlbumId picks one of the results', async () => {
    fakeFetch([['release-group?query=', () => json({ 'release-groups': [{ id: uuid(20) }, { id: uuid(21) }, { id: uuid(22) }] })]])
    const id = await randomAlbumId(undefined, () => 0.5)
    assert.equal(id, uuid(21))
})

test('randomAlbumId searches again when a page is empty, and gives up after four tries', async () => {
    let searches = 0
    fakeFetch([['release-group?query=', () => json({ 'release-groups': ++searches < 3 ? [] : [{ id: uuid(30) }] })]])
    assert.equal(await randomAlbumId(undefined, () => 0.2), uuid(30))
    assert.equal(searches, 3)

    searches = -100
    fakeFetch([['release-group?query=', () => { searches++; return json({ 'release-groups': [] }) }]])
    await assert.rejects(() => randomAlbumId(undefined, () => 0.2), /No random album/)
    assert.equal(searches, -96)
})
