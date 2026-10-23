// The export panel under the Export button: opens on a click, closes on Escape, on a click
// elsewhere and when focus leaves it. After Escape focus goes back to the button.

export function setupExportMenu() {
    const toggle = document.getElementById('export-toggle')
    const panel = document.getElementById('export-panel')
    const menu = toggle.closest('.export-menu')

    const isOpen = () => !panel.hidden

    function open() {
        panel.hidden = false
        toggle.setAttribute('aria-expanded', 'true')
        panel.querySelector('select, button')?.focus()
    }

    function close({ returnFocus = false } = {}) {
        if (!isOpen()) return
        panel.hidden = true
        toggle.setAttribute('aria-expanded', 'false')
        if (returnFocus) toggle.focus()
    }

    toggle.addEventListener('click', () => (isOpen() ? close() : open()))

    menu.addEventListener('keydown', event => {
        if (event.key === 'Escape' && isOpen()) {
            event.preventDefault()
            close({ returnFocus: true })
        }
    })

    document.addEventListener('pointerdown', event => {
        if (!event.target.closest?.('.export-menu')) close()
    })

    // Tabbing out of the panel (or the button) closes it
    menu.addEventListener('focusout', event => {
        if (isOpen() && event.relatedTarget && !menu.contains(event.relatedTarget)) close()
    })

    return { close }
}
