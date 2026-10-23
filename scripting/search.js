// Search box with suggestions, as an ARIA combobox: type to search all of MusicBrainz, arrow keys
// to move, Enter to pick, Escape to close. Empty, it suggests recent albums and the curated list.
// Picking an album only changes the URL hash; main.js reacts to that.

import { searchAlbums } from './source.js'
import { navigateToAlbum } from './router.js'

const RECENT_KEY = 'album-poster.recent'
const MAX_RECENT = 5
const DEBOUNCE_MS = 350

export function rememberAlbum({ id, title, artist }) {
    const recent = [{ id, label: `${title} – ${artist}` }, ...readRecent().filter(item => item.id !== id)]
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)))
    } catch {
        // storage can be blocked; recent albums are a convenience only
    }
}

function readRecent() {
    try {
        const recent = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
        return Array.isArray(recent) ? recent : []
    } catch {
        return []
    }
}

export function setupSearch(input, curatedAlbums) {
    const list = document.getElementById('search-results')
    const announcer = document.getElementById('search-status')
    const curated = curatedAlbums.map(album => ({ id: album.id, label: `${album.name} – ${album.artist}` }))

    let entries = []   // what is shown: groups, options and messages
    let active = -1    // index in `entries` of the highlighted option
    let timer = null
    let request = null

    const options = () => entries.filter(entry => entry.id)

    function render(newEntries, announcement = '') {
        entries = newEntries
        active = -1
        list.replaceChildren(...entries.map((entry, index) => {
            const li = document.createElement('li')
            li.textContent = entry.label ?? entry.text
            if (entry.id) {
                li.id = `search-option-${index}`
                li.setAttribute('role', 'option')
                li.setAttribute('aria-selected', 'false')
                li.dataset.index = index
            } else {
                li.setAttribute('role', 'presentation')
                li.className = entry.group ? 'search-group' : 'search-message'
            }
            return li
        }))
        announcer.textContent = announcement
        setOpen(entries.length > 0)
    }

    function setOpen(open) {
        list.hidden = !open
        input.setAttribute('aria-expanded', String(open))
        if (!open) input.removeAttribute('aria-activedescendant')
    }

    function move(step) {
        const indexes = entries.flatMap((entry, index) => entry.id ? [index] : [])
        if (indexes.length === 0) return
        const position = indexes.indexOf(active)
        const next = position === -1
            ? (step > 0 ? 0 : indexes.length - 1)
            : (position + step + indexes.length) % indexes.length
        highlight(indexes[next])
    }

    function highlight(index) {
        list.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false')
        active = index
        const option = document.getElementById(`search-option-${index}`)
        option.setAttribute('aria-selected', 'true')
        option.scrollIntoView({ block: 'nearest' })
        input.setAttribute('aria-activedescendant', option.id)
    }

    function choose(index) {
        const entry = entries[index]
        if (!entry?.id) return
        clearTimeout(timer)
        request?.abort()
        navigateToAlbum(entry.id)
        input.value = ''
        setOpen(false)
        input.blur()
    }

    function showSuggestions() {
        const recent = readRecent()
        render([
            ...(recent.length ? [{ group: true, text: 'Recently viewed' }, ...recent] : []),
            { group: true, text: 'Featured albums' },
            ...curated
        ])
    }

    async function search() {
        request?.abort()
        request = new AbortController()
        try {
            const results = await searchAlbums(input.value, request.signal)
            render(results.length
                ? results.map(album => ({
                    id: album.id,
                    label: `${album.title} – ${album.artist}${album.year ? ` (${album.year})` : ''}`
                }))
                : [{ text: 'No albums found' }],
            results.length ? `${results.length} albums found` : 'No albums found')
        } catch (error) {
            if (error.name === 'AbortError') return
            console.error('Search failed:', error)
            render([{ text: 'Search failed, try again in a moment' }], 'Search failed')
        }
    }

    input.addEventListener('input', () => {
        clearTimeout(timer)
        request?.abort()
        if (input.value.trim().length === 0) {
            showSuggestions()
        } else if (input.value.trim().length < 2) {
            render([])
        } else {
            render([{ text: 'Searching…' }])
            timer = setTimeout(search, DEBOUNCE_MS)
        }
    })

    input.addEventListener('focus', () => {
        if (input.value.trim().length === 0) showSuggestions()
    })

    input.addEventListener('keydown', event => {
        switch (event.key) {
            case 'ArrowDown':
            case 'ArrowUp':
                event.preventDefault()
                if (list.hidden && input.value.trim().length === 0) showSuggestions()
                move(event.key === 'ArrowDown' ? 1 : -1)
                break
            case 'Enter':
                if (list.hidden) break
                event.preventDefault()
                // Without a highlighted option, Enter picks the first one
                choose(active !== -1 ? active : entries.findIndex(entry => entry.id))
                break
            case 'Escape':
                if (!list.hidden) {
                    event.preventDefault()
                    setOpen(false)
                }
                break
        }
    })

    // pointerdown instead of click: the input would lose focus (and close the list) before a click
    list.addEventListener('pointerdown', event => {
        const option = event.target.closest('[role="option"]')
        if (!option) return
        event.preventDefault()
        choose(Number(option.dataset.index))
    })

    document.addEventListener('pointerdown', event => {
        if (!event.target.closest?.('.search')) setOpen(false)
    })
}
