// Using the app without a network: registers the service worker (sw.js), shows what is kept, downloads
// the whole curated list for offline use and clears what was kept. The albums themselves are kept by
// albumCache.js (IndexedDB) and the covers by the service worker; see swRules.js.

import { getAlbum, albumStore } from './source.js'
import { CACHES } from './swRules.js'

const CAA = 'https://coverartarchive.org'

export function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return
    // after the page has loaded, so that it does not compete with the page for the network
    window.addEventListener('load', () => {
        navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { type: 'module' })
            .catch(error => console.warn('No offline mode:', error))
    })
}

// The service worker is in charge of this page (not yet on the very first visit)
export const offlineReady = () => Boolean(navigator.serviceWorker?.controller)

const format = bytes => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`

// { stored, total, used } : how many albums of the list are kept here, and what the site uses
export async function offlineStatus(albums) {
    const ids = new Set(albums.map(album => album.id))
    const stored = (await albumStore.all()).filter(record => ids.has(record.id)).length
    let used = ''
    try {
        const { usage } = await navigator.storage.estimate()
        if (usage) used = format(usage)
    } catch {
        // not every browser can say
    }
    return { stored, total: albums.length, used }
}

// Fetches a file, so that the service worker keeps it; only the data is read, not used
async function warm(url) {
    if (await caches.match(url)) return
    const response = await fetch(url, { mode: 'cors', credentials: 'omit' })
    if (response.ok) await response.arrayBuffer()
}

// Gets the details and the covers of every album in the list, a few at a time.
// onProgress({ done, total, failed }) after every album. `signal` stops it.
export async function downloadForOffline(albums, { onProgress = () => {}, signal, concurrency = 3 } = {}) {
    const state = { done: 0, total: albums.length, failed: 0 }
    const queue = [...albums]

    async function worker() {
        while (queue.length && !signal?.aborted) {
            const { id } = queue.shift()
            try {
                const album = await getAlbum(id)
                await Promise.all([`${CAA}/release-group/${id}/front-250`, album.front, album.back]
                    .filter(Boolean).map(warm))
            } catch (error) {
                console.warn('Offline download failed for', id, error)
                state.failed++
            }
            state.done++
            onProgress({ ...state })
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
    return state
}

// What was kept goes, except the app itself and the fonts, which are needed to open the page
export async function clearOffline() {
    await albumStore.clear()
    for (const name of [CACHES.details, CACHES.thumbs, CACHES.covers]) await caches.delete(name)
}
