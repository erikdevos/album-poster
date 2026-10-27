import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shuffle, createPlaylist, kioskOptionsFromParams, DEFAULT_INTERVAL_SECONDS } from '../../scripting/playlist.js'

// A fixed row of "random" numbers, so that the tests give the same result every time
const sequence = numbers => {
    let i = 0
    return () => numbers[i++ % numbers.length]
}
const params = query => new URLSearchParams(query)

test('shuffle gives the same items in another order and leaves the original alone', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    const shuffled = shuffle(items, sequence([0.1, 0.9, 0.5, 0.3]))
    assert.deepEqual([...shuffled].sort(), items)
    assert.notDeepEqual(shuffled, items)
    assert.deepEqual(items, [1, 2, 3, 4, 5, 6, 7, 8])
})

test('the playlist plays everything once before it repeats', () => {
    const list = createPlaylist(['a', 'b', 'c', 'd'])
    for (let round = 0; round < 5; round++) {
        const played = [list.next(), list.next(), list.next(), list.next()]
        assert.deepEqual([...played].sort(), ['a', 'b', 'c', 'd'])
    }
})

test('the same item never comes twice in a row, also not between rounds', () => {
    const list = createPlaylist(['a', 'b'])
    let previous = list.next()
    for (let i = 0; i < 200; i++) {
        const current = list.next()
        assert.notEqual(current, previous)
        previous = current
    }
})

test('the item that is on the screen when the playlist starts does not come up first', () => {
    // with a random that would put 'a' first: the unlucky case, for every starting item
    for (const current of ['a', 'b', 'c', 'd']) {
        for (let run = 0; run < 100; run++) {
            const list = createPlaylist(['a', 'b', 'c', 'd'], Math.random, current)
            assert.notEqual(list.next(), current)
        }
    }
    // a list of one has nothing else to play, and an item that is not in the list changes nothing
    assert.equal(createPlaylist(['only'], Math.random, 'only').next(), 'only')
    assert.ok(['a', 'b'].includes(createPlaylist(['a', 'b'], Math.random, 'zzz').next()))
})

test('a playlist of one repeats it, and an empty one gives nothing', () => {
    const one = createPlaylist(['only'])
    assert.equal(one.next(), 'only')
    assert.equal(one.next(), 'only')
    assert.equal(createPlaylist([]).next(), null)
})

test('kiosk off unless the URL asks for it', () => {
    assert.equal(kioskOptionsFromParams(params('')), null)
    assert.equal(kioskOptionsFromParams(params('kiosk=false')), null)
    assert.equal(kioskOptionsFromParams(params('kiosk=off')), null)
    assert.equal(kioskOptionsFromParams(params('kiosk=0')), null)
})

test('kiosk=true and a bare kiosk use the default interval', () => {
    assert.equal(kioskOptionsFromParams(params('kiosk=true')).intervalSeconds, DEFAULT_INTERVAL_SECONDS)
    assert.equal(kioskOptionsFromParams(params('kiosk')).intervalSeconds, DEFAULT_INTERVAL_SECONDS)
    assert.equal(kioskOptionsFromParams(params('kiosk=banana')).intervalSeconds, DEFAULT_INTERVAL_SECONDS)
})

test('the interval is taken from the URL, within limits', () => {
    assert.equal(kioskOptionsFromParams(params('kiosk=25')).intervalSeconds, 25)
    assert.equal(kioskOptionsFromParams(params('kiosk=1')).intervalSeconds, 3)
    assert.equal(kioskOptionsFromParams(params('kiosk=99999')).intervalSeconds, 3600)
})

test('source and progress options', () => {
    const defaults = kioskOptionsFromParams(params('kiosk=10'))
    assert.equal(defaults.source, 'curated')
    assert.equal(defaults.progress, true)

    const options = kioskOptionsFromParams(params('kiosk=10&source=random&progress=false'))
    assert.equal(options.source, 'random')
    assert.equal(options.progress, false)

    assert.equal(kioskOptionsFromParams(params('kiosk=10&source=whatever')).source, 'curated')
})
