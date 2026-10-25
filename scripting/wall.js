// The wall: every album of the curated list as a cover in a grid. Filter, sort, group by artist,
// and click a cover to open its poster. The settings live in the URL, like on the poster page.

import { loadAlbumList } from './albumList.js'
import { setupThemeToggle } from './displayOptions.js'
import { LAYOUT_LABELS } from './layouts.js'
import { setupMenu } from './menu.js'
import { registerServiceWorker, offlineReady, offlineStatus, downloadForOffline, clearOffline } from './offline.js'
import { sortAlbums, filterAlbums, groupByArtist, wallOptions, wallParams, posterLink } from './wallList.js'

const CAA = 'https://coverartarchive.org'
const $ = id => document.getElementById(id)

let albums = []
let options = wallOptions(new URLSearchParams(window.location.search))

function tile(album) {
    const link = document.createElement('a')
    link.className = 'wall-tile'
    link.href = posterLink(album.id, new URLSearchParams(window.location.search))
    link.title = `${album.name} – ${album.artist}`

    const cover = document.createElement('img')
    cover.crossOrigin = 'anonymous' // a CORS request, so that the service worker can keep the cover
    cover.src = `${CAA}/release-group/${album.id}/front-250`
    cover.alt = `Cover of ${album.name} by ${album.artist}`
    cover.loading = 'lazy'
    cover.decoding = 'async'
    cover.width = cover.height = 250
    // No cover: the tile stays, with the name in it
    cover.addEventListener('error', () => { link.classList.add('no-cover'); cover.remove() })

    const caption = document.createElement('span')
    caption.className = 'wall-caption'
    const name = document.createElement('strong')
    name.textContent = album.name
    const artist = document.createElement('span')
    artist.textContent = album.artist
    caption.append(name, artist)

    link.append(cover, caption)
    return link
}

function grid(list) {
    const element = document.createElement('div')
    element.className = 'wall-grid'
    element.append(...list.map(tile))
    return element
}

function section({ artist, albums: list }) {
    const wrapper = document.createElement('section')
    wrapper.className = 'wall-group'

    const heading = document.createElement('h2')
    heading.className = 'wall-artist'
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = artist
    button.title = `Show only ${artist}`
    button.addEventListener('click', () => { $('wall-filter').value = artist; update() })
    const count = document.createElement('span')
    count.textContent = list.length === 1 ? '1 album' : `${list.length} albums`
    heading.append(button, count)

    wrapper.append(heading, grid(list))
    return wrapper
}

function render() {
    const shown = sortAlbums(filterAlbums(albums, options.query), options.sort)
    const container = $('wall-albums')
    document.documentElement.style.setProperty('--wall-cover', `${options.size}rem`)

    if (shown.length === 0) {
        const empty = document.createElement('p')
        empty.className = 'wall-empty'
        empty.textContent = 'No albums match this filter.'
        container.replaceChildren(empty)
    } else if (options.group === 'artist') {
        container.replaceChildren(...groupByArtist(shown).map(section))
    } else {
        container.replaceChildren(grid(shown))
    }

    $('wall-count').textContent = shown.length === albums.length
        ? `${albums.length} albums`
        : `${shown.length} of ${albums.length} albums`
}

// Reads the controls, shows the result and keeps the URL in step
function update() {
    options = {
        query: $('wall-filter').value.trim(),
        sort: $('wall-sort').value,
        group: $('wall-group').value,
        size: Number($('wall-size').value),
        layout: $('wall-layout').value
    }
    const query = wallParams(options, new URLSearchParams(window.location.search)).toString()
    history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''))
    render()
}

// The panel with the offline use: what is kept, and buttons to download everything or clear it
function setupOffline() {
    const menu = setupMenu('offline-toggle', 'offline-panel')
    const status = $('offline-status')
    const progress = $('offline-progress')
    let running = null // the AbortController of a download that is going on

    async function showStatus() {
        const { stored, total, used } = await offlineStatus(albums)
        status.textContent = `${stored} of ${total} albums are kept in this browser${used ? `, ${used} used by this site` : ''}.` +
            (offlineReady() ? '' : ' Offline mode starts after this page has been reloaded once.')
        $('offline-download').textContent = running ? 'Stop' : stored < total ? 'Download all albums' : 'Download again'
    }

    $('offline-toggle').addEventListener('click', showStatus)

    $('offline-download').addEventListener('click', async () => {
        if (running) return running.abort()
        running = new AbortController()
        progress.hidden = false
        progress.value = 0
        $('offline-download').textContent = 'Stop'
        const result = await downloadForOffline(albums, {
            signal: running.signal,
            onProgress: ({ done, total, failed }) => {
                progress.value = done / total
                status.textContent = `Downloading… ${done} of ${total}${failed ? `, ${failed} failed` : ''}`
            }
        })
        const stopped = running.signal.aborted
        running = null
        progress.hidden = true
        await showStatus()
        if (result.failed) status.textContent += ` ${result.failed} could not be downloaded; try again later.`
        else if (stopped) status.textContent += ' Stopped.'
    })

    $('offline-clear').addEventListener('click', async () => {
        running?.abort()
        await clearOffline()
        await showStatus()
    })
    return menu
}

async function init() {
    registerServiceWorker()
    $('wall-filter').value = options.query
    $('wall-sort').value = options.sort
    $('wall-group').value = options.group
    $('wall-size').value = options.size
    $('wall-layout').replaceChildren(...Object.entries(LAYOUT_LABELS).map(([id, label]) => new Option(label, id)))
    $('wall-layout').value = options.layout
    setupThemeToggle()

    for (const id of ['wall-sort', 'wall-group', 'wall-size', 'wall-layout']) $(id).addEventListener('input', update)
    $('wall-filter').addEventListener('input', update)

    albums = await loadAlbumList()
    setupOffline()
    render()
}

init()
