import { loadAlbumList } from './albumList.js'
import { fetchAlbumDetails } from './albumDetails.js'
import { setBusy, showMessage, isLoading } from './feedback.js'
import { watchCover } from './albumColors.js'
import { applyDisplayOptions, setLayout, setupThemeToggle } from './displayOptions.js'
import { setupSearch, rememberAlbum } from './search.js'
import { setupMenu } from './menu.js'
import { setupDisplay } from './display.js'
import { setupBrowse } from './browse.js'
import { registerServiceWorker } from './offline.js'
import { downloadPoster, printPoster, sharePoster } from './exportPoster.js'
import { setupExportPanel, exportOptions, printSettings } from './exportPanel.js'
import { parseLocation, isLegacyId, replaceAlbumId, navigateToAlbum, onAlbumChange } from './router.js'

let albums = []

// Old links used TheAudioDB ids; translate them to the MusicBrainz id of the same album
function resolveAlbumId(albumId) {
    if (!isLegacyId(albumId)) return albumId
    const match = albums.find(album => album.audiodbId === albumId)
    if (!match) return albumId
    replaceAlbumId(match.id)
    return match.id
}

async function showAlbum(albumId) {
    const album = await fetchAlbumDetails(resolveAlbumId(albumId))
    if (album) rememberAlbum(album)
    // the loader on the Random button stays while a newer album is still loading
    if (!isLoading()) setBusy(document.getElementById('shuffle-button'), false)
}

function showRandomAlbum() {
    const current = parseLocation().albumId
    const others = albums.filter(album => album.id !== current)
    if (others.length === 0) return
    setBusy(document.getElementById('shuffle-button'), true) // cleared in showAlbum, when the album is there
    navigateToAlbum(others[Math.floor(Math.random() * others.length)].id)
}

// Runs a button action: the button is disabled meanwhile (and, with `busyButton`, a loader shows on
// that button), a failure is shown as a message, and so is the text the action returns, if any
function onClick(id, action, { busyButton = id, before = () => {} } = {}) {
    const button = document.getElementById(id)
    const loader = document.getElementById(busyButton)
    button.addEventListener('click', async () => {
        before()
        button.disabled = true
        setBusy(loader, true)
        try {
            const message = await action()
            if (message) showMessage(message)
        } catch (error) {
            console.error(`${id} failed:`, error)
            showMessage('That did not work. Try again.', { error: true })
        } finally {
            button.disabled = false
            setBusy(loader, false)
        }
    })
}

async function init() {
    registerServiceWorker()
    const { albumId, params } = parseLocation()
    applyDisplayOptions(params)
    watchCover(document.getElementById('album-cover'))

    albums = await loadAlbumList()
    setupSearch(document.getElementById('album-search'), albums)
    document.getElementById('shuffle-button').addEventListener('click', showRandomAlbum)
    setupBrowse(albums)
    setupThemeToggle()
    document.getElementById('layout-select').addEventListener('change', event => setLayout(event.target.value))
    // The export panel closes when something in it is used; the Export button shows a loader while the file is made
    const exportMenu = setupMenu('export-toggle', 'export-panel')
    const before = () => exportMenu.close()
    setupExportPanel()
    onClick('download-button', () => downloadPoster(exportOptions()), { busyButton: 'export-toggle', before })
    onClick('print-button', () => printPoster(printSettings()), { busyButton: null, before })
    onClick('share-button', async () => (await sharePoster()) === 'copied' ? 'Link copied to the clipboard' : '', { busyButton: null, before })

    // Display mode and the slideshow: from the URL, or from the Display menu
    const displayMenu = setupMenu('display-toggle', 'display-panel')
    const display = setupDisplay({
        albums,
        closeMenu: displayMenu.close,
        // the slideshow draws its albums without adding them to "recently viewed"
        showAlbum: id => { replaceAlbumId(id); return fetchAlbumDetails(id) }
    })
    display.applyUrl(params)

    // Search results and lists navigate by changing the `#id` in the URL
    onAlbumChange(showAlbum)

    if (albumId) {
        await showAlbum(albumId)
    } else if (albums.length > 0) {
        // No album requested: show a random one, and put it in the URL so it can be shared
        const random = albums[Math.floor(Math.random() * albums.length)].id
        replaceAlbumId(random)
        await showAlbum(random)
    }

    // A slideshow in the URL starts once the first album is on the poster
    display.startFromUrl(params)
}

init()
