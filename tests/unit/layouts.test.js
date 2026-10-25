import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { LAYOUTS, LAYOUT_LABELS, DEFAULT_LAYOUT } from '../../scripting/layouts.js'

test('every layout has a label, and the default is one of them', () => {
    assert.ok(LAYOUTS.includes(DEFAULT_LAYOUT))
    for (const layout of LAYOUTS) assert.ok(LAYOUT_LABELS[layout], layout)
})

test('the layout select of the poster page has the same layouts, in the same order, as the list', async () => {
    const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8')
    const select = html.match(/<select id="layout-select"[\s\S]*?<\/select>/)[0]
    const options = [...select.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(match => [match[1], match[2]])
    assert.deepEqual(options, Object.entries(LAYOUT_LABELS))
})
