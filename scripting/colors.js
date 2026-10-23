// Picking readable poster colours from a palette. Pure functions, no DOM.

const BACKGROUND_ORDER = ['DarkMuted', 'Muted', 'DarkVibrant', 'Vibrant']
const ACCENT_ORDER = ['LightVibrant', 'Vibrant', 'LightMuted']
export const MIN_TEXT_CONTRAST = 4.5
export const MIN_ACCENT_CONTRAST = 3

// Background from the first swatch that gives readable black or white text on top of it;
// the accent must still contrast with that background, otherwise it is the text colour
export function pickColors(swatches) {
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
export function contrastRatio(a, b) {
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
