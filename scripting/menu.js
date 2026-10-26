// A small panel under a header button: opens on a click, closes on Escape, on a click elsewhere
// (also on another menu button) and when focus leaves it. It stays inside the window on a narrow screen. After Escape focus goes back to the button.
// Markup: <div class="header-menu"> <button id=toggleId aria-controls=panelId> <div id=panelId hidden>

export function setupMenu(toggleId, panelId) {
    const toggle = document.getElementById(toggleId)
    const panel = document.getElementById(panelId)
    const menu = toggle.closest('.header-menu')

    const isOpen = () => !panel.hidden

    // The panel hangs from its button. On a narrow screen that button can be at the far left of a second
    // row of buttons, and in the column at the side the panel can be taller than what is under the button:
    // then the panel is moved until it is inside the window. (Only in the column, which is fixed to the
    // window; a panel under a header that scrolls with the page just scrolls with it.)
    const GUTTER = 16
    function keepInWindow() {
        panel.style.translate = ''
        const rect = panel.getBoundingClientRect()
        const view = document.documentElement
        const shiftX = rect.left < GUTTER ? GUTTER - rect.left : Math.min(0, view.clientWidth - GUTTER - rect.right)
        let shiftY = 0
        if (getComputedStyle(menu.closest('header') ?? menu).position === 'fixed') {
            shiftY = Math.min(0, view.clientHeight - GUTTER - rect.bottom)
            shiftY = Math.max(shiftY, GUTTER - rect.top) // but not above the top of the window
        }
        if (shiftX || shiftY) panel.style.translate = `${Math.round(shiftX)}px ${Math.round(shiftY)}px`
    }

    // The panel can change size while it is open (the PDF options make the export panel higher)
    const resizeWatcher = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (isOpen()) keepInWindow() }) : null
    resizeWatcher?.observe(panel)

    function open() {
        panel.hidden = false
        keepInWindow()
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
