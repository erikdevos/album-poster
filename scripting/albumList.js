export async function loadAlbumList() {
    try {
        const response = await fetch('data/albums.json')
        if (!response.ok) throw new Error('Failed to load album list')

        const albums = await response.json()
        const albumListEl = document.querySelector('.albums-list')

        albumListEl.innerHTML = '' // Clear existing items

        albums.forEach(album => {
            const li = document.createElement('li')
            const a = document.createElement('a')
            a.href = `#${album.id}`
            a.textContent = `${album.name} – ${album.artist}`
            li.appendChild(a)
            albumListEl.appendChild(li)
        })
    } catch (error) {
        console.error('Error loading album list:', error)
    }
}
