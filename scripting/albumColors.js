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
    } catch (error) {
        console.error('Error extracting palette:', error)
        colorsContainer.replaceChildren()
    }
}

// Re-extracts the palette every time the cover has finished loading
export function watchCover(img) {
    img.addEventListener('load', () => extractPalette(img))
}
