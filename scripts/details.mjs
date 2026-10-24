// Fetches the details of the albums in data/albums.json from MusicBrainz and the Cover Art Archive
// and writes them to data/details/<id>.json, so that the app can show these albums without asking
// MusicBrainz (and offline). MusicBrainz allows about one request a second and an album takes two or
// three, so the first run for the whole list takes several minutes; after that only new albums.
//
//   npm run details                 only the albums that have no file yet
//   npm run details -- --stale      also the files older than 30 days
//   npm run details -- --all        everything again
//   npm run details -- --id=<id>    one album again
//
// Files of albums that are no longer in the list are removed.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { validateAlbums } from '../scripting/albumData.js'
import { SCHEMA, TTL_MS, makeRecord } from '../scripting/albumCache.js'
import { listDetails, pruneDetails, writeDetails } from './detailsFiles.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const UA = 'album-poster/1.0 (https://github.com/erikdevos/album-poster)'

// MusicBrainz wants to know who is asking, and a browser cannot say, so the script does
const realFetch = globalThis.fetch
globalThis.fetch = (input, init = {}) => realFetch(input, { ...init, headers: { 'User-Agent': UA, ...init.headers } })
const { getAlbum } = await import('../scripting/sources/musicbrainz.js')

const args = process.argv.slice(2)
const only = args.find(arg => arg.startsWith('--id='))?.slice('--id='.length)
const everything = args.includes('--all')
const stale = args.includes('--stale')

const albums = validateAlbums(JSON.parse(await readFile(`${root}data/albums.json`, 'utf8')))
const have = await listDetails(root)
const wanted = albums.filter(album => {
    if (only) return album.id === only
    if (everything || !have.has(album.id)) return true
    return stale && Date.now() - have.get(album.id) > TTL_MS
})

const gone = await pruneDetails(root, albums.map(album => album.id))
if (gone.length) console.log(`Removed the details of ${gone.length} albums that are not in the list any more.`)
console.log(`${wanted.length} of ${albums.length} albums to fetch (schema ${SCHEMA}).`)

const failed = []
for (const [index, album] of wanted.entries()) {
    const label = `[${index + 1}/${wanted.length}] ${album.artist} - ${album.name}`
    try {
        await writeDetails(root, album.id, makeRecord(await getAlbum(album.id)))
        console.log(`${label}: done`)
    } catch (error) {
        failed.push(album)
        console.log(`${label}: FAILED (${error.message})`)
    }
}

if (failed.length) {
    console.log(`\n${failed.length} failed; run the command again to try those once more.`)
    process.exitCode = 1
} else {
    console.log('\nAll done. Check the files with git status and commit data/details.')
}
