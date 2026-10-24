// Remembers the albums that were fetched, so that they come up at once next time and also work
// offline. Three places are looked at, in this order, and the fetch from MusicBrainz is the last:
//   1. the albums of this visit (in memory),
//   2. this browser's own copy (IndexedDB; see `indexedDbBackend`),
//   3. the details that were prepared in the repository (data/details/<id>.json, see scripts/details.mjs).
// A copy that is older than `ttlMs` is still shown at once (also offline), and is refreshed from
// MusicBrainz in the background, so that corrections there arrive. Pure logic: the storage, the
// fetch and the clock are passed in, so the tests need no browser.

import { filterAlbums } from './wallList.js'

// The version of what is stored. A record with another version is not used: bump it when the shape of
// an album changes.
export const SCHEMA = 1
export const TTL_MS = 30 * 24 * 60 * 60 * 1000
const DB_NAME = 'album-poster'
const STORE = 'albums'

export const makeRecord = (album, now = Date.now()) => ({ v: SCHEMA, fetchedAt: now, album })
const usable = record => record && record.v === SCHEMA && Number.isFinite(record.fetchedAt) && record.album?.id

// ---------- Storage ----------
// A backend has get(id), put(record), delete(id), getAll() and clear(), all async, for { id, v, fetchedAt, album }

export function memoryBackend() {
    const records = new Map()
    return {
        get: async id => records.get(id) ?? null,
        put: async record => { records.set(record.id, record) },
        delete: async id => { records.delete(id) },
        getAll: async () => [...records.values()],
        clear: async () => { records.clear() }
    }
}

// The browser's database. When it cannot be opened (a private window in some browsers, blocked site
// data) every call fails; the store below then acts as if nothing was ever saved.
export function indexedDbBackend(factory = globalThis.indexedDB) {
    let opened = null
    const open = () => opened ??= new Promise((resolve, reject) => {
        if (!factory) return reject(new Error('No IndexedDB'))
        const request = factory.open(DB_NAME, 1)
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
    const run = (mode, action) => open().then(db => new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const request = action(transaction.objectStore(STORE))
        transaction.oncomplete = () => resolve(request?.result ?? null)
        transaction.onerror = transaction.onabort = () => reject(transaction.error)
    }))
    return {
        get: id => run('readonly', store => store.get(id)),
        put: record => run('readwrite', store => store.put(record)),
        delete: id => run('readwrite', store => store.delete(id)),
        getAll: () => run('readonly', store => store.getAll()).then(all => all ?? []),
        clear: () => run('readwrite', store => store.clear())
    }
}

// The same, but a failing backend never throws: a read gives nothing, a write is skipped
export function createAlbumStore(backend) {
    const safe = (action, fallback) => action().catch(() => fallback)
    return {
        async get(id) {
            const row = await safe(() => backend.get(id), null)
            return usable(row) ? row : null
        },
        put: (id, record) => safe(() => backend.put({ id, ...record }), null),
        delete: id => safe(() => backend.delete(id), null),
        async all() { return (await safe(() => backend.getAll(), [])).filter(usable) },
        clear: () => safe(() => backend.clear(), null)
    }
}

// ---------- The source ----------

// fetchAlbum(id, signal) -> album, from MusicBrainz
// loadPrebuilt(id) -> a record from data/details, or null
export function createCachedSource({
    fetchAlbum,
    store,
    loadPrebuilt = async () => null,
    now = () => Date.now(),
    ttlMs = TTL_MS,
    online = () => globalThis.navigator?.onLine !== false,
    refreshAfterMs = 3000
}) {
    const memory = new Map()
    const refreshing = new Set()
    const fresh = record => now() - record.fetchedAt < ttlMs

    // Looks again at MusicBrainz, a little later so that it does not hold up what the person is
    // looking at (MusicBrainz takes about one request a second). Failing is fine: the copy stays.
    function refreshLater(id) {
        if (refreshing.has(id) || !online()) return
        refreshing.add(id)
        setTimeout(async () => {
            try {
                if (online()) {
                    const album = await fetchAlbum(id)
                    await store.put(id, makeRecord(album, now()))
                }
            } catch {
                // offline or busy: next time
            } finally {
                refreshing.delete(id)
            }
        }, refreshAfterMs)
    }

    async function getAlbum(id, signal) {
        if (memory.has(id)) return memory.get(id)

        const stored = await store.get(id)
        let best = stored
        if (!stored || !fresh(stored)) {
            // the prepared details count as a copy too, and the newer of the two is the better one
            const prebuilt = await loadPrebuilt(id).catch(() => null)
            if (usable(prebuilt) && prebuilt.album.id === id && (!best || prebuilt.fetchedAt > best.fetchedAt)) {
                best = prebuilt
                await store.put(id, prebuilt)
            }
        }

        if (best) {
            memory.set(id, best.album)
            if (!fresh(best)) refreshLater(id)
            return best.album
        }

        const album = await fetchAlbum(id, signal)
        memory.set(id, album)
        await store.put(id, makeRecord(album, now()))
        return album
    }

    return { getAlbum, forget: id => memory.delete(id) }
}

// The albums that match what was typed, from what is known here: the curated list and the albums
// that were opened before. For searching without a connection.
export function searchLocal(query, { listed = [], stored = [] }, limit = 20) {
    const known = new Map()
    for (const album of listed) known.set(album.id, { id: album.id, title: album.name, artist: album.artist, year: '' })
    for (const { album } of stored) known.set(album.id, { id: album.id, title: album.title, artist: album.artist, year: album.year })
    const wanted = filterAlbums([...known.values()].map(item => ({ ...item, name: item.title })), query)
    return wanted.slice(0, limit).map(({ id, title, artist, year }) => ({ id, title, artist, year }))
}
