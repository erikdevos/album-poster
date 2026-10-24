// How big an export can be. Pure functions, no DOM.

// Output width in pixels. At 300 dpi these are about 20, 34 and 51 cm wide.
export const QUALITIES = {
    standard: 2400,
    high: 4000,
    maximum: 6000
}
export const DPI = 300

// A browser can only make a canvas up to some size, and a bigger one fails or comes out blank.
// iPhones, iPads and Safari are the strictest (16 megapixels); phones in general have little memory.
export function canvasLimits(userAgent = '') {
    const webKit = /iPhone|iPad|iPod/.test(userAgent) || (/Safari/.test(userAgent) && !/Chrome|Chromium|Android/.test(userAgent))
    const mobile = /Android|Mobile/.test(userAgent)
    return {
        maxSide: 16384,
        maxArea: webKit ? 16_000_000 : mobile ? 36_000_000 : 120_000_000
    }
}

// The largest scale the poster can be drawn at, within the limits of the browser
export function maxPixelRatio({ width, height, limits }) {
    return Math.min(
        limits.maxSide / width,
        limits.maxSide / height,
        Math.sqrt(limits.maxArea / (width * height))
    )
}

// The scale to draw the poster (as it is on screen) at, for the wanted quality, within the limits
export function planExport({ width, height, quality, limits }) {
    const wanted = QUALITIES[quality] ?? QUALITIES.standard
    const wantedRatio = wanted / width
    const pixelRatio = Math.min(wantedRatio, maxPixelRatio({ width, height, limits }))

    return {
        pixelRatio,
        pixelWidth: Math.round(width * pixelRatio),
        pixelHeight: Math.round(height * pixelRatio),
        reduced: pixelRatio < wantedRatio
    }
}
