// Full screen and keeping the screen on. Both are optional: a browser without them just goes without.

export const fullscreenSupported = () => Boolean(document.fullscreenEnabled)
export const isFullscreen = () => Boolean(document.fullscreenElement)

export async function enterFullscreen() {
    if (!fullscreenSupported() || isFullscreen()) return
    try {
        await document.documentElement.requestFullscreen()
    } catch {
        // refused (for example without a click first); the page still works, just not full screen
    }
}

export async function exitFullscreen() {
    if (!isFullscreen()) return
    try {
        await document.exitFullscreen()
    } catch {
        // nothing to do
    }
}

export function onFullscreenChange(callback) {
    document.addEventListener('fullscreenchange', () => callback(isFullscreen()))
}

// Asks the screen to stay on (for a display that runs for hours). Gives back a function that lets
// go of it again. A browser takes the lock away when the tab is hidden, so it is asked for again.
export async function keepScreenAwake() {
    if (!('wakeLock' in navigator)) return () => {}

    let lock = null
    let wanted = true

    const request = async () => {
        try {
            lock = await navigator.wakeLock.request('screen')
        } catch {
            lock = null // for example a low battery; not a problem
        }
    }
    const onVisible = () => {
        if (wanted && document.visibilityState === 'visible') request()
    }

    document.addEventListener('visibilitychange', onVisible)
    await request()

    return () => {
        wanted = false
        document.removeEventListener('visibilitychange', onVisible)
        lock?.release().catch(() => {})
    }
}
