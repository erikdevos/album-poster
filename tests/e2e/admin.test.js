// The local admin page, in a real browser, against the admin server with a copy of the list in a
// temporary folder (the real data/albums.json is never touched). MusicBrainz and the Cover Art
// Archive are replaced by fixtures.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createAdminServer } from '../../scripts/admin.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const LUX = 'bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0'
const BILLIE = '02a544b3-0459-42c7-bd9c-047162e7b67a'
const ABBEY = 'f5093c06-23e3-404f-aeaa-40f72885ee3a'
const NO_COVER = '99999999-aaaa-4bbb-8ccc-dddddddddddd'

const CORS = { 'access-control-allow-origin': '*' }
const COVER = '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="250"><rect width="250" height="250" fill="#2a3b5c"/></svg>'
const found = [
    { id: ABBEY, title: 'Abbey Road', artist: 'The Beatles', date: '1969-09-26' },
    { id: NO_COVER, title: 'Abbey Road Demos', artist: 'The Beatles', date: '1970' }
]

let admin, base, folder, albumsPath, browser

const reset = () => writeFile(albumsPath, JSON.stringify([
    { id: BILLIE, audiodbId: '2429476', name: 'Hit Me Hard and Soft', artist: 'Billie Eilish' },
    { id: LUX, name: 'LUX', artist: 'Rosalia' }
], null, 2) + '\n')

before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'album-admin-e2e-'))
    albumsPath = join(folder, 'albums.json')
    await reset()
    admin = createAdminServer({ root: ROOT, albumsPath })
    base = `http://127.0.0.1:${await admin.listen(0)}`
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' })
})

after(async () => {
    await browser?.close()
    await admin?.close()
    await rm(folder, { recursive: true, force: true })
})

async function open() {
    await reset()
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } })
    await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, route => {
        const url = new URL(route.request().url())
        if (url.hostname === 'musicbrainz.org' && url.pathname.endsWith('/release-group')) {
            return route.fulfill({
                status: 200, contentType: 'application/json', headers: CORS,
                body: JSON.stringify({
                    'release-groups': found.map(album => ({
                        id: album.id, title: album.title, score: 100, count: 20, 'first-release-date': album.date,
                        'artist-credit': [{ name: album.artist }]
                    }))
                })
            })
        }
        if (url.hostname === 'coverartarchive.org' && url.pathname.endsWith('/front-250')) {
            return url.pathname.includes(NO_COVER)
                ? route.fulfill({ status: 404, headers: CORS, body: '' })
                : route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: CORS, body: COVER })
        }
        return route.abort()
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${base}/admin/`)
    await page.locator('#list-rows .admin-row').first().waitFor()
    return { page, errors, close: () => context.close() }
}

const saved = async () => JSON.parse(await readFile(albumsPath, 'utf8'))

test('the page shows the list, newest first, with a count and nothing to save', async () => {
    const { page, errors, close } = await open()
    try {
        assert.equal(await page.locator('#list-rows .admin-row').count(), 2)
        assert.equal((await page.locator('#list-rows .admin-row strong').first().textContent()), 'LUX') // the last of the file is the newest
        assert.equal((await page.locator('#list-count').textContent()).trim(), '(2)')
        assert.equal(await page.locator('#admin-save').isDisabled(), true)
        assert.equal((await page.locator('#admin-status').textContent()).trim(), 'Everything is saved')
        assert.deepEqual(errors, [])
    } finally { await close() }
})

test('searching shows the covers, warns about a missing cover, and an album is added at the end after Save', async () => {
    const { page, close } = await open()
    try {
        await page.getByRole('searchbox', { name: /Search MusicBrainz/ }).fill('abbey road')
        await page.getByRole('button', { name: 'Search', exact: true }).click()
        await page.locator('#add-results .admin-row').first().waitFor()
        assert.equal(await page.locator('#add-results .admin-row').count(), 2)
        await page.locator('#add-results .admin-badge.is-warning').waitFor()
        assert.equal(await page.locator('#add-results .admin-badge.is-warning').count(), 1) // the one without a cover

        await page.getByRole('button', { name: 'Add Abbey Road', exact: true }).click()
        assert.equal(await page.getByRole('button', { name: 'Abbey Road is in the list' }).isDisabled(), true)
        assert.match(await page.locator('#admin-status').textContent(), /Not saved: 1 added/)
        assert.equal(await page.locator('#list-rows .admin-row[data-state="new"]').count(), 1)
        assert.equal((await saved()).length, 2, 'nothing is written before Save')

        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await page.waitForFunction(() => document.getElementById('admin-status').textContent.startsWith('Saved 3 albums'))
        const list = await saved()
        assert.deepEqual(list.map(album => album.name), ['Hit Me Hard and Soft', 'LUX', 'Abbey Road'])
        assert.equal(list[2].artist, 'The Beatles')
        assert.equal(list[0].audiodbId, '2429476', 'the other albums are left as they were')
    } finally { await close() }
})

test('a MusicBrainz link is understood', async () => {
    const { page, close } = await open()
    try {
        await page.getByRole('searchbox', { name: /Search MusicBrainz/ }).fill(`https://musicbrainz.org/release-group/${ABBEY}`)
        await page.getByRole('button', { name: 'Search', exact: true }).click()
        // the album is looked up by id; the fake MusicBrainz has no release for it, so it says so
        await page.waitForFunction(() => document.getElementById('add-message').textContent.includes('failed'))
    } finally { await close() }
})

