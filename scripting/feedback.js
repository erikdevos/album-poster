// Telling the person what is going on, without moving anything on the page:
//   a thin loading line fixed at the top of the window while an album is loading,
//   a small round loader on a button that is busy (Random, Export),
//   a short message (an error, "Link copied") in a bubble fixed at the bottom of the window.
// None of these take up room in the page, so the poster never jumps.

// (looked up when used, so that this file can also be imported where there is no page, as in the unit tests)
const root = () => document.documentElement

// ---- the loading line ----

let loading = 0

// Calls come in pairs: setLoading(true) when something starts, setLoading(false) when it ends.
// Several can overlap (a new album is picked while the last one is still loading); the line goes
// away when the last one is done.
export function setLoading(on) {
    loading = Math.max(0, loading + (on ? 1 : -1))
    if (loading > 0) root().dataset.loading = 'true'
    else delete root().dataset.loading
}

export const isLoading = () => loading > 0

// ---- a busy button ----

export function setBusy(button, busy) {
    if (!button) return
    if (busy) button.setAttribute('aria-busy', 'true')
    else button.removeAttribute('aria-busy')
}

// ---- messages ----

const ERROR_MS = 6000
const INFO_MS = 4000
let hideTimer = null

export function showMessage(text, { error = false } = {}) {
    const toast = document.getElementById('toast')
    clearTimeout(hideTimer)
    toast.textContent = text
    toast.dataset.type = error ? 'error' : 'info'
    toast.hidden = false
    hideTimer = setTimeout(clearMessage, error ? ERROR_MS : INFO_MS)
}

export function clearMessage() {
    clearTimeout(hideTimer)
    const toast = document.getElementById('toast')
    toast.hidden = true
    toast.textContent = ''
}
