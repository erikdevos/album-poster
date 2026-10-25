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

// ---------- The details of an album ----------
import { validateDetails, formatDetails } from '../../scripting/albumData.js'

const detail = (changes = {}) => ({
    v: 1, fetchedAt: 1_700_000_000_000,
    album: { id: A, title: 'LUX', artist: 'ROSALÍA', year: '2025', barcode: '196873722672', label: 'Columbia', genre: 'art pop',
        tracks: [{ number: '1', title: 'Reliquia' }], front: 'https://coverartarchive.org/x.jpg', back: '', frontFull: '', backFull: '', ...changes }
})

test('valid details come back clean, in a fixed order', () => {
    const clean = validateDetails({ ...detail(), extra: 1 }, A)
    assert.deepEqual(Object.keys(clean), ['v', 'fetchedAt', 'album'])
    assert.deepEqual(Object.keys(clean.album).slice(0, 4), ['id', 'title', 'artist', 'year'])
    assert.equal(formatDetails(detail(), A).endsWith('}\n'), true)
})

test('details are refused when they are for another album, or incomplete or odd', () => {
    assert.throws(() => validateDetails(detail(), B), /another album/)
    assert.throws(() => validateDetails({ ...detail(), v: 0 }, A), /version/)
    assert.throws(() => validateDetails({ ...detail(), fetchedAt: 'yesterday' }, A), /date/)
    assert.throws(() => validateDetails({ v: 1, fetchedAt: 1 }, A), /no album/)
    assert.throws(() => validateDetails(detail({ title: ' ' }), A), /title/)
    assert.throws(() => validateDetails(detail({ tracks: 'x' }), A), /tracks/)
    assert.throws(() => validateDetails(detail({ front: 'http://insecure.test/x.jpg' }), A), /https/)
    assert.throws(() => validateDetails(detail({ front: 'javascript:alert(1)' }), A), /https/)
    assert.throws(() => validateDetails(detail({ label: 'x'.repeat(501) }), A), /text/)
    assert.throws(() => validateDetails(detail({ tracks: Array.from({ length: 501 }, () => ({ title: 'x' })) }), A), /tracks/)
})

test('a track length is kept in milliseconds, and is null when it is unknown or cannot be right', () => {
    const lengths = tracks => validateDetails(detail({ tracks }), A).album.tracks.map(track => track.length)
    assert.deepEqual(lengths([
        { title: 'a', length: 140760 }, { title: 'b', length: 1234.6 }, { title: 'c', length: null }, { title: 'd' },
        { title: 'e', length: -1 }, { title: 'f', length: 0 }, { title: 'g', length: 'long' }, { title: 'h', length: 90_000_000 }
    ]), [140760, 1235, null, null, null, null, null, null])
})

test('missing optional fields become empty text', () => {
    const clean = validateDetails({ v: 1, fetchedAt: 1, album: { id: A, title: 'LUX', artist: 'Rosalia', tracks: [] } }, A)
    assert.equal(clean.album.year, '')
    assert.equal(clean.album.front, '')
})
