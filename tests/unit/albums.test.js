import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isValidId } from '../../scripting/sources/musicbrainz.js'

const albums = JSON.parse(await readFile(new URL('../../data/albums.json', import.meta.url), 'utf8'))

test('every curated album has a MusicBrainz id, a name and an artist', () => {
    assert.ok(albums.length > 0)
    for (const album of albums) {
        assert.ok(isValidId(album.id), `bad id for ${album.name}: ${album.id}`)
        assert.ok(album.name?.trim(), `no name for ${album.id}`)
        assert.ok(album.artist?.trim(), `no artist for ${album.name}`)
    }
})

test('ids are unique, and so are the legacy TheAudioDB ids', () => {
    const ids = albums.map(album => album.id)
    assert.equal(new Set(ids).size, ids.length)

    const legacy = albums.map(album => album.audiodbId).filter(Boolean)
    assert.equal(new Set(legacy).size, legacy.length)
    for (const id of legacy) assert.match(id, /^\d+$/)
})
