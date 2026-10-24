// The curated list of albums, newest additions first. Albums without a MusicBrainz match are skipped.
// (the address is relative to this file, so it is right for the poster, the wall and the admin)
export async function loadAlbumList(url = new URL('../data/albums.json', import.meta.url)) {
    try {
        const response = await fetch(url)
        if (!response.ok) throw new Error('Failed to load album list')

        return (await response.json()).filter(album => album.id).reverse()
    } catch (error) {
        console.error('Error loading album list:', error)
        return []
    }
}
