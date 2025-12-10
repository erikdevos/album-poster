import { loadAlbumList } from './albumList.js'
import { fetchAlbumDetails } from './albumDetails.js'
import { extractPalette } from './albumColors.js'

document.addEventListener('DOMContentLoaded', () => {
    // Initial load of the album list
    loadAlbumList()

    // Check for album ID in URL hash and load it
    const hashAlbumId = window.location.hash.replace('#', '')
    if (hashAlbumId) {
        document.getElementById('album-id').value = hashAlbumId
        fetchAlbumDetails(hashAlbumId)
        extractPalette()
    }

    // Album list link click event
    document.querySelector('.albums-list').addEventListener('click', (event) => {
        if (event.target.tagName === 'A') {
            event.preventDefault()
            const albumId = event.target.getAttribute('href').replace('#', '')
            document.getElementById('album-id').value = albumId
            fetchAlbumDetails(albumId)
            extractPalette()
        }
    })

    // Search button click event
    document.getElementById('search-button').addEventListener('click', () => {
        const albumId = document.getElementById('album-id').value.trim()
        console.log('Search button clicked, album ID:', albumId) // Log the album ID
        if (albumId) {
            fetchAlbumDetails(albumId)
        } else {
            alert('Please enter an album ID to search')
        }
    })
})
