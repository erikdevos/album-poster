import { test } from 'node:test'
import assert from 'node:assert/strict'

// router.js only reads window.location when a function is called
function at(search, hash) {
    globalThis.window = { location: { search, hash } }
}

const { parseLocation, isLegacyId, isValidId } = await import('../../scripting/router.js')

const ID = 'bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0'

test('reads the album id from the hash and options from the query', () => {
    at('?size=s&theme=dark', `#${ID}`)
    const { albumId, params } = parseLocation()
    assert.equal(albumId, ID)
    assert.equal(params.get('size'), 's')
    assert.equal(params.get('theme'), 'dark')
})

test('understands the legacy form with options after the hash', () => {
    at('', `#${ID}?layout=swiss&theme=dark`)
    const { albumId, params } = parseLocation()
    assert.equal(albumId, ID)
    assert.equal(params.get('layout'), 'swiss')
    assert.equal(params.get('theme'), 'dark')
})

test('an option in the query wins over the same option after the hash', () => {
    at('?theme=light', `#${ID}?theme=dark`)
    assert.equal(parseLocation().params.get('theme'), 'light')
})

test('no hash gives an empty album id', () => {
    at('', '')
    assert.equal(parseLocation().albumId, '')
})

test('tells legacy numeric ids apart from MusicBrainz ids', () => {
    assert.equal(isLegacyId('2458157'), true)
    assert.equal(isLegacyId(ID), false)
    assert.equal(isValidId(ID), true)
    assert.equal(isValidId('2458157'), false)
    assert.equal(isValidId('not-an-id'), false)
    assert.equal(isValidId(''), false)
})
