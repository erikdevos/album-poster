// The service worker: keeps the app, the covers and the album details in this browser, so that an
// album that was opened before comes up fast and the app also works without a network. What is kept
// where is in scripting/swRules.js. Registered with { type: 'module' } by scripting/offline.js.

import { CACHES, LIMITS, SHELL, cacheFor, classify } from './scripting/swRules.js'

// The deploy workflow puts the commit here, so that this file changes with every deploy. The browser
// then installs the new worker, and the open pages say that there is a new version (offline.js).
// version: dev

const scope = self.registration.scope
const NETWORK_TIMEOUT_MS = 4000

self.addEventListener('install', event => {
    // addAll is all or nothing; a file that is missing must not stop the worker, so one by one
    event.waitUntil((async () => {
        const cache = await caches.open(CACHES.shell)
        await Promise.all(SHELL.map(path => cache.add(new URL(path, scope)).catch(() => {})))
        await self.skipWaiting()
    })())
})

// Caches of an older version go
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keep = new Set(Object.values(CACHES))
        await Promise.all((await caches.keys()).filter(name => !keep.has(name)).map(name => caches.delete(name)))
        await self.clients.claim()
    })())
})

self.addEventListener('fetch', event => {
    const kind = classify(event.request.url, scope, event.request.method)
    if (!kind) return

    const cacheName = cacheFor(kind)
    if (kind === 'code') event.respondWith(networkFirst(event.request, cacheName))
    else if (kind === 'font-css' || kind === 'details') event.respondWith(staleWhileRevalidate(event, cacheName))
    else event.respondWith(cacheFirst(event.request, cacheName, LIMITS[cacheName.split('-')[0]]))
})

// Only a good answer, and not an opaque one (those count for much more than their size in the quota)
const cacheable = response => response.ok && response.type !== 'opaque'

// The app: from the network, so that a new version arrives at once; the kept copy when the network
// is not there or too slow. Query strings (?layout=cd) do not matter for the copy. `no-cache` makes the
// browser ask the server whether its own copy is still good (a cheap 304), instead of trusting it for
// the minutes that a host like GitHub Pages allows.
async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName)
    try {
        const response = await Promise.race([
            fetch(request, { cache: 'no-cache' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), NETWORK_TIMEOUT_MS))
        ])
        if (cacheable(response)) cache.put(request, response.clone())
        return response
    } catch (error) {
        const copy = await cache.match(request, { ignoreSearch: true })
        if (copy) return copy
        return fetch(request, { cache: 'no-cache' }) // slow, but there is no copy: wait for the real answer
    }
}

// Details and the fonts' CSS: the copy at once, and a fresh one for next time
async function staleWhileRevalidate(event, cacheName) {
    const cache = await caches.open(cacheName)
    const copy = await cache.match(event.request)
    const fresh = fetch(event.request).then(response => {
        if (cacheable(response)) cache.put(event.request, response.clone())
        return response
    })
    if (copy) {
        event.waitUntil(fresh.catch(() => {}))
        return copy
    }
    return fresh
}

// Covers and font files do not change: the copy, else the network, and keep it
async function cacheFirst(request, cacheName, limit) {
    const cache = await caches.open(cacheName)
    const copy = await cache.match(request)
    if (copy) return copy

    const response = await fetch(request)
    if (cacheable(response)) {
        await cache.put(request, response.clone())
        if (limit) trim(cache, limit)
    }
    return response
}

// The oldest files of a cache go when it holds more than `limit`
async function trim(cache, limit) {
    const keys = await cache.keys()
    await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map(key => cache.delete(key)))
}
