import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QUALITIES, planExport, canvasLimits } from '../../scripting/exportPlan.js'

const desktop = canvasLimits('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')

test('every quality is a width in pixels, getting larger', () => {
    assert.ok(QUALITIES.standard < QUALITIES.high && QUALITIES.high < QUALITIES.maximum)
})

test('the poster is drawn at the scale that gives the wanted width', () => {
    const plan = planExport({ width: 400, height: 740, quality: 'high', limits: desktop })
    assert.equal(plan.pixelWidth, QUALITIES.high)
    assert.equal(plan.pixelHeight, 7400)
    assert.equal(plan.pixelRatio, 10)
    assert.equal(plan.reduced, false)
})

test('an unknown quality falls back to standard', () => {
    assert.equal(planExport({ width: 400, height: 700, quality: 'nope', limits: desktop }).pixelWidth, QUALITIES.standard)
})

test('a canvas that would be too large is scaled down, and that is reported', () => {
    const plan = planExport({ width: 343, height: 1007, quality: 'maximum', limits: canvasLimits('iPhone Safari Mobile') })
    assert.equal(plan.reduced, true)
    assert.ok(plan.pixelWidth < QUALITIES.maximum)
    assert.ok(plan.pixelWidth * plan.pixelHeight <= 16_000_000)
})

test('no side is ever longer than the browser allows', () => {
    // a very tall poster: 30 times as high as it is wide
    const plan = planExport({ width: 300, height: 9000, quality: 'maximum', limits: desktop })
    assert.ok(plan.pixelHeight <= 16384)
    assert.equal(plan.reduced, true)
})

test('limits per browser: Safari and iPhones are strict, phones are careful', () => {
    const area = userAgent => canvasLimits(userAgent).maxArea
    const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'
    const chrome = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130.0 Safari/537.36'
    const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'
    const iphoneChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 CriOS/130.0 Mobile Safari/604.1'

    assert.equal(area(safari), 16_000_000)
    assert.equal(area(iphoneChrome), 16_000_000) // every browser on iOS is WebKit
    assert.ok(area(android) < area(chrome))
    assert.ok(area(android) > area(safari))
    assert.equal(area(''), area(chrome))
})

test('the poster reaches the 6000 px of maximum on a desktop browser', () => {
    // 6000 x 10500 is 63 megapixels, within the 120 allowed
    const plan = planExport({ width: 480, height: 840, quality: 'maximum', limits: desktop })
    assert.equal(plan.reduced, false)
    assert.equal(plan.pixelWidth, 6000)
})
