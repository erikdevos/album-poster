// The wall: every album of the curated list as a cover in a grid. Filter, sort, group by artist,
// and click a cover to open its poster. The settings live in the URL, like on the poster page.

import { loadAlbumList } from './albumList.js'
import { setupThemeToggle } from './displayOptions.js'
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
        size: Number($('wall-size').value)
    }
    const query = wallParams(options, new URLSearchParams(window.location.search)).toString()
    history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''))
    render()
}

async function init() {
    $('wall-filter').value = options.query
    $('wall-sort').value = options.sort
    $('wall-group').value = options.group
    $('wall-size').value = options.size
    setupThemeToggle()

    for (const id of ['wall-sort', 'wall-group', 'wall-size']) $(id).addEventListener('input', update)
    $('wall-filter').addEventListener('input', update)

    albums = await loadAlbumList('../data/albums.json')
    render()
}

init()
