import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    PAPERS, DPI_CHOICES, DEFAULT_PRINT, BLEED_MM, MARK_LENGTH_MM, MARK_MIN_OFFSET_MM,
    cleanPrintSettings, planPrint, describePrint, printStyle
} from '../../scripting/printPlan.js'
import { canvasLimits } from '../../scripting/exportPlan.js'

const desktop = canvasLimits('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130.0 Safari/537.36')
const near = (actual, expected, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`)
const poster = { width: 400, height: 740 } // as on screen: about 1.85 times as high as wide

test('the settings are cleaned: unknown values fall back to the defaults', () => {
    assert.deepEqual(cleanPrintSettings(), DEFAULT_PRINT)
    assert.deepEqual(cleanPrintSettings({ paper: 'a3', orientation: 'landscape', margin: '5', dpi: '600', bleed: true, marks: true }),
        { paper: 'a3', orientation: 'landscape', margin: 5, dpi: 600, bleed: true, marks: true })
    assert.deepEqual(cleanPrintSettings({ paper: 'nope', orientation: 'sideways', margin: 7, dpi: 99, bleed: 'yes' }), DEFAULT_PRINT)
})

test('every paper size is in millimetres, portrait, and A-sizes are half the next one up', () => {
    for (const paper of PAPERS) assert.ok(paper.height > paper.width, paper.id)
    const size = id => PAPERS.find(paper => paper.id === id)
    near(size('a3').width, size('a4').height, 0.5)
    near(size('a2').width, size('a3').height, 0.5)
})

test('the orientation follows the shape of the poster when it is automatic', () => {
    assert.equal(planPrint({ settings: { paper: 'a4' }, ...poster }).orientation, 'portrait')
    assert.equal(planPrint({ settings: { paper: 'a4' }, width: 800, height: 400 }).orientation, 'landscape')
    assert.equal(planPrint({ settings: { paper: 'a4', orientation: 'landscape' }, ...poster }).orientation, 'landscape')
    const landscape = planPrint({ settings: { paper: 'a4', orientation: 'landscape' }, ...poster })
    assert.deepEqual(landscape.trim, { width: 297, height: 210 })
})

test('the picture fits inside the margin, in the middle of the page, with the shape of the poster', () => {
    const plan = planPrint({ settings: { paper: 'a4', margin: 10 }, ...poster })
    assert.deepEqual(plan.trim, { width: 210, height: 297 })
    assert.ok(plan.image.width <= 190 + 1e-9 && plan.image.height <= 277 + 1e-9)
    near(plan.image.width / plan.image.height, poster.width / poster.height, 1e-9)
    near(plan.image.x, (210 - plan.image.width) / 2)
    near(plan.image.y, (297 - plan.image.height) / 2)
    // this poster is tall, so the height is what limits it
    near(plan.image.height, 277)
})

test('without a margin the picture goes to the edge of the paper', () => {
    const plan = planPrint({ settings: { paper: 'a4', margin: 0 }, width: 400, height: 565 })
    assert.ok(plan.image.width <= 210 + 1e-9 && plan.image.height <= 297 + 1e-9)
    assert.ok(Math.abs(plan.image.width - 210) < 0.5 || Math.abs(plan.image.height - 297) < 0.5)
})

test('the pixels follow from the dpi: the picture in inches times the dpi', () => {
    const plan = planPrint({ settings: { paper: 'a4', margin: 0, dpi: 300 }, width: 210, height: 297 })
    assert.equal(plan.pixelWidth, 2480) // 210 mm is 8.27 inch, times 300
    assert.equal(plan.pixelHeight, 3508)
    assert.equal(plan.effectiveDpi, 300)
    assert.equal(plan.reduced, false)
    assert.equal(planPrint({ settings: { paper: 'a4', margin: 0, dpi: 150 }, width: 210, height: 297 }).pixelWidth, 1240)
    assert.equal(planPrint({ settings: { paper: 'a4', margin: 0, dpi: 600 }, width: 210, height: 297 }).pixelWidth, 4961)
})

test('a size that the browser cannot draw is brought down, and the dpi that is reached is reported', () => {
    const iphone = canvasLimits('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Mobile Safari/604.1')
    const plan = planPrint({ settings: { paper: 'a1', margin: 0, dpi: 600 }, width: 594, height: 841, limits: iphone })
    assert.equal(plan.reduced, true)
    assert.ok(plan.effectiveDpi < 600)
    assert.ok(plan.pixelWidth * plan.pixelHeight <= 16_100_000) // the limit, give or take the rounding of the sides
    assert.match(describePrint(plan), /too much for this browser/)
    // the same size on a desktop is fine at 300 dpi
    const big = planPrint({ settings: { paper: 'a2', margin: 0, dpi: 300 }, width: 420, height: 594, limits: desktop })
    assert.equal(big.reduced, false)
})

test('bleed makes the page 3 mm larger on every side, and the picture stays in the trim', () => {
    const plain = planPrint({ settings: { paper: 'a4', margin: 10 }, ...poster })
    const bleed = planPrint({ settings: { paper: 'a4', margin: 10, bleed: true }, ...poster })
    assert.equal(bleed.bleed, BLEED_MM)
    assert.deepEqual(bleed.media, { width: 210 + 2 * BLEED_MM, height: 297 + 2 * BLEED_MM })
    assert.deepEqual(bleed.trim, plain.trim)
    near(bleed.image.x, plain.image.x + BLEED_MM)
    near(bleed.image.width, plain.image.width)
})

test('crop marks need room around the trim: further out than the bleed, and as long as a mark', () => {
    const marks = planPrint({ settings: { paper: 'a4', marks: true }, ...poster })
    assert.equal(marks.slug, MARK_MIN_OFFSET_MM + MARK_LENGTH_MM)
    assert.deepEqual(marks.media, { width: 210 + 2 * marks.slug, height: 297 + 2 * marks.slug })

    const both = planPrint({ settings: { paper: 'a4', marks: true, bleed: true }, ...poster })
    assert.ok(both.markOffset >= both.bleed, 'the marks do not run into the bleed')
    assert.ok(both.slug >= both.bleed + MARK_LENGTH_MM || both.slug === both.markOffset + MARK_LENGTH_MM)

    const nothing = planPrint({ settings: { paper: 'a4' }, ...poster })
    assert.equal(nothing.slug, 0)
    assert.deepEqual(nothing.media, nothing.trim)
})

test('the summary tells the paper, the size, the dpi and the extras', () => {
    const plan = planPrint({ settings: { paper: 'a3', dpi: 300, bleed: true, marks: true }, ...poster, limits: desktop })
    const text = describePrint(plan)
    assert.match(text, /^A3 portrait/)
    assert.match(text, /at 300 dpi/)
    assert.match(text, /3 mm bleed, crop marks$/)
    assert.match(text, /\d+ × \d+ px/)
    assert.doesNotMatch(describePrint(planPrint({ settings: { paper: 'a4' }, ...poster })), /bleed|crop/)
})

test('the print dialog gets the same paper, margin and poster width', () => {
    const plan = planPrint({ settings: { paper: 'a3', margin: 5, orientation: 'portrait' }, ...poster })
    const css = printStyle(plan)
    assert.match(css, /@page \{ size: 297mm 420mm; margin: 5mm; \}/)
    assert.match(css, new RegExp(`#album-container \\{ width: ${plan.image.width.toFixed(2)}mm !important; \\}`))
})

test('the choices of dpi are 150, 300 and 600', () => {
    assert.deepEqual(DPI_CHOICES, [150, 300, 600])
})
