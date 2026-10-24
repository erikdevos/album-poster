// The local admin page for data/albums.json (served by scripts/admin.mjs): search MusicBrainz or
// paste an id, see the cover before adding, add, rename and remove, and save to disk.

import { searchAlbums, getAlbum } from './source.js'
import { setupThemeToggle } from './displayOptions.js'
import { validateAlbums, idFromText, diffAlbums } from './albumData.js'
import { filterAlbums } from './wallList.js'
import { makeRecord } from './albumCache.js'

const CAA = 'https://coverartarchive.org'
const $ = id => document.getElementById(id)

let saved = [] // what is on disk
let list = [] // what the page has now, in the order of the file: the newest albums are last
let removedAt = new Map() // id -> where it was, so that Undo puts it back there

const copy = albums => albums.map(album => ({ ...album }))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const dirty = () => !same(saved, list)

function say(element, text, { error = false } = {}) {
    element.textContent = text
    element.classList.toggle('is-error', error)
}

// ---------- Rows ----------

function cover(album) {
    const image = document.createElement('img')
    image.src = `${CAA}/release-group/${album.id}/front-250`
    image.alt = ''
    image.loading = 'lazy'
    image.width = image.height = 250
    return image
}

function button(text, onClick, { primary = false, label = text } = {}) {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = primary ? 'header-control admin-save' : 'header-control'
    element.textContent = text
    element.setAttribute('aria-label', label)
    element.addEventListener('click', onClick)
    return element
}

function row(album, details, actions) {
    const item = document.createElement('li')
    item.className = 'admin-row'
    const image = cover(album)
    // Without a cover the poster has no colours and the wall shows an empty square
    image.addEventListener('error', () => {
        image.remove()
        item.classList.add('no-cover')
        const badge = document.createElement('span')
        badge.className = 'admin-badge is-warning'
        badge.textContent = 'No cover'
        details.append(badge)
    })

    item.append(image, details, actions)
    return item
}

function describe(title, artist, extra = '') {
    const details = document.createElement('div')
    details.className = 'admin-text'
    const name = document.createElement('strong')
    name.textContent = title
    const by = document.createElement('span')
    by.textContent = extra ? `${artist} · ${extra}` : artist
    details.append(name, by)
    return details
}

// ---------- The list ----------

function listRow(album) {
    const state = saved.find(old => old.id === album.id)
    const isNew = !state
    const isEdited = state && (state.name !== album.name || state.artist !== album.artist)

    const actions = document.createElement('div')
    actions.className = 'admin-actions'
    const item = row(album, describe(album.name, album.artist), actions)
    if (isNew) item.dataset.state = 'new'
    else if (isEdited) item.dataset.state = 'edited'

    if (isNew || isEdited) {
        const badge = document.createElement('span')
        badge.className = 'admin-badge'
        badge.textContent = isNew ? 'New' : 'Edited'
        item.querySelector('.admin-text').append(badge)
    }

    actions.append(
        button('Edit', () => edit(item, album), { label: `Edit ${album.name}` }),
        button('Remove', () => {
            removedAt.set(album.id, { album, index: list.indexOf(album) })
            list = list.filter(other => other !== album)
            // an album that was only added in this visit just goes
            if (isNew) removedAt.delete(album.id)
            render()
        }, { label: `Remove ${album.name}` })
    )
    return item
}

// Name and artist become two fields; Done keeps the change in the page (Save writes it)
function edit(item, album) {
    const form = document.createElement('form')
    form.className = 'admin-edit'
    const field = (label, value) => {
        const wrapper = document.createElement('label')
        wrapper.textContent = label
        const input = document.createElement('input')
        input.value = value
        wrapper.append(input)
        return { wrapper, input }
    }
    const name = field('Name', album.name)
    const artist = field('Artist', album.artist)
    const done = document.createElement('button')
    done.type = 'submit'
    done.className = 'header-control admin-save'
    done.textContent = 'Done'
    form.append(name.wrapper, artist.wrapper, done)
    form.addEventListener('submit', event => {
        event.preventDefault()
        album.name = name.input.value.trim() || album.name
        album.artist = artist.input.value.trim() || album.artist
        render()
    })
    item.querySelector('.admin-text').replaceChildren(form)
    item.querySelector('.admin-actions').replaceChildren()
    name.input.focus()
}

function renderRemoved() {
    const gone = [...removedAt.values()].filter(({ album }) => saved.some(old => old.id === album.id))
    $('removed').hidden = gone.length === 0
    $('removed-rows').replaceChildren(...gone.map(({ album, index }) => {
        const actions = document.createElement('div')
        actions.className = 'admin-actions'
        actions.append(button('Undo', () => {
            list.splice(Math.min(index, list.length), 0, album)
            removedAt.delete(album.id)
            render()
        }, { label: `Put ${album.name} back` }))
        return row(album, describe(album.name, album.artist), actions)
    }))
}

