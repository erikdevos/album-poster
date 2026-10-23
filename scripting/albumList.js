// The curated list of albums, newest additions first. Albums without a MusicBrainz match are skipped.
export async function loadAlbumList() {
    try {
        const response = await fetch('data/albums.json')
        if (!response.ok) throw new Error('Failed to load album list')

        return (await response.json()).filter(album => album.id).reverse()
    } catch (error) {
        console.error('Error loading album list:', error)
        return []
    }
}
