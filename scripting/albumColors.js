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
    img.addEventListener('load', () => extractPalette(img))
}

// --- Poster colours from the cover (?colors=cover) ---

const BACKGROUND_ORDER = ['DarkMuted', 'Muted', 'DarkVibrant', 'Vibrant']
const ACCENT_ORDER = ['LightVibrant', 'Vibrant', 'LightMuted']
const MIN_TEXT_CONTRAST = 4.5
const MIN_ACCENT_CONTRAST = 3

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

// Background from the first swatch that gives readable black or white text on top of it;
// the accent must still contrast with that background, otherwise it is the text colour
function pickColors(swatches) {
    for (const name of BACKGROUND_ORDER) {
        const swatch = swatches[name]
        if (!swatch) continue

        const rgb = swatch.getRgb().map(Math.round)
        const [fg, contrast] = bestText(rgb)
        if (contrast < MIN_TEXT_CONTRAST) continue

        const accentSwatch = ACCENT_ORDER.map(key => swatches[key]).find(candidate =>
            candidate && contrastRatio(candidate.getRgb(), rgb) >= MIN_ACCENT_CONTRAST)

        return {
            bg: `rgb(${rgb.join(' ')})`,
            fg,
            accent: accentSwatch ? accentSwatch.getHex() : fg
        }
    }
    return null
}

function bestText(rgb) {
    const white = contrastRatio([255, 255, 255], rgb)
    const black = contrastRatio([0, 0, 0], rgb)
    return white >= black ? ['#ffffff', white] : ['#000000', black]
}

// WCAG 2 contrast ratio
function contrastRatio(a, b) {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (light + 0.05) / (dark + 0.05)
}

function luminance(rgb) {
    const [r, g, b] = rgb.map(channel => {
        const c = channel / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
