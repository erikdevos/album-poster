// Keeping albums in the browser and working offline, with the real service worker. The site is served
// from this folder; MusicBrainz and the Cover Art Archive are replaced by fixtures (also for the
// requests that the service worker makes itself, which Playwright only routes with a switch, below).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

// Playwright reads the switch when it is loaded, so it is set before that, not in an import
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1'
const { chromium } = await import('playwright-core')

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const LUX = 'bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0' // has prepared details in data/details
const ABBEY = '11111111-aaaa-4bbb-8ccc-dddddddddddd' // an album that is not in the curated list
const CORS = { 'access-control-allow-origin': '*' }
const COVER = '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="250"><rect width="250" height="250" fill="#2a3b5c"/></svg>'

let server, base, browser
const requests = { musicbrainz: [], covers: [] }
const served = []

before(async () => {
    server = createServer(async (request, response) => {
        let path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname))
        served.push(path)
        if (path.endsWith('/')) path += 'index.html'
        try {
            const file = await readFile(join(ROOT, path))
            response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
            response.end(file)
        } catch {
            response.writeHead(404).end()
        }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${server.address().port}/`
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' })
})

after(async () => {
    await browser?.close()
    server?.close()
})

async function mockNetwork(context) {
    await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, route => {
        const url = new URL(route.request().url())
        const path = decodeURIComponent(url.pathname)
        if (url.hostname === 'musicbrainz.org') {
            requests.musicbrainz.push(path + url.search)
            if (path.endsWith('/release-group')) {
                return route.fulfill({
                    status: 200, contentType: 'application/json', headers: CORS,
                    body: JSON.stringify({ 'release-groups': [{ id: ABBEY, title: 'Abbey Road', score: 100, count: 73, 'first-release-date': '1969-09-26', 'artist-credit': [{ name: 'The Beatles' }] }] })
                })
            }
            const match = path.match(/\/release\/r-([^/]+)$/)
            if (match) {
                return route.fulfill({
                    status: 200, contentType: 'application/json', headers: CORS,
                    body: JSON.stringify({
                        title: 'Abbey Road', date: '1969-09-26', barcode: '5901234123457',
                        'artist-credit': [{ name: 'The Beatles' }],
                        'release-group': { title: 'Abbey Road', 'first-release-date': '1969-09-26', genres: [] },
                        media: [{ tracks: [{ number: '1', title: 'Come Together' }] }]
                    })
                })
            }
        }
        if (url.hostname === 'coverartarchive.org') {
            requests.covers.push(path)
            const match = path.match(/\/release-group\/([^/]+)$/)
            if (match) {
                return route.fulfill({
                    status: 200, contentType: 'application/json', headers: CORS,
                    body: JSON.stringify({ release: `https://musicbrainz.org/release/r-${match[1]}`, images: [{ types: ['Front'], image: `https://images.test/front-${match[1]}.svg`, thumbnails: { 1200: `https://images.test/front-${match[1]}.svg` } }] })
                })
            }
            return route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: CORS, body: COVER })
        }
        if (url.hostname === 'images.test') return route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: CORS, body: COVER })
        return route.abort()
    })
}

// A page whose service worker is installed and in charge (the very first load is not controlled)
async function open(path, context) {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('requestfailed', r => { if (process.env.DEBUG_PAGE) console.log('FAILED', r.url(), r.failure()?.errorText) })
    page.on('response', r => { if (process.env.DEBUG_PAGE) console.log('RESP', r.status(), r.url().slice(0, 140)) })
    page.on('console', message => { if (process.env.DEBUG_PAGE) console.log('PAGE', message.type(), message.text()) })
    await page.goto(base + path)
    await page.evaluate(() => navigator.serviceWorker.ready)
    if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
        await page.reload()
        await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    }
    return { page, errors }
}

const newContext = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
    await mockNetwork(context)
    return context
}
const cacheKeys = (page, name) => page.evaluate(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname), name)
const idbIds = page => page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('album-poster', 1)
    open.onsuccess = () => {
        const request = open.result.transaction('albums').objectStore('albums').getAllKeys()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    }
    open.onerror = () => reject(open.error)
}))

test('the service worker keeps the app ready, so that the pages open without a network', async () => {
    const context = await newContext()
    try {
        const { page } = await open(`#${LUX}`, context)
        await page.locator('#album-name').getByText('LUX').waitFor()
        await page.waitForFunction(async () => (await (await caches.open('shell-v1')).keys()).length > 20)
        const shell = await cacheKeys(page, 'shell-v1')
        for (const path of ['/scripting/main.js', '/styles/style.css', '/scripting/vendor/html-to-image.js', '/wall/', '/data/albums.json']) {
            assert.ok(shell.includes(path), `${path} is not kept`)
        }

        await context.setOffline(true)
        await page.goto(`${base}?layout=gallery#${LUX}`) // another query string: the copy of the page does for it
        await page.locator('#album-name').getByText('LUX').waitFor()
        assert.equal(await page.locator('#album-container').getAttribute('data-layout'), 'gallery')
        await page.goto(`${base}wall/`)
        await page.locator('.wall-tile').first().waitFor()
        assert.ok(await page.locator('.wall-tile').count() > 100)
    } finally { await context.close() }
})

test('an album with prepared details is shown without asking MusicBrainz, and is then kept in the browser', async () => {
    const context = await newContext()
    try {
        requests.musicbrainz.length = 0
        const { page } = await open(`#${LUX}`, context)
        await page.locator('#album-name').getByText('LUX').waitFor()
        assert.equal(await page.locator('#album-artist').textContent(), 'ROSALÍA') // from data/details, not from the fake
        assert.deepEqual(requests.musicbrainz, [])
        await page.waitForFunction(() => new Promise(resolve => {
            const open = indexedDB.open('album-poster', 1)
            open.onsuccess = () => { const r = open.result.transaction('albums').objectStore('albums').count(); r.onsuccess = () => resolve(r.result > 0) }
        }))
        assert.deepEqual(await idbIds(page), [LUX])
    } finally { await context.close() }
})

