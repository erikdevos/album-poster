import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTrackLength, albumLength, formatAlbumLength } from '../../scripting/duration.js'

test('a track length is minutes and seconds, with hours from an hour on, and empty when unknown', () => {
    assert.equal(formatTrackLength(140760), '2:21')
    assert.equal(formatTrackLength(59_600), '1:00') // rounds to the second
    assert.equal(formatTrackLength(5_000), '0:05')
    assert.equal(formatTrackLength(3_723_000), '1:02:03')
    for (const unknown of [null, undefined, 0, -5, NaN, '3:00']) assert.equal(formatTrackLength(unknown), '')
})

test('the length of an album is the sum of its tracks, and unknown when one track has no length', () => {
    assert.equal(albumLength([{ length: 140760 }, { length: 230000 }, { length: 243240 }]), 614000)
    assert.equal(albumLength([{ length: 1000 }, { length: null }]), null)
    assert.equal(albumLength([{ length: 1000 }, {}]), null)
    assert.equal(albumLength([]), null)
    assert.equal(albumLength(undefined), null)
})

test('an album length reads like "41 min 46 sec", and hours from an hour on', () => {
    assert.equal(formatAlbumLength(2_506_000), '41 min 46 sec')
    assert.equal(formatAlbumLength(45_000), '45 sec')
    assert.equal(formatAlbumLength(3_723_000), '1 h 2 min')
    assert.equal(formatAlbumLength(null), '')
})
