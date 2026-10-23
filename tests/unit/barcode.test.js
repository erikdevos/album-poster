import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkDigit, normalizeBarcode, ean13Modules, L_CODES, G_CODES, R_CODES } from '../../scripting/barcode.js'

test('the check digit follows the EAN-13 rule', () => {
    assert.equal(checkDigit('400638133393'), 1) // 4006381333931
    assert.equal(checkDigit('590123412345'), 7) // 5901234123457
    assert.equal(checkDigit('036000291452'), 2) // the UPC-A 036000291452
})

test('a UPC-A gets a zero in front, and anything else that is not valid is refused', () => {
    assert.equal(normalizeBarcode('036000291452'), '0036000291452')
    assert.equal(normalizeBarcode('4006381333931'), '4006381333931')
    assert.equal(normalizeBarcode('4006 3813 33931'), '4006381333931')
    assert.equal(normalizeBarcode('4006381333932'), null) // wrong check digit
    assert.equal(normalizeBarcode('12345'), null)
    assert.equal(normalizeBarcode(''), null)
    assert.equal(normalizeBarcode(undefined), null)
})

// Reads the modules back, the way a scanner does, to see that they say the same digits
function decode(modules) {
    assert.equal(modules.length, 95)
    assert.equal(modules.slice(0, 3), '101')
    assert.equal(modules.slice(45, 50), '01010')
    assert.equal(modules.slice(92), '101')
    const left = [...Array(6)].map((_, index) => modules.slice(3 + 7 * index, 10 + 7 * index))
    const right = [...Array(6)].map((_, index) => modules.slice(50 + 7 * index, 57 + 7 * index))
    const parity = left.map(code => L_CODES.includes(code) ? 'L' : 'G')
    const digits = left.map((code, index) => (parity[index] === 'L' ? L_CODES : G_CODES).indexOf(code))
    return { parity: parity.join(''), left: digits.join(''), right: right.map(code => R_CODES.indexOf(code)).join('') }
}

test('the modules of an EAN-13 decode to the same digits', () => {
    for (const code of ['4006381333931', '5901234123457', '0036000291452', '9780201379624']) {
        const { left, right, parity } = decode(ean13Modules(code))
        assert.equal(left + right, code.slice(1), code)
        // the parity pattern of the left half encodes the first digit
        assert.equal(parity.length, 6)
        assert.equal(parity[0], 'L')
    }
    assert.equal(ean13Modules('1234'), null)
})

test('the parity of the left half is different for different first digits', () => {
    assert.equal(decode(ean13Modules('5901234123457')).parity, 'LGGLLG') // first digit 5
    assert.equal(decode(ean13Modules('4006381333931')).parity, 'LGLLGG') // first digit 4
    assert.equal(decode(ean13Modules('0036000291452')).parity, 'LLLLLL') // first digit 0
})
