// The slideshow: shows another album every few seconds, from the curated list or at random.
//
// The next album is prepared while the current one is on screen (its data and its cover are
// fetched), so the switch is quick; the poster fades out, changes and fades in again.
// The controller only drives the poster and a few attributes on <html>. The controls are in display.js.

import { createPlaylist } from './playlist.js'
import { getAlbum, randomAlbumId } from './source.js'

const FADE_MS = 500
const COVER_TIMEOUT_MS = 6000
const RETRY_MS = 2000
const RANDOM_TRIES = 4

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

// Resolves when the image has loaded (or after a while, so that a slow cover never stops the show)
function coverLoaded(img) {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve()
    return Promise.race([
        new Promise(resolve => {
            img.addEventListener('load', resolve, { once: true })
            img.addEventListener('error', resolve, { once: true })
        }),
        delay(COVER_TIMEOUT_MS)
    ])
}

// Fetches a cover ahead of time, so that it is in the cache when the poster needs it
async function preloadCover(url) {
    if (!url) return
    const img = new Image()
    img.crossOrigin = 'anonymous' // the same kind of request as the poster, so the cache is used
    img.src = url
    await Promise.race([img.decode().catch(() => {}), delay(COVER_TIMEOUT_MS)])
}

// albums: the curated list [{ id }]; showAlbum(id) draws an album on the poster and resolves when done
export function createKiosk({ albums, showAlbum }) {
    const root = document.documentElement
    const poster = document.getElementById('album-container')
    const cover = document.getElementById('album-cover')

    let options = null
    let running = false
    let paused = false
    let generation = 0      // changes with every start and stop, so that late work from before is dropped
    let timer = null
    let dueAt = 0           // when the next album is due
    let remaining = 0       // what was left of the interval when it was paused
    let playlist = null
    let preparing = null    // the album being prepared, a promise
    let busy = false        // a change is going on (so a quick second press of Next does nothing)

    const isCurrent = id => running && id === generation

    // The id of the next album, from the right source, with its data and cover ready
    async function prepareNext(id) {
        for (let attempt = 0; attempt < RANDOM_TRIES; attempt++) {
            try {
                const albumId = options.source === 'random' ? await randomAlbumId() : playlist.next().id
                const album = await getAlbum(albumId)
                // a random album without a cover makes a poor slide: try another one
                if (!album.front && options.source === 'random') continue
                await preloadCover(album.front)
                return albumId
            } catch (error) {
                if (!isCurrent(id)) return null
                console.error('Preparing the next album failed:', error)
                if (options.source === 'random' && playlist) options = { ...options, source: 'curated' } // offline: fall back to the list
            }
        }
        return null
    }

    function restartProgress(seconds) {
        root.style.setProperty('--kiosk-interval', `${seconds}s`)
        root.classList.remove('kiosk-tick')
        void root.offsetWidth // lets the browser see the class gone, so that adding it starts the animation again
        root.classList.add('kiosk-tick')
    }

    function schedule(milliseconds) {
        clearTimeout(timer)
        dueAt = Date.now() + milliseconds
        timer = setTimeout(advance, milliseconds)
    }

    async function advance() {
        const id = generation
        if (!isCurrent(id) || paused || busy) return
        busy = true
        clearTimeout(timer)

        try {
            const albumId = await (preparing ?? (preparing = prepareNext(id)))
            preparing = null
            if (!isCurrent(id)) return

            // nothing could be fetched (offline?): try again in a moment, the current poster stays
            if (!albumId) {
                schedule(RETRY_MS)
                return
            }

            poster.classList.add('is-changing')
            await delay(FADE_MS)
            if (isCurrent(id)) {
                await showAlbum(albumId)
                await coverLoaded(cover)
            }
            poster.classList.remove('is-changing')
            if (!isCurrent(id)) return

            restartProgress(options.intervalSeconds)
            schedule(options.intervalSeconds * 1000)
            preparing = prepareNext(id) // the next one, while this one is on screen
        } finally {
            busy = false
        }
    }

    return {
        get running() { return running },
        get paused() { return paused },

        // The poster shows the first album already; the first change comes after one interval
        start(startOptions) {
            if (running) this.stop()
            options = startOptions
            running = true
            paused = false
            generation++
            playlist = createPlaylist(albums)
            preparing = null

            root.dataset.kiosk = 'on'
            root.classList.toggle('no-progress', !options.progress)
            restartProgress(options.intervalSeconds)
            schedule(options.intervalSeconds * 1000)
            preparing = prepareNext(generation)
        },

        stop() {
            if (!running) return
            running = false
            paused = false
            generation++
            clearTimeout(timer)
            preparing = null
            busy = false
            poster.classList.remove('is-changing')
            delete root.dataset.kiosk
            root.classList.remove('kiosk-tick', 'kiosk-paused', 'no-progress')
        },

        togglePause() {
            if (!running) return
            paused = !paused
            root.classList.toggle('kiosk-paused', paused)
            if (paused) {
                remaining = Math.max(0, dueAt - Date.now())
                clearTimeout(timer)
            } else {
                schedule(remaining)
            }
            return paused
        },

        // Straight to the next album
        next() {
            if (!running) return
            if (paused) this.togglePause()
            clearTimeout(timer)
            advance()
        }
    }
}