function renderList() {
    // the newest are last in the file; show them first, like the app does
    const shown = filterAlbums([...list].reverse(), $('list-filter').value)
    $('list-count').textContent = `(${list.length})`
    $('list-rows').replaceChildren(...shown.map(listRow))
}

function renderStatus() {
    const { added, removed, edited } = diffAlbums(saved, list)
    const parts = [
        added.length ? `${added.length} added` : '',
        removed.length ? `${removed.length} removed` : '',
        edited.length ? `${edited.length} renamed` : ''
    ].filter(Boolean)
    say($('admin-status'), dirty() ? `Not saved: ${parts.join(', ') || 'order changed'}` : 'Everything is saved')
    $('admin-save').disabled = $('admin-revert').disabled = !dirty()
}

function render() {
    renderList()
    renderRemoved()
    renderStatus()
    renderResults()
}

// ---------- Search and add ----------

let results = []
let searchRun = 0

function renderResults() {
    $('add-results').replaceChildren(...results.map(found => {
        const actions = document.createElement('div')
        actions.className = 'admin-actions'
        const inList = list.some(album => album.id === found.id)
        const add = button(inList ? 'In the list' : 'Add', () => {
            list.push({ id: found.id, name: found.title, artist: found.artist })
            removedAt.delete(found.id)
            render()
        }, { primary: !inList, label: inList ? `${found.title} is in the list` : `Add ${found.title}` })
        add.disabled = inList
        const link = document.createElement('a')
        link.href = `https://musicbrainz.org/release-group/${found.id}`
        link.target = '_blank'
        link.rel = 'noreferrer'
        link.textContent = 'MusicBrainz'
        actions.append(add, link)
        return row(found, describe(found.title, found.artist, found.year ?? ''), actions)
    }))
}

async function search(text) {
    const run = ++searchRun
    results = []
    renderResults()
    const message = $('add-message')
    const id = idFromText(text)

    try {
        say(message, 'Searching…')
        if (id) {
            const album = await getAlbum(id)
            results = [{ id, title: album.title, artist: album.artist, year: album.year }]
        } else {
            results = await searchAlbums(text)
        }
        if (run !== searchRun) return
        say(message, results.length === 0 ? 'Nothing found.' : `${results.length} found. A cover that is missing shows a warning.`)
        renderResults()
    } catch (error) {
        if (run !== searchRun) return
        console.error(error)
        say(message, 'The search failed. MusicBrainz may be busy; try again in a moment.', { error: true })
    }
}

// ---------- Saving ----------

async function load() {
    const response = await fetch('../api/albums', { cache: 'no-store' })
    if (!response.ok) throw new Error(`The list could not be read (${response.status}).`)
    saved = validateAlbums(await response.json())
    list = copy(saved)
    removedAt = new Map()
}

// The details of the new albums are fetched here, in the browser, and the server keeps them in
// data/details, so the app can show these albums without asking MusicBrainz. Returns the ones that failed.
async function saveDetails(albums) {
    const failed = []
    for (const [index, album] of albums.entries()) {
        say($('admin-status'), `Saved. Fetching the details of ${album.name} (${index + 1} of ${albums.length})…`)
        try {
            const response = await fetch(`../api/details/${album.id}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(makeRecord(await getAlbum(album.id)))
            })
            if (!response.ok) throw new Error(`status ${response.status}`)
        } catch (error) {
            console.error(error)
            failed.push(album)
        }
    }
    return failed
}

async function save() {
    $('admin-save').disabled = true
    try {
        const clean = validateAlbums(list)
        const added = diffAlbums(saved, clean).added
        const response = await fetch('../api/albums', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(clean)
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error ?? `Saving failed (${response.status}).`)
        saved = clean
        list = copy(clean)
        removedAt = new Map()
        render()

        const failed = await saveDetails(added)
        const time = new Date().toLocaleTimeString()
        say($('admin-status'), failed.length
            ? `Saved ${body.saved} albums at ${time}, but the details of ${failed.map(album => album.name).join(', ')} could not be fetched. Run npm run details later.`
            : `Saved ${body.saved} albums at ${time}. Run npm test and commit data/albums.json and data/details.`,
            { error: failed.length > 0 })
    } catch (error) {
        console.error(error)
        say($('admin-status'), error.message, { error: true })
        $('admin-save').disabled = !dirty()
    }
}

async function init() {
    setupThemeToggle()
    $('add-form').addEventListener('submit', event => {
        event.preventDefault()
        if ($('add-input').value.trim()) search($('add-input').value.trim())
    })
    $('list-filter').addEventListener('input', renderList)
    $('admin-save').addEventListener('click', save)
    $('admin-revert').addEventListener('click', async () => { await load(); render() })
    window.addEventListener('beforeunload', event => { if (dirty()) event.preventDefault() })

    try {
        await load()
        render()
    } catch (error) {
        console.error(error)
        say($('admin-status'), 'Could not read the list. Start the admin with: npm run admin', { error: true })
    }
}

init()
