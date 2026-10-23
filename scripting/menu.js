// A small panel under a header button: opens on a click, closes on Escape, on a click elsewhere
// (also on another menu button) and when focus leaves it. After Escape focus goes back to the button.
// Markup: <div class="header-menu"> <button id=toggleId aria-controls=panelId> <div id=panelId hidden>

export function setupMenu(toggleId, panelId) {
    const toggle = document.getElementById(toggleId)
    const panel = document.getElementById(panelId)
    const menu = toggle.closest('.header-menu')

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
        if (!menu.contains(event.target)) close()
    })

    // Tabbing out of the panel (or the button) closes it
    menu.addEventListener('focusout', event => {
        if (isOpen() && event.relatedTarget && !menu.contains(event.relatedTarget)) close()
    })

    return { close }
}
