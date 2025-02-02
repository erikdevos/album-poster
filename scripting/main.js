import { loadAlbumList } from './albumList.js'
import { fetchAlbumDetails } from './albumDetails.js'
import { extractPalette } from './albumColors.js'


document.addEventListener('DOMContentLoaded', () => {
    loadAlbumList()

    // Add event listeners to album list links (after dynamic loading)
    document.querySelector('.albums-list').addEventListener('click', function(event) {
        if (event.target.tagName === 'A') {
            event.preventDefault()

            const albumId = event.target.getAttribute('href').replace('#', '')
            document.getElementById('album-id').value = albumId

            fetchAlbumDetails()
            extractPalette()
        }
    })
})
