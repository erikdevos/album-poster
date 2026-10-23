// Display mode: just the poster, filling the screen, for a screen that is only there to be looked at.
// With a slideshow (kiosk) on top, it changes album every few seconds.
//
//   ?display=true          only the poster, as large as the screen allows
//   ?kiosk=10              the same, with another album every 10 seconds (see playlist.js)
//   the Display menu       does the same from the header, and goes full screen
//
// A mouse move, a tap or a key shows a few buttons for a moment (full screen, exit, and with a
// slideshow pause and next). The keys F (full screen), Space (pause), N or the right arrow (next)
// and Escape (exit) work too. ?controls=false leaves out the buttons, for a screen nobody touches.

import { createKiosk } from './kiosk.js'
import { kioskOptionsFromParams } from './playlist.js'
import {
    fullscreenSupported, isFullscreen, enterFullscreen, exitFullscreen, onFullscreenChange, keepScreenAwake
} from './fullscreen.js'

const IDLE_MS = 3000
const DISPLAY_PARAMS = ['display', 'kiosk', 'source', 'progress']

const $ = id => document.getElementById(id)

// Changes parameters in the URL without adding to the history; a value of null removes it
function setUrlParams(updates) {
    const url = new URL(window.location.href)
    for (const [name, value] of Object.entries(updates)) {
        if (value === null) url.searchParams.delete(name)
        else url.searchParams.set(name, value)
    }
    history.replaceState(null, '', url)
}

export function setupDisplay({ albums, showAlbum, closeMenu }) {
    const root = document.documentElement
    const poster = $('album-container')
    const kiosk = createKiosk({ albums, showAlbum })

    let leaveOnFullscreenExit = false // set when the display was started by going full screen
    let releaseScreen = null
    let idleTimer = null

    const displayOn = () => root.dataset.display === 'on'

    // The poster is as high as the screen: its width follows from its height, so the real shape
    // is measured (a long tracklist makes it taller). Twice, as the shape changes a little with the width.
    function fitToScreen() {
        if (!displayOn()) {
            poster.style.removeProperty('--poster-ratio')
            return
        }
        const info = $('album-info')
        for (let pass = 0; pass < 2; pass++) {
            const { width, height } = info.getBoundingClientRect()
            if (width > 0) poster.style.setProperty('--poster-ratio', (height / width).toFixed(3))
        }
    }

    async function setDisplay(on) {
        if (on) {
            root.dataset.display = 'on'
            releaseScreen ??= await keepScreenAwake()
            showControls()
        } else {
            delete root.dataset.display
            root.classList.remove('display-active')
            releaseScreen?.()
            releaseScreen = null
        }
        fitToScreen()
    }

    // ---- the buttons that appear for a moment ----

    function showControls() {
        root.classList.add('display-active')
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => root.classList.remove('display-active'), IDLE_MS)
    }

    function syncPauseButton() {
        const pause = $('display-pause')
        pause.setAttribute('aria-pressed', String(kiosk.paused))
        pause.title = kiosk.paused ? 'Continue' : 'Pause'
        pause.setAttribute('aria-label', pause.title)
    }

    // ---- going in and out ----

    async function enterDisplay({ fullscreen }) {
        await setDisplay(true)
        if (fullscreen) {
            await enterFullscreen()
            leaveOnFullscreenExit = isFullscreen()
        }
    }

    async function startSlideshow({ intervalSeconds, source }) {
        setUrlParams({ kiosk: intervalSeconds, source: source === 'random' ? 'random' : null })
        await enterDisplay({ fullscreen: true })
        kiosk.start({ intervalSeconds, source, progress: true })
        syncPauseButton()
    }

    async function exitDisplay() {
        kiosk.stop()
        leaveOnFullscreenExit = false
        setUrlParams(Object.fromEntries(DISPLAY_PARAMS.map(name => [name, null])))
        await setDisplay(false)
        await exitFullscreen()
    }

    onFullscreenChange(fullscreen => {
        if (!fullscreen && leaveOnFullscreenExit) exitDisplay()
    })

    // ---- wiring ----

    $('display-fullscreen').addEventListener('click', () => (isFullscreen() ? exitFullscreen() : enterFullscreen()))
    $('display-exit').addEventListener('click', exitDisplay)
    $('display-pause').addEventListener('click', () => { kiosk.togglePause(); syncPauseButton() })
    $('display-next').addEventListener('click', () => kiosk.next())

    // The Display menu in the header
    const fullscreenButton = $('menu-fullscreen')
    fullscreenButton.textContent = fullscreenSupported() ? 'Full screen' : 'Show poster only'
    fullscreenButton.addEventListener('click', () => {
        closeMenu()
        enterDisplay({ fullscreen: true })
    })
    $('slideshow-start').addEventListener('click', () => {
        closeMenu()
        startSlideshow({
            intervalSeconds: Number($('slideshow-interval').value),
            source: $('slideshow-source').value
        })
    })
    if (!fullscreenSupported()) $('display-fullscreen').hidden = true

    for (const type of ['pointermove', 'pointerdown', 'keydown']) {
        document.addEventListener(type, () => { if (displayOn()) showControls() })
    }

    document.addEventListener('keydown', event => {
        if (!displayOn() || event.ctrlKey || event.metaKey || event.altKey) return
        const key = event.key.toLowerCase()

        if (key === 'f' && fullscreenSupported()) {
            isFullscreen() ? exitFullscreen() : enterFullscreen()
        } else if (key === ' ' && kiosk.running) {
            event.preventDefault()
            kiosk.togglePause()
            syncPauseButton()
        } else if ((key === 'n' || key === 'arrowright') && kiosk.running) {
            kiosk.next()
        } else if (key === 'escape' && !isFullscreen()) {
            exitDisplay()
        }
    })

    // The shape of the poster changes with every album, and with the screen
    document.addEventListener('poster:rendered', fitToScreen)
    window.addEventListener('resize', fitToScreen)
    document.fonts?.ready.then(fitToScreen)

    return {
        // From the URL, before the first album is drawn: display mode, with or without slideshow
        applyUrl(params) {
            if (params.get('display') === 'true' || kioskOptionsFromParams(params)) setDisplay(true)
        },
        // From the URL, once the first album is on the poster: start the slideshow
        startFromUrl(params) {
            const options = kioskOptionsFromParams(params)
            if (!options) return
            kiosk.start(options)
            syncPauseButton()
        }
    }
}
