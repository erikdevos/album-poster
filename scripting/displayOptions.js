// Applies the display options from the URL:
//   size=s|m|l       maximum poster width
//   theme=light|dark overrides the saved choice and the system setting
//   colors=cover     poster colours taken from the cover
//   layout=classic|minimal|swiss|blur|cd|cd-blur|festival|receipt|gallery|setlist|typographic|riso|film|vinyl   how the poster is laid out
//   controls=false   hides the header with search, for showing the poster on a screen
export const LAYOUTS = ['classic', 'minimal', 'swiss', 'blur', 'cd', 'cd-blur', 'festival', 'receipt', 'gallery', 'setlist', 'typographic', 'riso', 'film', 'vinyl']

export function applyDisplayOptions(params) {
    const container = document.getElementById('album-container')
    container.classList.remove('size-s', 'size-m', 'size-l')
    const size = params.get('size')
    if (['s', 'm', 'l'].includes(size)) container.classList.add(`size-${size}`)

    const layout = LAYOUTS.includes(params.get('layout')) ? params.get('layout') : 'classic'
    container.dataset.layout = layout
    document.getElementById('layout-select').value = layout

    const root = document.documentElement
    // The URL wins over the choice saved with the toggle, which wins over the system setting
    const theme = [params.get('theme'), savedTheme()].find(isTheme)
    if (theme) {
        root.dataset.theme = theme
    } else {
        delete root.dataset.theme
    }
    syncThemeToggle()

    setFlag(root, 'colors', params.get('colors') === 'cover' ? 'cover' : null)
    setFlag(root, 'controls', params.get('controls') === 'false' ? 'off' : null)
}

function setFlag(element, name, value) {
    if (value) {
        element.dataset[name] = value
    } else {
        delete element.dataset[name]
    }
}

// Switches the layout and keeps the URL in step, so the link shows the same poster
export function setLayout(layout) {
    if (!LAYOUTS.includes(layout)) return
    document.getElementById('album-container').dataset.layout = layout

    const url = new URL(window.location.href)
    if (layout === 'classic') {
        url.searchParams.delete('layout')
    } else {
        url.searchParams.set('layout', layout)
    }
    history.replaceState(null, '', url)
}

// ---------- Light and dark ----------

const THEME_KEY = 'album-poster.theme'
const isTheme = value => value === 'light' || value === 'dark'

function savedTheme() {
    try {
        return localStorage.getItem(THEME_KEY)
    } catch {
        return null // storage can be blocked; the toggle then only works for this visit
    }
}

// What the page looks like now: an explicit choice, or else the system setting
export function currentTheme() {
    return document.documentElement.dataset.theme
        ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

function syncThemeToggle() {
    const toggle = document.getElementById('theme-toggle')
    if (toggle) toggle.setAttribute('aria-pressed', String(currentTheme() === 'dark'))
}

// Wires up the toggle. A click chooses light or dark, is remembered in this browser, and, when the
// URL names a theme, changes that too so the link keeps showing what is on screen.
export function setupThemeToggle() {
    const toggle = document.getElementById('theme-toggle')

    toggle.addEventListener('click', () => {
        const theme = currentTheme() === 'dark' ? 'light' : 'dark'
        document.documentElement.dataset.theme = theme
        try {
            localStorage.setItem(THEME_KEY, theme)
        } catch {
            // see savedTheme()
        }

        const url = new URL(window.location.href)
        if (url.searchParams.has('theme')) {
            url.searchParams.set('theme', theme)
            history.replaceState(null, '', url)
        }
        syncThemeToggle()
    })

    // Without an explicit choice the page follows the system, and so does the toggle
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeToggle)
    syncThemeToggle()
}
