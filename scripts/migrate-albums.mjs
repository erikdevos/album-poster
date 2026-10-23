// One-off helper: maps the TheAudioDB ids in data/albums.json to MusicBrainz release-group ids.
// Usage: node scripts/migrate-albums.mjs  (about 1 request per second, writes data/albums.next.json)
import { readFile, writeFile } from 'node:fs/promises'

const UA = 'album-poster/0.2 (https://github.com/erikdevos/album-poster)'
const albums = JSON.parse(await readFile('data/albums.json', 'utf8'))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const esc = s => s.replace(/([+\-&|!(){}\[\]^"~*?:\\/])/g, '\\$1')

const result = []
for (const album of albums) {
    const query = `releasegroup:"${esc(album.name)}" AND artist:"${esc(album.artist)}" AND primarytype:album`
    const url = `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(query)}&limit=5&fmt=json`
    let hit = null
    for (let attempt = 0; attempt < 3 && !hit; attempt++) {
        const res = await fetch(url, { headers: { 'User-Agent': UA } })
        if (res.ok) {
            const { 'release-groups': groups } = await res.json()
            hit = groups[0] ?? false
            break
        }
        await sleep(2000)
    }
    const found = hit ? `${hit.title} – ${hit['artist-credit']?.[0]?.name} (${hit.score})` : 'NOT FOUND'
    console.log(`${album.name} – ${album.artist}  =>  ${found}`)
    result.push({ id: hit?.id ?? null, audiodbId: album.id, name: album.name, artist: album.artist, score: hit?.score ?? 0 })
    await sleep(1100)
}
await writeFile('data/albums.next.json', JSON.stringify(result, null, 2) + '\n')
