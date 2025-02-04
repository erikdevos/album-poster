import { fetchAlbumDetails } from './albumDetails.js';
import { extractPalette } from './albumColors.js';

export async function loadAlbumList() {
    try {
        const response = await fetch('data/albums.json')
        if (!response.ok) throw new Error('Failed to load album list')

        const albums = await response.json()
        const albumListEl = document.querySelector('.albums-list')

        albumListEl.innerHTML = '' // Clear existing items

        // Reverse the albums array
        albums.reverse()

        albums.forEach(album => {
            const li = document.createElement('li')
            const a = document.createElement('a')
            a.href = `#${album.id}`
            a.textContent = `${album.name} – ${album.artist}`
            li.appendChild(a)
            albumListEl.appendChild(li)
        })
        console.log("Albums loaded");
    } catch (error) {
        console.error('Error loading album list:', error)
    }
}

// Get the query string from the URL
const params = new URLSearchParams(window.location.search)

// Check if the "debug" parameter is set to "true"
if (params.get('debug') === 'true') {
  // Show the element
  document.getElementById('search-bar').style.display = 'block'
} else {
  // Hide the element
  document.getElementById('search-bar').style.display = 'none'
}

// Check the "size" parameter and add the corresponding class to #album-info
const albumInfo = document.getElementById('album-container')
const size = params.get('size')

if (size === 'l') {
  albumInfo.classList.add('size-l')
} else if (size === 'm') {
  albumInfo.classList.add('size-m')
} else if (size === 's') {
  albumInfo.classList.add('size-s')
}

// Search button click event
document.getElementById('search-button').addEventListener('click', (event) => {
    const albumId = document.getElementById('album-id').value.trim()
    if (albumId) {
        fetchAlbumDetails(albumId)
        extractPalette()
        console.log("fetch album");
        console.log(albumId);
    } else {
        alert('Please enter a valid album ID')
    }
})