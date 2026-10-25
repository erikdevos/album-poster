// What the service worker (sw.js) does with a request, and how much it keeps. Pure functions, so the
// rules can be tested without a browser.

// The names of the caches. The number goes up when what a cache holds changes.
export const CACHES = {
    shell: 'shell-v1', // the app: pages, scripts, styles, the list
    details: 'details-v1', // data/details/<id>.json
    thumbs: 'thumbs-v1', // the small covers of the wall
    covers: 'covers-v1', // the covers of the posters
    fonts: 'fonts-v1'
}
// How many files a cache keeps; the oldest go first
export const LIMITS = { thumbs: 600, covers: 160 }

const COVER_HOSTS = /^(coverartarchive\.org|([a-z0-9-]+\.)*archive\.org)$/
// Small and middle sized covers: .../front-250, .../front-500, .../front-1200 and .../mbid-...-250.jpg.
// The original files (often several megabytes) and the JSON about a cover are left to the network.
const THUMB = /(\/front-250|-250\.(jpe?g|png|gif))$/i
const COVER = /(\/front-(500|1200)|-(500|1200)\.(jpe?g|png|gif))$/i

// 'code'     the app: network first, the copy when there is no network
// 'details'  prepared album details: the copy at once, a fresh one in the background
// 'thumb', 'cover', 'font-css', 'font-file'   see CACHES
// null       not ours: the browser goes to the network as usual
// `scope` is the address of the folder the service worker is in (the site)
export function classify(requestUrl, scope, method = 'GET') {
    if (method !== 'GET') return null
    const url = new URL(requestUrl)
    const base = new URL(scope)

    if (url.origin === base.origin) {
        if (!url.pathname.startsWith(base.pathname)) return null
        const path = url.pathname.slice(base.pathname.length)
        if (path.startsWith('api/') || path.startsWith('admin/') || path === 'sw.js') return null
        return path.startsWith('data/details/') ? 'details' : 'code'
    }

    if (COVER_HOSTS.test(url.hostname)) {
        if (THUMB.test(url.pathname)) return 'thumb'
        if (COVER.test(url.pathname)) return 'cover'
        return null
    }
    if (url.hostname === 'fonts.googleapis.com') return 'font-css'
    if (url.hostname === 'fonts.gstatic.com') return 'font-file'
    return null
}

// The cache that a class of request is kept in
export const cacheFor = kind => ({
    code: CACHES.shell, details: CACHES.details, thumb: CACHES.thumbs, cover: CACHES.covers,
    'font-css': CACHES.fonts, 'font-file': CACHES.fonts
}[kind] ?? null)

// The files to keep ready from the first visit on, so that the app opens without a network.
// Relative to the site. (tests/unit/swRules.test.js checks that every script and style is in it.)
export const SHELL = [
    './', 'index.html', 'wall/', 'wall/index.html', 'data/albums.json',
    'styles/style.css', 'styles/wall.css',
    'scripting/vibrant.min.js', 'scripting/vendor/html-to-image.js',
    'scripting/albumCache.js', 'scripting/albumColors.js', 'scripting/albumDetails.js',
    'scripting/albumList.js', 'scripting/barcode.js', 'scripting/browse.js', 'scripting/colors.js',
    'scripting/crossfade.js', 'scripting/display.js', 'scripting/duration.js', 'scripting/displayOptions.js', 'scripting/exportPanel.js',
    'scripting/exportPlan.js', 'scripting/exportPoster.js', 'scripting/feedback.js', 'scripting/fileFormats.js',
    'scripting/fullscreen.js', 'scripting/kiosk.js', 'scripting/layouts.js', 'scripting/lineBreaks.js',
    'scripting/main.js', 'scripting/menu.js', 'scripting/offline.js', 'scripting/playlist.js', 'scripting/printPlan.js',
    'scripting/router.js', 'scripting/search.js', 'scripting/source.js', 'scripting/swRules.js',
    'scripting/wall.js', 'scripting/wallList.js', 'scripting/sources/musicbrainz.js'
]
