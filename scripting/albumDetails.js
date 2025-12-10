document.addEventListener('DOMContentLoaded', () => {
    loadAlbumList()

    // Add event listeners to album list links (after dynamic loading)
    document.querySelector('.albums-list').addEventListener('click', function(event) {
        if (event.target.tagName === 'A') {
            event.preventDefault()

            const albumId = event.target.getAttribute('href').replace('#', '')
            document.getElementById('album-id').value = albumId
            console.log("fetch album details");
            fetchAlbumDetails()
        }
    })
})

// Modify the loadAlbumList function to set a random album as default
async function loadAlbumList() {
    try {
        const response = await fetch('data/albums.json')
        if (!response.ok) throw new Error('Failed to load album list')

        const albums = await response.json()
        const albumListEl = document.querySelector('.albums-list')

        // Clear existing items
        albumListEl.innerHTML = ''

        // Populate list dynamically and set a random album
        let defaultAlbumId = null;
        albums.forEach(album => {
            const li = document.createElement('li')
            const a = document.createElement('a')
            a.href = `#${album.id}`
            a.textContent = `${album.name} – ${album.artist}`
            li.appendChild(a)
            albumListEl.appendChild(li)
        })

        // Set a random album from the list as the default
        if (albums.length > 0) {
            const randomIndex = Math.floor(Math.random() * albums.length)
            defaultAlbumId = albums[randomIndex].id

            // Set the default album ID in the input
            document.getElementById('album-id').value = defaultAlbumId
            fetchAlbumDetails() // Fetch the details of the randomly selected album
        }

    } catch (error) {
        console.error('Error loading album list:', error)
    }
}

// Your existing fetchAlbumDetails function remains unchanged
async function fetchAlbumDetails() {
    const albumId = document.getElementById('album-id').value.trim()
    console.log("called fetch album!");
    if (!albumId) {
        alert('Please enter an album ID');
        console("no album id");
        return
    }

    const apiKey = '2' // Demo API key
    const albumDetailsUrl = `https://www.theaudiodb.com/api/v1/json/${apiKey}/album.php?m=${albumId}`
    const trackListUrl = `https://www.theaudiodb.com/api/v1/json/${apiKey}/track.php?m=${albumId}`

    try {
        console.log("Fetch album details")
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
    
        // Handle album label visibility
        const albumLabel = document.getElementById('album-label')
        const albumTextLabel = document.querySelector('.album-text-label')
        console.log('Album Label:', album.strLabel) // Debugging line
    
        if (album.strLabel && album.strLabel.trim() !== '') {
            albumLabel.textContent = album.strLabel
            albumTextLabel.classList.remove('hidden') // Show label
            albumLabel.classList.remove('hidden') // Show label content
        } else {
            albumTextLabel.classList.add('hidden') // Hide label
            albumLabel.classList.add('hidden') // Hide label content
        }
    
        // Handle album year visibility
        const albumYear = document.getElementById('album-year')
        console.log('Album Year:', album.intYearReleased) // Debugging line
    
        if (album.intYearReleased && album.intYearReleased.toString().trim() !== '') {
            albumYear.textContent = album.intYearReleased
            albumYear.classList.remove('hidden') // Show year
        } else {
            albumYear.classList.add('hidden') // Hide year
        }
    
        // Handle album style and genre visibility
        const albumStyle = document.getElementById('album-style')
        const albumGenre = document.getElementById('album-genre')
        console.log('Album Style:', album.strStyle) // Debugging line
        console.log('Album Genre:', album.strGenre) // Debugging line
    
        if (album.strStyle && album.strStyle.trim() !== '') {
            albumStyle.textContent = album.strStyle
            albumStyle.classList.remove('hidden') // Show style
            albumGenre.classList.add('hidden') // Hide genre
        } else if (album.strGenre && album.strGenre.trim() !== '') {
            albumGenre.textContent = album.strGenre
            albumGenre.classList.remove('hidden') // Show genre
            albumStyle.classList.add('hidden') // Hide style
        } else {
            albumStyle.classList.add('hidden') // Hide style
            albumGenre.classList.add('hidden') // Hide genre
        }
    
        // Set album cover
        const albumCover = document.getElementById('album-cover')
        if (album.strAlbumThumb && album.strAlbumThumb.trim() !== '') {
            // Use CORS proxy to avoid CORS issues with color extraction
            albumCover.src = `https://cors-anywhere.herokuapp.com/${album.strAlbumThumb}`
            albumCover.classList.remove('hidden')
        } else {
            albumCover.classList.add('hidden')
        }
    
        // Set album back cover
        const albumCoverBack = document.getElementById('album-cover-back')
        if (album.strAlbumBack && album.strAlbumBack.trim() !== '') {
            // Use CORS proxy to avoid CORS issues
            albumCoverBack.src = `https://cors-anywhere.herokuapp.com/${album.strAlbumBack}`
            albumCoverBack.classList.remove('hidden')
        } else {
            albumCoverBack.classList.add('hidden')
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

// Exporting the function for use in main.js
export { fetchAlbumDetails }
