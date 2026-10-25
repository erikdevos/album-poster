import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    sortAlbums, filterAlbums, groupByArtist, neighbours, browseOrder,
    wallOptions, wallParams, posterLink, DEFAULT_COVER_REM, MIN_COVER_REM, MAX_COVER_REM
} from '../../scripting/wallList.js'

// newest first, as albumList.js hands them over
const albums = [
    { id: 'c', name: 'Violator', artist: 'Depeche Mode' },
    { id: 'b', name: 'LUX', artist: 'Rosalía' },
    { id: 'a', name: 'Abbey Road', artist: 'The Beatles' },
    { id: 'd', name: 'Rubber Soul', artist: 'The Beatles' },
    { id: 'e', name: 'Ænima', artist: 'Tool' }
]
const ids = list => list.map(album => album.id).join('')

test('sorting by artist ignores "The", and breaks ties on the title', () => {
    assert.equal(ids(sortAlbums(albums, 'artist')), 'adcbe') // Beatles (Abbey, Rubber), Depeche, Rosalía, Tool
})

test('sorting by title, and "added" keeps the order of the list', () => {
    assert.equal(ids(sortAlbums(albums, 'title')), 'aebdc') // Abbey, Ænima (as "aenima"), LUX, Rubber, Violator
    assert.equal(ids(sortAlbums(albums, 'added')), 'cbade')
})

test('sorting does not change the list it is given', () => {
    const copy = [...albums]
    sortAlbums(albums, 'artist')
    assert.deepEqual(albums, copy)
})

test('filtering needs every word in the title or the artist, without caring for case or accents', () => {
    assert.equal(ids(filterAlbums(albums, 'rosalia')), 'b')
    assert.equal(ids(filterAlbums(albums, 'BEATLES road')), 'a')
    assert.equal(ids(filterAlbums(albums, 'aenima')), 'e')
    assert.equal(ids(filterAlbums(albums, 'nothing here')), '')
    assert.equal(filterAlbums(albums, '  '), albums)
})

test('grouping by artist keeps the order in which the artists come up', () => {
    const groups = groupByArtist(sortAlbums(albums, 'added'))
    assert.deepEqual(groups.map(group => group.artist), ['Depeche Mode', 'Rosalía', 'The Beatles', 'Tool'])
    assert.equal(ids(groups[2].albums), 'ad')
})

test('previous and next follow the browse order and go round at the ends', () => {
    assert.equal(ids(browseOrder(albums)), 'adcbe')
    assert.deepEqual([neighbours(albums, 'c').previous.id, neighbours(albums, 'c').next.id], ['d', 'b'])
    assert.equal(neighbours(albums, 'a').previous.id, 'e') // before the first is the last
    assert.equal(neighbours(albums, 'e').next.id, 'a')
    assert.equal(neighbours(albums, 'not-in-the-list'), null)
})

test('wall options come from the URL, with defaults and limits', () => {
    assert.deepEqual(wallOptions(new URLSearchParams('')), { query: '', sort: 'artist', group: 'none', size: DEFAULT_COVER_REM, layout: 'classic' })
    assert.deepEqual(wallOptions(new URLSearchParams('q=muse&sort=title&group=artist&size=14&layout=riso')),
        { query: 'muse', sort: 'title', group: 'artist', size: 14, layout: 'riso' })
    assert.equal(wallOptions(new URLSearchParams('layout=nope')).layout, 'classic')
    const odd = wallOptions(new URLSearchParams('sort=nonsense&group=x&size=2'))
    assert.equal(odd.sort, 'artist')
    assert.equal(odd.group, 'none')
    assert.equal(odd.size, MIN_COVER_REM)
    assert.equal(wallOptions(new URLSearchParams('size=500')).size, MAX_COVER_REM)
    assert.equal(wallOptions(new URLSearchParams('size=abc')).size, DEFAULT_COVER_REM)
})

test('wall parameters leave out the defaults, and keep the others that are in the URL', () => {
    const defaults = { query: '', sort: 'artist', group: 'none', size: DEFAULT_COVER_REM, layout: 'classic' }
    assert.equal(wallParams(defaults).toString(), '')
    assert.equal(wallParams({ ...defaults, query: 'muse', group: 'artist' }).toString(), 'q=muse&group=artist')
    assert.equal(wallParams({ ...defaults, layout: 'vinyl' }).toString(), 'layout=vinyl')
    // a layout that is in the URL but not in the settings (an older call) stays as the default
    assert.equal(wallParams(defaults, new URLSearchParams('layout=cd&q=old')).toString(), '')
    assert.equal(wallParams({ ...defaults, layout: 'cd' }, new URLSearchParams('theme=dark&q=old')).toString(), 'theme=dark&layout=cd')
})

test('a cover on the wall links to the poster, with the layout, theme and colours kept', () => {
    assert.equal(posterLink('abc', new URLSearchParams('')), '../#abc')
    assert.equal(posterLink('abc', new URLSearchParams('layout=cd&theme=dark&q=muse&size=12')), '../?layout=cd&theme=dark#abc')
})
