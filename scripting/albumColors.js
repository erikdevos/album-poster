document.addEventListener("DOMContentLoaded", function () {
    const albumCover = document.querySelector("#album-cover")

    if (!albumCover) {
        console.error("No #albumcover found.")
        return
    }

    albumCover.addEventListener("load", function () {
        //console.log("Image loaded, extracting color palette...")
        extractPalette(albumCover)
    })

    //console.log("Waiting for image to load...")
})

function extractPalette(img) {
    try {
        //console.log("Extracting color palette...")
        const vibrant = new Vibrant(img)
        const swatches = vibrant.swatches()
        const colorsContainer = document.querySelector("#album-colors")

        if (!colorsContainer) {
            console.error("No #album-colors container found.")
            return
        }

        colorsContainer.innerHTML = ""

        for (const swatch in swatches) {
            if (swatches.hasOwnProperty(swatch) && swatches[swatch]) {
                const color = swatches[swatch].getHex()
                //console.log(swatch, color)

                const colorDiv = document.createElement("div")
                colorDiv.classList.add("album-color")
                colorDiv.style.backgroundColor = color
                colorDiv.dataset.swatch = swatch

                colorsContainer.appendChild(colorDiv)
            }
        }
    } catch (error) {
        console.error("Error extracting palette:", error)
    }
}

export { extractPalette }
