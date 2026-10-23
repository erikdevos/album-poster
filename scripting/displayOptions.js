// Applies the display options from the URL:
//   size=s|m|l       maximum poster width
//   theme=light|dark overrides the system setting
//   colors=cover     poster colours taken from the cover
//   controls=false   hides the header with search, for showing the poster on a screen
export function applyDisplayOptions(params) {
    const container = document.getElementById('album-container')
    container.classList.remove('size-s', 'size-m', 'size-l')
    const size = params.get('size')
    if (['s', 'm', 'l'].includes(size)) container.classList.add(`size-${size}`)

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
