export async function fetchAlbumDetails() {
    const albumId = document.getElementById('album-id').value.trim()
    if (!albumId) {
        alert('Please enter an album ID')
        return
    }

    const apiKey = '2' // Demo API key
    const albumDetailsUrl = `https://www.theaudiodb.com/api/v1/json/${apiKey}/album.php?m=${albumId}`
    const trackListUrl = `https://www.theaudiodb.com/api/v1/json/${apiKey}/track.php?m=${albumId}`

    try {
        const response = await fetch(albumDetailsUrl)
        if (!response.ok) throw new Error('Failed to fetch album data')

        const data = await response.json()
        if (!data.album) throw new Error('No album details found')

        const album = data.album[0]

        const trackResponse = await fetch(trackListUrl)
        if (!trackResponse.ok) throw new Error('Failed to fetch tracklist data')

        const trackData = await trackResponse.json()

        // Update elements safely
        document.getElementById('album-name').textContent = album.strAlbum || 'Unknown Album'
        document.getElementById('album-artist').textContent = album.strArtist || 'Unknown Artist'
        document.getElementById('album-label').textContent = album.strLabel || ''
        document.getElementById('album-year').textContent = album.intYearReleased || ''

        // Handle album style and genre logic
        const albumStyle = document.getElementById('album-style')
        const albumGenre = document.getElementById('album-genre')

        if (album.strStyle) {
            albumStyle.textContent = album.strStyle
            albumStyle.style.display = 'block'
            albumGenre.style.display = 'none'
        } else if (album.strGenre) {
            albumGenre.textContent = album.strGenre
            albumGenre.style.display = 'block'
            albumStyle.style.display = 'none'
        } else {
            albumStyle.style.display = 'none'
            albumGenre.style.display = 'none'
        }

        // Set album cover
        const albumCover = document.getElementById('album-cover')
        if (album.strAlbumThumb) {
            albumCover.src = album.strAlbumThumb
            albumCover.style.display = 'block'
        } else {
            albumCover.style.display = 'none'
        }

        // Set album back cover
        const albumCoverBack = document.getElementById('album-cover-back')
        if (album.strAlbumBack) {
            albumCoverBack.src = album.strAlbumBack
            albumCoverBack.style.display = 'block'
        } else {
            albumCoverBack.style.display = 'none'
        }

        // Populate tracklist
        const trackListEl = document.getElementById('track-list')
        trackListEl.innerHTML = ''
        if (trackData.track) {
            trackData.track.forEach(track => {
                const li = document.createElement('li')
                li.textContent = track.strTrack
                trackListEl.appendChild(li)
            })
        } else {
            trackListEl.innerHTML = '<p>No tracklist data available</p>'
        }

    } catch (error) {
        console.error('Error fetching album details:', error)
        document.getElementById('album-info').innerHTML = '<p>Error fetching album details</p>'
    }
}
