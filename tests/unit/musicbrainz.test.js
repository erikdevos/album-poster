import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
    settings, buildSearchQuery, rankGroups, secure, searchAlbums, getAlbum, isValidId
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

test('search query: every word must match, the last one as a prefix', () => {
    const query = buildSearchQuery('abbey road')
    assert.match(query, /\(releasegroup:abbey OR artist:abbey\) AND \(releasegroup:road\* OR artist:road\*\)/)
    assert.match(query, /primarytype:album/)
    assert.match(query, /NOT secondarytype:\(compilation OR live OR remix/)
})

test('search query: handles accents and strips Lucene syntax', () => {
    assert.match(buildSearchQuery('Rosalía'), /releasegroup:Rosalía\*/)
    const query = buildSearchQuery('a"b) OR (c')
    assert.doesNotMatch(query.split(' AND primarytype')[0], /["()]\s*OR \(c/)
})

test('search query: too short or empty gives nothing to search for', () => {
    assert.equal(buildSearchQuery(''), null)
    assert.equal(buildSearchQuery(' a'), null)
    assert.equal(buildSearchQuery('!!'), null)
})

test('ranking: a well known album beats an obscure one with a slightly better score', () => {
    const ranked = rankGroups([
        { id: 'obscure', score: 100, count: 1 },
        { id: 'famous', score: 84, count: 151 },
        { id: 'unknown-count', score: 50 }
    ])
    assert.deepEqual(ranked.map(group => group.id), ['famous', 'obscure', 'unknown-count'])
})

test('old http cover urls are upgraded to https', () => {
    assert.equal(secure('http://coverartarchive.org/x.jpg'), 'https://coverartarchive.org/x.jpg')
    assert.equal(secure('https://coverartarchive.org/x.jpg'), 'https://coverartarchive.org/x.jpg')
})

test('searchAlbums returns at most 8 ranked results in the shape the app uses', async () => {
    const groups = Array.from({ length: 12 }, (_, i) => ({
        id: uuid(100 + i), title: `Album ${i}`, score: 90 - i, count: 1,
        'first-release-date': '1999-01-01', 'artist-credit': [{ name: 'Band' }]
    }))
    fakeFetch([['release-group?query=', () => json({ 'release-groups': groups })]])

    const results = await searchAlbums('album')
    assert.equal(results.length, 8)
    assert.deepEqual(results[0], { id: uuid(100), title: 'Album 0', artist: 'Band', year: '1999' })
    assert.equal(calls.length, 1)
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
        back: 'https://x/back-500.jpg'
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