test('removing an album can be undone, and Save writes the removal', async () => {
    const { page, close } = await open()
    try {
        await page.getByRole('button', { name: 'Remove LUX' }).click()
        assert.equal(await page.locator('#list-rows .admin-row').count(), 1)
        assert.match(await page.locator('#admin-status').textContent(), /1 removed/)
        await page.getByRole('button', { name: 'Put LUX back' }).click()
        assert.equal(await page.locator('#list-rows .admin-row').count(), 2)
        assert.equal(await page.locator('#admin-save').isDisabled(), true)

        await page.getByRole('button', { name: 'Remove Hit Me Hard and Soft' }).click()
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await page.waitForFunction(() => document.getElementById('admin-status').textContent.startsWith('Saved 1 albums'))
        assert.deepEqual((await saved()).map(album => album.name), ['LUX'])
    } finally { await close() }
})

test('a name and artist can be edited, and Revert goes back to the file', async () => {
    const { page, close } = await open()
    try {
        await page.getByRole('button', { name: 'Edit LUX' }).click()
        await page.getByLabel('Artist').fill('Rosalía')
        await page.getByRole('button', { name: 'Done' }).click()
        assert.match(await page.locator('#admin-status').textContent(), /1 renamed/)
        assert.equal(await page.locator('#list-rows .admin-row[data-state="edited"]').count(), 1)

        await page.getByRole('button', { name: 'Revert' }).click()
        await page.waitForFunction(() => document.getElementById('admin-status').textContent === 'Everything is saved')

        await page.getByRole('button', { name: 'Edit LUX' }).click()
        await page.getByLabel('Artist').fill('Rosalía')
        await page.getByRole('button', { name: 'Done' }).click()
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await page.waitForFunction(() => document.getElementById('admin-status').textContent.startsWith('Saved 2 albums'))
        assert.equal((await saved()).find(album => album.id === LUX).artist, 'Rosalía')
    } finally { await close() }
})

test('the list can be filtered', async () => {
    const { page, close } = await open()
    try {
        await page.getByRole('searchbox', { name: 'Filter the list' }).fill('billie')
        assert.equal(await page.locator('#list-rows .admin-row').count(), 1)
        await page.getByRole('searchbox', { name: 'Filter the list' }).fill('')
        assert.equal(await page.locator('#list-rows .admin-row').count(), 2)
    } finally { await close() }
})
