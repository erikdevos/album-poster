// Freezes where text wraps, for the export.
//
// The export draws the poster as an image at a much larger scale than the screen. At that scale a
// browser measures text a little differently, so a line that wraps on screen can just fit on one
// line in the image. The library has frozen the height of the element, so the second line is still
// reserved: a blank line in the tracklist. Putting the line breaks that are on screen into the text
// itself makes the image wrap in exactly the same places.

const SAME_LINE_TOLERANCE = 2 // pixels; letters on one line can differ a little in top

// Turns the wrapping of an element's text into real line breaks. Returns a function that undoes it.
// Works for an element that holds a single piece of text (a track, the title, the artist).
export function freezeLineBreaks(element) {
    const node = element.firstChild
    if (!node || node.nodeType !== Node.TEXT_NODE || element.childNodes.length !== 1) return () => {}

    const original = node.data
    const lines = splitIntoLines(node)
    if (lines.length < 2) return () => {}

    node.data = lines.join('\n')
    const previousWhiteSpace = element.style.whiteSpace
    element.style.whiteSpace = 'pre'

    return () => {
        node.data = original
        element.style.whiteSpace = previousWhiteSpace
    }
}

// The lines of a text node as they are laid out now, found by looking where every letter is
function splitIntoLines(node) {
    const range = document.createRange()
    const lines = []
    let line = ''
    let lineTop = null

    for (let i = 0; i < node.data.length; i++) {
        const character = node.data[i]
        range.setStart(node, i)
        range.setEnd(node, i + 1)
        const [rect] = range.getClientRects()

        // A space where the line wraps takes up no room, so it has no position: it ends the line
        if (!rect) {
            line += character
            continue
        }
        if (lineTop !== null && Math.abs(rect.top - lineTop) > SAME_LINE_TOLERANCE) {
            lines.push(line.trimEnd())
            line = ''
        }
        lineTop = rect.top
        line += character
    }
    lines.push(line.trimEnd())
    return lines.filter(text => text.length > 0)
}

// Freezes all the text in the poster that can wrap; one call undoes all of it
export function freezeAllLineBreaks(root = document) {
    const undo = [...root.querySelectorAll('#track-list li, #album-name, #album-artist')]
        .map(freezeLineBreaks)
    return () => undo.forEach(restore => restore())
}
