import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitFactors } from '../../scripting/albumDetails.js'

const album = (title, artist, tracks = 10) => ({ title, artist, tracks: Array.from({ length: tracks }, () => ({})) })

test('short names are not shrunk', () => {
    const fit = fitFactors(album('LUX', 'ROSALÍA'))
    assert.equal(fit['--fit-title'], '1.00')
    assert.equal(fit['--fit-artist'], '1.00')
    assert.equal(fit['--fit-word'], '1.00')
})

test('long names shrink, but never below half', () => {
    const fit = fitFactors(album('When We All Fall Asleep, Where Do We Go? Deluxe Anniversary Edition', 'A'.repeat(200)))
    assert.equal(fit['--fit-title'], '0.50')
    assert.equal(fit['--fit-artist'], '0.50')
})

test('a single long word limits the title in the big layouts', () => {
    const fit = fitFactors(album('Supercalifragilistic', 'X'))
    assert.equal(fit['--fit-word'], '0.50')
    assert.equal(fitFactors(album('Reanimation', 'X'))['--fit-word'], '0.91')
})

test('the track count is at least one', () => {
    assert.equal(fitFactors(album('A', 'B', 0))['--track-count'], 1)
    assert.equal(fitFactors(album('A', 'B', 28))['--track-count'], 28)
})
