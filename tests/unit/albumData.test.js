import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateAlbums, formatAlbums, idFromText, diffAlbums } from '../../scripting/albumData.js'

const A = 'bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0'
const B = '02a544b3-0459-42c7-bd9c-047162e7b67a'

test('a valid list keeps only the known fields, in a fixed order, trimmed', () => {
    const list = validateAlbums([{ artist: ' Rosalia ', name: ' LUX ', id: A.toUpperCase(), audiodbId: 2458157, extra: 'x' }])
    assert.deepEqual(list, [{ id: A, audiodbId: '2458157', name: 'LUX', artist: 'Rosalia' }])
    assert.deepEqual(Object.keys(list[0]), ['id', 'audiodbId', 'name', 'artist'])
})

test('an album without a legacy id is fine', () => {
    assert.deepEqual(validateAlbums([{ id: A, name: 'LUX', artist: 'Rosalia' }]), [{ id: A, name: 'LUX', artist: 'Rosalia' }])
})

test('an invalid list says what is wrong', () => {
    assert.throws(() => validateAlbums({}), /array/)
    assert.throws(() => validateAlbums([null]), /not an object/)
    assert.throws(() => validateAlbums([{ id: 'nope', name: 'x', artist: 'y' }]), /valid MusicBrainz id/)
    assert.throws(() => validateAlbums([{ id: A, name: ' ', artist: 'y' }]), /no name/)
    assert.throws(() => validateAlbums([{ id: A, name: 'x', artist: '' }]), /no artist/)
    assert.throws(() => validateAlbums([{ id: A, name: 'x', artist: 'y' }, { id: A, name: 'z', artist: 'y' }]), /twice/)
    assert.throws(() => validateAlbums([{ id: A, name: 'x', artist: 'y', audiodbId: 'abc' }]), /audiodbId/)
    assert.throws(() => validateAlbums([
        { id: A, name: 'x', artist: 'y', audiodbId: '1' }, { id: B, name: 'z', artist: 'y', audiodbId: '1' }]), /another album/)
})

test('the file is written with two spaces and a newline at the end', () => {
    const text = formatAlbums([{ id: A, name: 'LUX', artist: 'Rosalia' }])
    assert.equal(text, `[\n  {\n    "id": "${A}",\n    "name": "LUX",\n    "artist": "Rosalia"\n  }\n]\n`)
})

test('an id is found in what was pasted: the id, or a link', () => {
    assert.equal(idFromText(A), A)
    assert.equal(idFromText(`https://musicbrainz.org/release-group/${A.toUpperCase()}/`), A)
    assert.equal(idFromText('rosalia lux'), null)
    assert.equal(idFromText(undefined), null)
})

test('the difference between the saved list and the page: added, removed and renamed', () => {
    const saved = [{ id: A, name: 'LUX', artist: 'Rosalia' }, { id: B, name: 'Old', artist: 'Billie' }]
    const current = [{ id: A, name: 'LUX', artist: 'Rosalía' }, { id: 'c'.repeat(8) + '-0000-4000-8000-000000000000', name: 'New', artist: 'X' }]
    const diff = diffAlbums(saved, current)
    assert.deepEqual(diff.added.map(album => album.name), ['New'])
    assert.deepEqual(diff.removed.map(album => album.name), ['Old'])
    assert.deepEqual(diff.edited.map(album => album.artist), ['Rosalía'])
    assert.deepEqual(diffAlbums(saved, saved), { added: [], removed: [], edited: [] })
})
