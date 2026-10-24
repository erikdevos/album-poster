import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    SCHEMA, TTL_MS, makeRecord, memoryBackend, createAlbumStore, createCachedSource, searchLocal
} from '../../scripting/albumCache.js'

const ID = 'bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0'
const album = (title = 'LUX', id = ID) => ({ id, title, artist: 'Rosalia', year: '2025', tracks: [] })
const DAY = 24 * 60 * 60 * 1000

// A source with a fake MusicBrainz that counts its calls, a store in memory and a clock that can be moved
function setup({ prebuilt = null, offline = false, fetchError = null } = {}) {
    const clock = { time: 1_000_000_000_000 }
    const calls = []
    const store = createAlbumStore(memoryBackend())
    const source = createCachedSource({
        fetchAlbum: async id => {
            calls.push(id)
            if (fetchError) throw fetchError
            return album('LUX (fetched)', id)
        },
        store,
        loadPrebuilt: async () => prebuilt,
        now: () => clock.time,
        online: () => !offline,
        refreshAfterMs: 0
    })
    return { clock, calls, store, source }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 20))

test('an album that was never fetched comes from MusicBrainz, and is kept', async () => {
    const { calls, store, source } = setup()
    assert.equal((await source.getAlbum(ID)).title, 'LUX (fetched)')
    assert.deepEqual(calls, [ID])
    const kept = await store.get(ID)
    assert.equal(kept.album.title, 'LUX (fetched)')
    assert.equal(kept.v, SCHEMA)
})

test('the second time it comes from memory, and a new visit from the store, without asking MusicBrainz', async () => {
    const { calls, store, clock } = setup()
    const first = createCachedSource({ fetchAlbum: async id => { calls.push(id); return album() }, store, now: () => clock.time })
    await first.getAlbum(ID)
    await first.getAlbum(ID)
    assert.equal(calls.length, 1)

    // a new page: nothing in memory, but the store has it
    const second = createCachedSource({ fetchAlbum: async id => { calls.push(id); return album('other') }, store, now: () => clock.time })
    assert.equal((await second.getAlbum(ID)).title, 'LUX')
    assert.equal(calls.length, 1)
})

test('a copy older than the limit is shown at once and refreshed in the background', async () => {
    const { calls, store, clock, source } = setup()
    await store.put(ID, makeRecord(album('LUX (old)'), clock.time - TTL_MS - DAY))
    assert.equal((await source.getAlbum(ID)).title, 'LUX (old)') // no waiting for MusicBrainz
    await flush()
    assert.deepEqual(calls, [ID])
    assert.equal((await store.get(ID)).album.title, 'LUX (fetched)')
    assert.equal((await store.get(ID)).fetchedAt, clock.time)
})

test('offline, an old copy is shown and nothing is fetched', async () => {
    const { calls, store, clock, source } = setup({ offline: true })
    await store.put(ID, makeRecord(album('LUX (old)'), clock.time - 10 * TTL_MS))
    assert.equal((await source.getAlbum(ID)).title, 'LUX (old)')
    await flush()
    assert.deepEqual(calls, [])
})

test('a refresh that fails leaves the copy as it was', async () => {
    const { store, clock, source } = setup({ fetchError: new Error('busy') })
    await store.put(ID, makeRecord(album('LUX (old)'), clock.time - 2 * TTL_MS))
    await source.getAlbum(ID)
    await flush()
    assert.equal((await store.get(ID)).album.title, 'LUX (old)')
})

test('an album that is not kept and cannot be fetched is an error', async () => {
    const { source } = setup({ fetchError: new Error('offline') })
    await assert.rejects(source.getAlbum(ID), /offline/)
})

test('the prepared details are used without asking MusicBrainz, and kept', async () => {
    const prebuilt = makeRecord(album('LUX (prepared)'), 1_000_000_000_000 - DAY)
    const { calls, store, source } = setup({ prebuilt })
    assert.equal((await source.getAlbum(ID)).title, 'LUX (prepared)')
    assert.deepEqual(calls, [])
    assert.equal((await store.get(ID)).album.title, 'LUX (prepared)')
})

