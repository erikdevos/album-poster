import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contrastRatio, pickColors, darkenToContrast, MIN_TEXT_CONTRAST } from '../../scripting/colors.js'

const swatch = (r, g, b) => ({
    getRgb: () => [r, g, b],
    getHex: () => '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')
})

test('contrast ratio follows WCAG', () => {
    assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]).toFixed(1), '21.0')
    assert.equal(contrastRatio([255, 255, 255], [255, 255, 255]), 1)
    // order of the arguments does not matter
    assert.equal(contrastRatio([10, 20, 30], [200, 210, 220]), contrastRatio([200, 210, 220], [10, 20, 30]))
})

test('uses the first swatch that gives readable text, with white text on a dark one', () => {
    const colors = pickColors({
        DarkMuted: swatch(30, 40, 60),
        Muted: swatch(120, 120, 120),
        LightVibrant: swatch(250, 220, 90)
    })
    assert.equal(colors.bg, 'rgb(30 40 60)')
    assert.equal(colors.fg, '#ffffff')
    assert.equal(colors.accent, '#fadc5a')
})

test('any colour is readable with black or white, so the first available swatch is used', () => {
    // The worst case is a grey of about #767676: 4.5:1 or a bit more against both black and white.
    // That is why the minimum of 4.5 never rejects a swatch; it only guards against changes.
    const midTone = swatch(118, 118, 118)
    const best = Math.max(contrastRatio([0, 0, 0], [118, 118, 118]), contrastRatio([255, 255, 255], [118, 118, 118]))
    assert.ok(best >= MIN_TEXT_CONTRAST)

    const colors = pickColors({ DarkMuted: midTone, Muted: swatch(250, 245, 235) })
    assert.equal(colors.bg, 'rgb(118 118 118)')
})

test('falls back to the next swatch in order, and gives up (classic look) without any', () => {
    assert.equal(pickColors({ Muted: swatch(250, 245, 235) }).bg, 'rgb(250 245 235)')
    assert.equal(pickColors({ LightMuted: swatch(250, 245, 235) }), null) // not used as a background
    assert.equal(pickColors({}), null)
})

test('an accent that does not contrast with the background becomes the text colour', () => {
    const colors = pickColors({ DarkMuted: swatch(20, 20, 20), LightVibrant: swatch(30, 30, 30) })
    assert.equal(colors.accent, colors.fg)
})

test('a colour is darkened until it contrasts enough, and one that does is left alone', () => {
    const paper = [244, 239, 227]
    assert.deepEqual(darkenToContrast([29, 47, 111], paper, 4.5), [29, 47, 111])

    // a bright olive that DarkVibrant can give for a yellow cover
    const olive = [200, 190, 20]
    assert.ok(contrastRatio(olive, paper) < 3)
    const darker = darkenToContrast(olive, paper, 4.5)
    assert.ok(contrastRatio(darker, paper) >= 4.5)
    // only darker, and by about the same factor in every channel: the hue stays
    assert.ok(darker.every((channel, i) => channel <= olive[i]))
    assert.ok(Math.abs(darker[0] / olive[0] - darker[1] / olive[1]) < 0.02)

    // a contrast that no colour can reach: the end of the road is black
    assert.deepEqual(darkenToContrast([200, 190, 20], paper, 30), [0, 0, 0])
})
