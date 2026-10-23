// A crossfade from the old poster to the new one, so that an album never just jumps.
//
// Before the poster changes, a copy of it (with the colours, layout and sizes it has now) is laid
// over it. The poster changes underneath, and the copy fades away, so the old album dissolves into
// the new one. The copy cannot be clicked and is hidden from screen readers. With "reduce motion"
// set, and for the very first album, the poster just changes.

export const FADE_MS = 450

let ghost = null

export function removeGhost() {
    ghost?.remove()
    ghost = null
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Runs update(), which changes the poster, with the old poster fading out over the new one
export function crossfade(update) {
    const poster = document.getElementById('album-container')
    removeGhost() // one from a change that is still fading: that jumps, but only when changes follow each other fast

    const hasPoster = Boolean(document.getElementById('album-name')?.textContent)
    if (!hasPoster || reducedMotion()) {
        update()
        return
    }

    const { top, left, width } = poster.getBoundingClientRect()
    const copy = poster.cloneNode(true)
    // The copy keeps the id of the poster, because the stylesheet is written for that id; the ids
    // inside it are taken away, so that getElementById keeps finding the real poster.
    copy.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'))
    copy.classList.add('poster-ghost')
    copy.setAttribute('aria-hidden', 'true')
    copy.inert = true
    Object.assign(copy.style, {
        top: `${top + window.scrollY}px`,
        left: `${left + window.scrollX}px`,
        width: `${width}px`
    })
    document.querySelector('main').appendChild(copy)
    ghost = copy

    update()

    // two frames later, so that the browser has painted the copy at full strength first
    requestAnimationFrame(() => requestAnimationFrame(() => { copy.style.opacity = '0' }))
    setTimeout(() => {
        copy.remove()
        if (ghost === copy) ghost = null
    }, FADE_MS + 150)
}
