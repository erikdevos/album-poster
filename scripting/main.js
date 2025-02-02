document.addEventListener('DOMContentLoaded', () => {
    // Add event listeners to album list links
    document.querySelectorAll('.albums-list a').forEach(link => {
        link.addEventListener('click', function(event) {
            event.preventDefault() // Prevent default anchor behavior
            
            const albumId = this.getAttribute('href').replace('#', '') // Extract ID from href
            document.getElementById('album-id').value = albumId // Set input value

            fetchAlbumDetails() // Automatically trigger search
        })
    })
})

async function fetchAlbumDetails() {
    const albumId = document.getElementById('album-id').value.trim()
    if (!albumId) {
        alert('Please enter an album ID')
        return
    }

    const apiKey = '2' // Demo API key
    const albumDetailsUrl = `https://www.theaudiodb.com/api/v1/json/${apiKey}/album.php?m=${albumId}`
    const trackListUrl = `https://www.theaudiodb.com/api/v1/json/${apiKey}/track.php?m=${albumId}`

    try {
        console.log(`Fetching album details from: ${albumDetailsUrl}`)
        const response = await fetch(albumDetailsUrl)
        if (!response.ok) throw new Error('Failed to fetch album data')

        const data = await response.json()
        console.log('Album Details API Response:', data)

        if (!data.album) throw new Error('No album details found')

        const album = data.album[0]

        // Fetch the tracklist
        console.log(`Fetching tracklist from: ${trackListUrl}`)
        const trackResponse = await fetch(trackListUrl)
        if (!trackResponse.ok) throw new Error('Failed to fetch tracklist data')

        const trackData = await trackResponse.json()
        console.log('Track List API Response:', trackData)

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
            albumGenre.style.display = 'none' // Hide genre if style exists
        } else if (album.strGenre) {
            albumGenre.textContent = album.strGenre
            albumGenre.style.display = 'block'
            albumStyle.style.display = 'none' // Hide style if only genre exists
        } else {
            albumStyle.style.display = 'none'
            albumGenre.style.display = 'none'
        }

        // Album cover (only set if available)
        const albumCover = document.getElementById('album-cover')
        if (album.strAlbumThumb) {
            albumCover.src = album.strAlbumThumb
            albumCover.style.display = 'block'
        } else {
            albumCover.style.display = 'none'
        }

        // Album back cover (only set if available)
        const albumCoverBack = document.getElementById('album-cover-back')
        if (album.strAlbumBack) {
            albumCoverBack.src = album.strAlbumBack
            albumCoverBack.style.display = 'block'
        } else {
            albumCoverBack.style.display = 'none'
        }

        // Populate tracklist
        const trackListEl = document.getElementById('track-list')
        trackListEl.innerHTML = '' // Clear previous tracks
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
