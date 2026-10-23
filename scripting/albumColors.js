import { pickColors } from './colors.js'

// `Vibrant` is a global from vibrant.min.js, loaded before the modules.
export function extractPalette(img) {
    const colorsContainer = document.querySelector('#album-colors')
    if (!colorsContainer) return

    try {
        const swatches = new Vibrant(img).swatches()

        const colorDivs = Object.entries(swatches)
            .filter(([, swatch]) => swatch)
            .map(([name, swatch]) => {
                const colorDiv = document.createElement('div')
                colorDiv.classList.add('album-color')
                colorDiv.style.backgroundColor = swatch.getHex()
                colorDiv.dataset.swatch = name
                return colorDiv
            })

        colorsContainer.replaceChildren(...colorDivs)
        applyPosterColors(swatches)
    } catch (error) {
        console.error('Error extracting palette:', error)
        colorsContainer.replaceChildren()
        applyPosterColors(null)
    }
}

// Re-extracts the palette every time the cover has finished loading
export function watchCover(img) {
    // (the export briefly swaps in the original image; the palette stays as it is)
    img.addEventListener('load', () => {
        if (!img.dataset.exporting) extractPalette(img)
    })
}

// --- Poster colours from the cover (?colors=cover) ---

function applyPosterColors(swatches) {
    const poster = document.getElementById('album-container')
    const vars = ['--poster-bg', '--poster-fg', '--poster-accent']
    const colors = document.documentElement.dataset.colors === 'cover' && swatches
        ? pickColors(swatches)
        : null

    if (colors) {
        poster.style.setProperty('--poster-bg', colors.bg)
        poster.style.setProperty('--poster-fg', colors.fg)
        poster.style.setProperty('--poster-accent', colors.accent)
    } else {
        vars.forEach(name => poster.style.removeProperty(name)) // back to the classic look
    }
}
