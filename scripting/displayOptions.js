// Applies the display options from the URL:
//   size=s|m|l       maximum poster width
//   theme=light|dark overrides the system setting
//   colors=cover     poster colours taken from the cover
//   layout=classic|minimal|swiss   how the poster is laid out
//   controls=false   hides the header with search, for showing the poster on a screen
export const LAYOUTS = ['classic', 'minimal', 'swiss']

export function applyDisplayOptions(params) {
    const container = document.getElementById('album-container')
    container.classList.remove('size-s', 'size-m', 'size-l')
    const size = params.get('size')
    if (['s', 'm', 'l'].includes(size)) container.classList.add(`size-${size}`)

    const layout = LAYOUTS.includes(params.get('layout')) ? params.get('layout') : 'classic'
    container.dataset.layout = layout
    document.getElementById('layout-select').value = layout

    const root = document.documentElement
    const theme = params.get('theme')
    if (theme === 'light' || theme === 'dark') {
        root.dataset.theme = theme
    } else {
        delete root.dataset.theme
    }

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