test('an album that was opened once comes from the browser the second time, also without a network', async () => {
    const context = await newContext()
    try {
        requests.musicbrainz.length = 0
        const { page } = await open(`#${ABBEY}`, context) // not in the list: it has to come from MusicBrainz first
        await page.locator('#album-name').getByText('Abbey Road').waitFor()
        assert.ok(requests.musicbrainz.length > 0)
        await page.waitForFunction(async () => (await new Promise(resolve => {
            const open = indexedDB.open('album-poster', 1)
            open.onsuccess = () => { const r = open.result.transaction('albums').objectStore('albums').getAllKeys(); r.onsuccess = () => resolve(r.result) }
        })).length > 0)

        requests.musicbrainz.length = 0
        await context.setOffline(true)
        await page.reload()
        await page.locator('#album-name').getByText('Abbey Road').waitFor()
        assert.equal(await page.locator('#track-list li').count(), 1)
        assert.deepEqual(requests.musicbrainz, [])
        assert.equal(await page.locator('#toast').isHidden(), true)
    } finally { await context.close() }
})

test('searching offline finds the curated list and the albums that were opened', async () => {
    const context = await newContext()
    try {
        const { page } = await open(`#${ABBEY}`, context)
        await page.locator('#album-name').getByText('Abbey Road').waitFor()
        await page.waitForFunction(async () => (await new Promise(resolve => {
            const open = indexedDB.open('album-poster', 1)
            open.onsuccess = () => { const r = open.result.transaction('albums').objectStore('albums').getAllKeys(); r.onsuccess = () => resolve(r.result) }
        })).length > 0)

        await context.setOffline(true)
        await page.reload()
        await page.locator('#album-name').getByText('Abbey Road').waitFor()
        const box = page.getByRole('combobox', { name: 'Search albums' })
        await box.fill('rosalia')
        await page.getByRole('option', { name: /LUX/ }).waitFor()
        await box.fill('abbey')
        await page.getByRole('option', { name: /Abbey Road – The Beatles/ }).first().waitFor()
    } finally { await context.close() }
})

test('the covers that are shown are kept by the service worker, as small ones and as poster covers', async () => {
    const context = await newContext()
    try {
        const { page } = await open('wall/', context)
        await page.locator('.wall-tile img').first().waitFor()
        await page.waitForFunction(async () => (await (await caches.open('thumbs-v1')).keys()).length > 0)
        const thumbs = await cacheKeys(page, 'thumbs-v1')
        assert.ok(thumbs.every(path => path.endsWith('/front-250')), thumbs.join())

        // after a reload the covers that were kept do not go to the network again
        const kept = await cacheKeys(page, 'thumbs-v1')
        requests.covers.length = 0
        await page.reload()
        await page.locator('.wall-tile img').first().waitFor()
        await page.waitForFunction(() => [...document.querySelectorAll('.wall-tile img')].some(img => img.complete && img.naturalWidth > 0))
        assert.deepEqual(requests.covers.filter(path => kept.includes(path)), [])
    } finally { await context.close() }
})

test('the offline panel on the wall downloads albums and covers, tells what is kept, and clears it', async () => {
    const context = await newContext()
    try {
        const { page } = await open('wall/', context)
        await page.locator('.wall-tile').first().waitFor()
        await page.getByRole('button', { name: 'Offline use' }).click()
        await page.waitForFunction(() => /^\d+ of \d+ albums are kept/.test(document.getElementById('offline-status').textContent))
        assert.equal(await page.getByRole('button', { name: 'Download all albums' }).isVisible(), true)

        // downloads two albums of the list, the way the button does for all of them
        const state = await page.evaluate(async id => {
            const { downloadForOffline } = await import('/scripting/offline.js')
            return downloadForOffline([{ id }, { id: '02a544b3-0459-42c7-bd9c-047162e7b67a' }], { concurrency: 1 })
        }, LUX)
        assert.deepEqual(state, { done: 2, total: 2, failed: 0 })
        assert.ok((await idbIds(page)).includes(LUX))
        assert.ok((await cacheKeys(page, 'thumbs-v1')).some(path => path.includes(LUX)))

        await page.getByRole('button', { name: 'Clear offline data' }).click()
        await page.waitForFunction(() => /^0 of \d+ albums/.test(document.getElementById('offline-status').textContent))
        assert.deepEqual(await idbIds(page), [])
        assert.deepEqual(await cacheKeys(page, 'thumbs-v1'), [])
        assert.ok((await cacheKeys(page, 'shell-v1')).length > 20, 'the app itself stays')
    } finally { await context.close() }
})

test('exporting does not need a CDN: the library comes from this site', async () => {
    const context = await newContext()
    try {
        const { page } = await open(`#${ABBEY}`, context)
        await page.locator('#album-name').getByText('Abbey Road').waitFor()
        await page.waitForFunction(() => document.getElementById('album-cover').naturalWidth > 0)
        const outside = []
        page.on('request', request => { if (!request.url().startsWith(base)) outside.push(new URL(request.url()).hostname) })
        const bytes = await page.evaluate(async () => {
            const { renderPoster } = await import('/scripting/exportPoster.js')
            const { blob } = await renderPoster({ format: 'png', quality: 'standard' })
            return blob.size
        })
        assert.ok(bytes > 10_000)
        assert.ok(!outside.includes('cdn.jsdelivr.net'), 'the library is not fetched from a CDN')
    } finally { await context.close() }
})
