// What the slideshow (kiosk mode) plays and how it is set up. Pure functions, no DOM.

export const MIN_INTERVAL_SECONDS = 3
export const MAX_INTERVAL_SECONDS = 3600
export const DEFAULT_INTERVAL_SECONDS = 10

// A shuffled copy (Fisher-Yates)
export function shuffle(items, random = Math.random) {
    const copy = [...items]
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
}

// Plays every item once in random order, then shuffles again. The first of a new round is never
// the last of the round before, so the same album does not come up twice in a row.
export function createPlaylist(items, random = Math.random) {
    let queue = []
    let last = null

    return {
        next() {
            if (items.length === 0) return null
            if (queue.length === 0) {
                queue = shuffle(items, random)
                if (queue.length > 1 && queue[0] === last) queue.push(queue.shift())
            }
            last = queue.shift()
            return last
        }
    }
}

// The slideshow settings from the URL, or null when the slideshow is off:
//   kiosk=true | kiosk=15   on, every 10 seconds or every 15 (between 3 and 3600)
//   source=random           albums from all of MusicBrainz; otherwise the curated list
//   progress=false          no thin progress line at the bottom
export function kioskOptionsFromParams(params) {
    if (!params.has('kiosk')) return null

    const value = params.get('kiosk').trim().toLowerCase()
    if (value === 'false' || value === 'off' || value === '0') return null

    const seconds = Number(value)
    const interval = Number.isFinite(seconds) && value !== '' ? seconds : DEFAULT_INTERVAL_SECONDS

    return {
        intervalSeconds: Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, interval)),
        source: params.get('source') === 'random' ? 'random' : 'curated',
        progress: params.get('progress') !== 'false'
    }
}
