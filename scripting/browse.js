// Previous and next album through the curated list (by artist, then title), with buttons and the
// left and right arrow keys, and the link to the wall that keeps the poster options.

import { neighbours, POSTER_PARAMS } from './wallList.js'
import { parseLocation, navigateToAlbum } from './router.js'

export function setupBrowse(albums) {
    const previous = document.getElementById('prev-button')
    const next = document.getElementById('next-button')
    const wall = document.getElementById('wall-link')

    const go = direction => {
        const around = neighbours(albums, parseLocation().albumId)
        if (around) navigateToAlbum(around[direction].id)
    }

    // An album that is not in the list (found by searching) has no neighbours
    const sync = () => {
        const inList = neighbours(albums, parseLocation().albumId) !== null
        previous.disabled = next.disabled = !inList
    }
    window.addEventListener('hashchange', sync)
    document.addEventListener('poster:rendered', sync)
    sync()

    previous.addEventListener('click', () => go('previous'))
    next.addEventListener('click', () => go('next'))

    document.addEventListener('keydown', event => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
        if (document.documentElement.dataset.display === 'on') return // the slideshow has its own keys
        if (event.target.closest('input, select, textarea, [contenteditable]')) return
        if (event.key === 'ArrowLeft') go('previous')
        if (event.key === 'ArrowRight') go('next')
    })

    // The wall opens with the same layout, theme and colours as the poster has now
    wall.addEventListener('click', () => {
        const here = new URLSearchParams(window.location.search)
        const kept = new URLSearchParams()
        for (const name of POSTER_PARAMS) if (here.has(name)) kept.set(name, here.get(name))
        wall.href = `wall/${kept.size ? `?${kept}` : ''}`
    })
}