test('prepared details that are old are used and refreshed; the newer of store and prepared wins', async () => {
    const { calls, store, clock, source } = setup({ prebuilt: makeRecord(album('LUX (prepared)'), 1_000_000_000_000 - 3 * TTL_MS) })
    assert.equal((await source.getAlbum(ID)).title, 'LUX (prepared)')
    await flush()
    assert.deepEqual(calls, [ID])

    const second = setup({ prebuilt: makeRecord(album('LUX (prepared)'), 1_000_000_000_000 - 3 * TTL_MS) })
    await second.store.put(ID, makeRecord(album('LUX (stored)'), second.clock.time - 2 * TTL_MS))
    assert.equal((await second.source.getAlbum(ID)).title, 'LUX (stored)') // newer than the prepared one
})

test('prepared details for another album, or of another version, are ignored', async () => {
    const wrongId = setup({ prebuilt: makeRecord(album('x', 'cccccccc-0000-4000-8000-000000000000')) })
    assert.equal((await wrongId.source.getAlbum(ID)).title, 'LUX (fetched)')

    const oldVersion = setup({ prebuilt: { ...makeRecord(album('x')), v: SCHEMA + 1 } })
    assert.equal((await oldVersion.source.getAlbum(ID)).title, 'LUX (fetched)')
})

test('a record of another version in the store is not used', async () => {
    const { store, source } = setup()
    await store.put(ID, { ...makeRecord(album('LUX (old shape)')), v: SCHEMA + 1 })
    assert.equal(await store.get(ID), null)
    assert.equal((await source.getAlbum(ID)).title, 'LUX (fetched)')
})

test('a store whose storage fails acts as an empty one', async () => {
    const broken = createAlbumStore({
        get: async () => { throw new Error('no storage') }, put: async () => { throw new Error('no storage') },
        delete: async () => { throw new Error('x') }, getAll: async () => { throw new Error('x') }, clear: async () => { throw new Error('x') }
    })
    const source = createCachedSource({ fetchAlbum: async id => album('LUX (fetched)', id), store: broken })
    assert.equal((await source.getAlbum(ID)).title, 'LUX (fetched)')
    assert.deepEqual(await broken.all(), [])
    assert.equal(await broken.get(ID), null)
})

test('the store lists and clears what it holds', async () => {
    const store = createAlbumStore(memoryBackend())
    await store.put(ID, makeRecord(album()))
    await store.put('cccccccc-0000-4000-8000-000000000000', makeRecord(album('Other', 'cccccccc-0000-4000-8000-000000000000')))
    assert.equal((await store.all()).length, 2)
    await store.delete(ID)
    assert.equal((await store.all()).length, 1)
    await store.clear()
    assert.deepEqual(await store.all(), [])
})

test('searching without a connection looks at the curated list and at the albums that were opened', () => {
    const listed = [{ id: ID, name: 'LUX', artist: 'Rosalia' }, { id: 'cccccccc-0000-4000-8000-000000000000', name: 'Abbey Road', artist: 'The Beatles' }]
    const stored = [makeRecord({ ...album('Back To Black'), artist: 'Amy Winehouse', id: 'dddddddd-0000-4000-8000-000000000000', year: '2006' })]
        .map(record => ({ id: record.album.id, ...record }))
    assert.deepEqual(searchLocal('beatles', { listed, stored }).map(found => found.title), ['Abbey Road'])
    assert.deepEqual(searchLocal('AMY black', { listed, stored }), [{ id: 'dddddddd-0000-4000-8000-000000000000', title: 'Back To Black', artist: 'Amy Winehouse', year: '2006' }])
    assert.deepEqual(searchLocal('zzz', { listed, stored }), [])
    // an album that is both in the list and opened before is found once, with the year
    const both = searchLocal('lux', { listed, stored: [{ id: ID, ...makeRecord(album()) }] })
    assert.deepEqual(both, [{ id: ID, title: 'LUX', artist: 'Rosalia', year: '2025' }])
})
