// Smoke test in a real browser. The site is served from this folder, and MusicBrainz and the
// Cover Art Archive are replaced by fixtures, so the test is fast and does not depend on them.
// Uses the Chrome that is installed (set CHROME_PATH for another one). Needs no browser download.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const ABBEY = 'f5093c06-23e3-404f-aeaa-40f72885ee3a'
const LUX = 'bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0'
const RATED_R = '06fda337-5c4b-42e0-a96c-a349c786965f' // the curated id of audiodbId 2110671

const CORS = { 'access-control-allow-origin': '*' }
const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) })

const COVER = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
  <rect width="600" height="600" fill="#2a3b5c"/><circle cx="300" cy="300" r="180" fill="#e8b04a"/></svg>`

function release(title, artist) {
    return {
        title,
        date: '1969-09-26',
        'artist-credit': [{ name: artist }],
        'label-info': [{ label: { name: 'Apple' } }],
        'release-group': { title, 'first-release-date': '1969-09-26', genres: [{ name: 'rock', count: 3 }] },
        media: [{ tracks: ['Come Together', 'Something', 'Octopus\'s Garden'].map((name, i) => ({ number: String(i + 1), title: name })) }]
    }
}

// What the fake MusicBrainz knows: three named albums; any other id gets an album named after the id
const albums = new Map([[ABBEY, ['Abbey Road', 'The Beatles']], [LUX, ['LUX', 'ROSALÍA']], [RATED_R, ['Rated R', 'Rihanna']]])
const albumFor = id => albums.get(id) ?? [`Album ${id.slice(0, 8)}`, 'Some Band']
const RANDOM_ID = '11111111-2222-4333-8444-555555555555'
const searches = []

async function mockNetwork(context) {
    await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, async route => {
        const url = new URL(route.request().url())
        const path = decodeURIComponent(url.pathname)

        if (url.hostname === 'musicbrainz.org') {
            if (path.endsWith('/release-group') && url.searchParams.has('query')) {
                searches.push(url.searchParams.get('query'))
                // the slideshow's random source searches by genre
                if (url.searchParams.get('query').startsWith('tag:')) {
                    return json(route, { 'release-groups': [{ id: RANDOM_ID }] })
                }
                return json(route, {
                    'release-groups': [{
                        id: ABBEY, title: 'Abbey Road', score: 97, count: 73, 'first-release-date': '1969-09-26',
                        'artist-credit': [{ name: 'The Beatles' }]
                    }]
                })
            }
            const match = path.match(/\/release\/([^/]+)$/)
            if (match) {
                const [title, artist] = albumFor(match[1].replace(/^r-/, ''))
                return json(route, release(title, artist))
            }
        }

        if (url.hostname === 'coverartarchive.org') {
            const match = path.match(/\/release-group\/([^/]+)$/)
            if (match) {
                return json(route, {
                    release: `https://musicbrainz.org/release/r-${match[1]}`,
                    images: [{ types: ['Front'], image: 'https://images.test/front.svg', thumbnails: { 1200: 'https://images.test/front.svg' } }]
                })
            }
            return json(route, {}, 404)
        }

        if (url.hostname === 'images.test') {
            return route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: CORS, body: COVER })
        }

        // fonts, the export library: let it through, or fail quietly when offline
        if (url.hostname === 'cdn.jsdelivr.net') return route.continue()
        return route.abort()
    })
}

let server, base, browser

before(async () => {
    server = createServer(async (request, response) => {
        let path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname))
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

    browser = await chromium.launch({
        ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' })
    })
})

after(async () => {
    await browser?.close()
    server?.close()
})

// A fresh page for each test, with the fake network and the errors of the page collected
async function open(path, { viewport = { width: 1280, height: 900 }, acceptDownloads = false } = {}) {
    const context = await browser.newContext({ viewport, acceptDownloads, colorScheme: 'dark' })
    await mockNetwork(context)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base + path)
    return { page, errors, close: () => context.close() }
}

const poster = page => ({
    title: page.locator('#album-name'),
    artist: page.locator('#album-artist'),
    tracks: page.locator('#track-list li')
})

test('shows the album from the hash', async () => {
    const { page, errors, close } = await open(`#${LUX}`)
    try {
        const p = poster(page)
        await p.title.getByText('LUX').waitFor()
        assert.equal(await p.artist.textContent(), 'ROSALÍA')
        assert.equal(await p.tracks.count(), 3)
        assert.equal(await page.title(), 'LUX – ROSALÍA')
        assert.match(await page.locator('.album-footer-info').innerText(), /Apple\s+1969\s+rock/i)
        await page.waitForFunction(() => document.getElementById('album-cover').naturalWidth > 0)
        // the palette is read from the cover, which is possible because the image has CORS headers
        await page.waitForFunction(() => document.querySelectorAll('.album-color').length > 0)
        assert.deepEqual(errors, [])
    } finally { await close() }
})

test('searching and picking a result opens that album and updates the URL', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.getByRole('combobox', { name: 'Search albums' }).fill('abbey')
        const option = page.getByRole('option', { name: /Abbey Road – The Beatles \(1969\)/ })
        await option.waitFor()
        await option.click()

        await poster(page).title.getByText('Abbey Road').waitFor()
        assert.equal(new URL(page.url()).hash, `#${ABBEY}`)
        assert.equal(await page.getByRole('combobox', { name: 'Search albums' }).inputValue(), '')
    } finally { await close() }
})

test('the search box works with the keyboard', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const box = page.getByRole('combobox', { name: 'Search albums' })
        await box.fill('abbey')
        await page.getByRole('option').first().waitFor()
        await box.press('ArrowDown')
        assert.equal(await page.getByRole('option').first().getAttribute('aria-selected'), 'true')
        await box.press('Enter')
        await poster(page).title.getByText('Abbey Road').waitFor()
    } finally { await close() }
})

test('an old numeric link is redirected to the MusicBrainz id', async () => {
    const { page, close } = await open('#2110671')
    try {
        await poster(page).title.getByText('Rated R').waitFor()
        assert.equal(new URL(page.url()).hash, `#${RATED_R}`)
    } finally { await close() }
})

test('a bad id shows a message, and the poster recovers with a good one', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()

        await page.evaluate(() => { location.hash = 'nonsense' })
        await page.getByText('This is not a valid album id.').waitFor()

        await page.evaluate(id => { location.hash = id }, ABBEY)
        await poster(page).title.getByText('Abbey Road').waitFor()
        assert.equal(await page.locator('#status').isHidden(), true)
    } finally { await close() }
})

test('the layout menu changes the poster and the URL', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const layout = () => page.locator('#album-container').getAttribute('data-layout')
        assert.equal(await layout(), 'classic')

        await page.getByLabel('Poster layout').selectOption('swiss')
        assert.equal(await layout(), 'swiss')
        assert.match(page.url(), /layout=swiss/)
        assert.equal(new URL(page.url()).hash, `#${LUX}`)

        await page.getByLabel('Poster layout').selectOption('classic')
        assert.doesNotMatch(page.url(), /layout=/)
    } finally { await close() }
})

test('options in the URL are applied', async () => {
    const { page, close } = await open(`?layout=minimal&theme=light&controls=false#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        assert.equal(await page.locator('#album-container').getAttribute('data-layout'), 'minimal')
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light')
        assert.equal(await page.locator('.site-header').isHidden(), true)
        assert.equal(await page.locator('#export-toggle').isHidden(), true)
    } finally { await close() }
})

test('the light/dark switch follows the system, can be flipped, and is remembered', async () => {
    const { page, close } = await open(`#${LUX}`) // the test browser prefers dark
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const toggle = page.getByRole('button', { name: 'Dark mode' })
        const pageBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
        const explicitTheme = () => page.locator('html').getAttribute('data-theme')

        assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
        assert.equal(await pageBackground(), 'rgb(0, 0, 0)')
        assert.equal(await explicitTheme(), null)

        await toggle.click()
        assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
        assert.equal(await explicitTheme(), 'light')
        assert.equal(await pageBackground(), 'rgb(239, 239, 230)')

        await page.reload()
        await poster(page).title.getByText('LUX').waitFor()
        assert.equal(await explicitTheme(), 'light')
        assert.equal(await toggle.getAttribute('aria-pressed'), 'false')

        await toggle.click()
        assert.equal(await explicitTheme(), 'dark')
        assert.equal(await pageBackground(), 'rgb(0, 0, 0)')
    } finally { await close() }
})

test('a theme in the URL wins over the saved choice, and the switch keeps the URL in step', async () => {
    const { page, close } = await open(`?theme=light#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const toggle = page.getByRole('button', { name: 'Dark mode' })
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light')

        await toggle.click()
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
        assert.match(page.url(), /theme=dark/)

        // the page can be loaded in the other theme before anything is painted: no flash
        await page.evaluate(() => localStorage.setItem('album-poster.theme', 'light'))
        await page.goto(`${base}?theme=dark#${LUX}`)
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
    } finally { await close() }
})

test('there are no buttons under the poster, and the export options sit in a panel', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()

        // nothing to click between the poster and the footer
        const underThePoster = await page.evaluate(() =>
            [...document.querySelectorAll('main button, main select, main input')]
                .filter(el => el.getBoundingClientRect().top > document.getElementById('album-container').getBoundingClientRect().bottom).length)
        assert.equal(underThePoster, 0)

        const toggle = page.getByRole('button', { name: 'Export' })
        const panel = page.locator('#export-panel')
        assert.equal(await panel.isHidden(), true)
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false')

        await toggle.click()
        assert.equal(await panel.isVisible(), true)
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
        for (const name of ['Download', 'Print', 'Copy link']) {
            assert.equal(await panel.getByRole('button', { name }).isVisible(), true, name)
        }

        await page.keyboard.press('Escape')
        assert.equal(await panel.isHidden(), true)
        assert.equal(await page.evaluate(() => document.activeElement.id), 'export-toggle')

        await toggle.click()
        await page.locator('#album-container').click({ position: { x: 5, y: 5 } })
        assert.equal(await panel.isHidden(), true)
    } finally { await close() }
})

test('on a phone the title and all the controls share one row, with the search box below', async () => {
    const { page, close } = await open(`#${LUX}`, { viewport: { width: 375, height: 812 } })
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const tops = await page.evaluate(() => {
            const top = el => Math.round(el.getBoundingClientRect().top)
            return {
                title: top(document.querySelector('.site-title')),
                controls: [...document.querySelectorAll('.header-control')].map(top),
                search: top(document.querySelector('.search'))
            }
        })
        assert.ok(tops.controls.every(top => Math.abs(top - tops.controls[0]) <= 1), 'the controls are on one row')
        assert.ok(tops.search > tops.controls[0] + 20, 'the search box is below the controls')
        assert.equal(await page.locator('#export-toggle').getAttribute('title'), 'Export')
    } finally { await close() }
})

// ---------- Display mode and the slideshow ----------

const curatedIds = JSON.parse(await readFile(join(ROOT, 'data/albums.json'), 'utf8')).map(album => album.id)
const currentId = page => page.evaluate(() => location.hash.slice(1))
const root = page => page.locator('html')

test('?display=true shows only the poster, as large as the screen allows', async () => {
    const { page, close } = await open(`?display=true#${LUX}`, { viewport: { width: 1280, height: 800 } })
    try {
        await poster(page).title.getByText('LUX').waitFor()
        assert.equal(await page.locator('.site-header').isHidden(), true)
        assert.equal(await page.locator('footer').isHidden(), true)

        // the poster fills the height of the screen without scrolling
        const { top, bottom, scrollHeight, innerHeight } = await page.evaluate(() => {
            const rect = document.getElementById('album-info').getBoundingClientRect()
            return { top: rect.top, bottom: rect.bottom, scrollHeight: document.documentElement.scrollHeight, innerHeight }
        })
        assert.ok(top >= 0 && bottom <= innerHeight, `the poster is on screen (${top}..${bottom} of ${innerHeight})`)
        assert.ok(bottom - top > innerHeight * 0.9, 'and fills most of the height')
        assert.ok(scrollHeight <= innerHeight, 'no scrolling')
    } finally { await close() }
})

test('the buttons show on activity, and Exit brings the normal page back', async () => {
    const { page, close } = await open(`?display=true#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const controls = page.locator('.display-controls')
        const opacity = () => controls.evaluate(el => getComputedStyle(el).opacity)

        await page.mouse.move(300, 300)
        await page.mouse.move(320, 320)
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.display-controls')).opacity === '1')
        assert.equal(await page.getByRole('button', { name: 'Pause' }).isHidden(), true) // only with a slideshow

        await page.getByRole('button', { name: 'Exit display mode' }).click()
        assert.equal(await page.locator('.site-header').isVisible(), true)
        assert.equal(await root(page).getAttribute('data-display'), null)
        assert.doesNotMatch(page.url(), /display=/)
        assert.equal(await opacity(), '0')
    } finally { await close() }
})

test('?controls=false leaves out the buttons too', async () => {
    const { page, close } = await open(`?display=true&controls=false#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.mouse.move(300, 300)
        assert.equal(await page.locator('.display-controls').isHidden(), true)
    } finally { await close() }
})

test('the slideshow changes album every few seconds, from the curated list, and updates the URL', async () => {
    const { page, close } = await open(`?kiosk=3#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        assert.equal(await root(page).getAttribute('data-kiosk'), 'on')
        assert.equal(await root(page).getAttribute('data-display'), 'on')
        assert.equal(await currentId(page), LUX) // it starts with the album in the URL

        await page.waitForFunction(id => location.hash.slice(1) !== id, LUX, { timeout: 15_000 })
        const second = await currentId(page)
        assert.ok(curatedIds.includes(second), 'the next album is one from the curated list')
        await page.locator('#album-name').getByText(`Album ${second.slice(0, 8)}`).waitFor()

        await page.waitForFunction(id => location.hash.slice(1) !== id, second, { timeout: 15_000 })
        assert.notEqual(await currentId(page), second)
    } finally { await close() }
})

test('pause stops the slideshow, and Next, N and the arrow key go on to the next album', async () => {
    const { page, close } = await open(`?kiosk=3#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.mouse.move(200, 200)
        await page.mouse.move(210, 210)

        await page.getByRole('button', { name: 'Pause' }).click()
        assert.equal(await page.getByRole('button', { name: 'Continue' }).getAttribute('aria-pressed'), 'true')
        await page.waitForTimeout(5000)
        assert.equal(await currentId(page), LUX, 'nothing changes while paused')

        // the buttons have faded away by now; a move of the mouse brings them back
        await page.mouse.move(220, 220)
        await page.mouse.move(230, 230)
        const changedFrom = id => page.waitForFunction(from => location.hash.slice(1) !== from, id, { timeout: 15_000 })

        await page.getByRole('button', { name: 'Next album' }).click()
        await changedFrom(LUX)
        const afterButton = await currentId(page)
        await page.waitForFunction(() => !document.getElementById('album-container').classList.contains('is-changing'))

        await page.keyboard.press('n')
        await changedFrom(afterButton)
        const afterN = await currentId(page)
        await page.waitForFunction(() => !document.getElementById('album-container').classList.contains('is-changing'))

        await page.keyboard.press('ArrowRight')
        await changedFrom(afterN)
    } finally { await close() }
})

test('the slideshow can take random albums from MusicBrainz', async () => {
    searches.length = 0
    const { page, close } = await open(`?kiosk=3&source=random#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.waitForFunction(id => location.hash.slice(1) === id, RANDOM_ID, { timeout: 20_000 })
        await page.locator('#album-name').getByText(`Album ${RANDOM_ID.slice(0, 8)}`).waitFor()

        const search = searches.find(query => query.startsWith('tag:'))
        assert.ok(search, 'a random search was made')
        assert.match(search, /primarytype:album/)
        assert.match(search, /releases:\[8 TO \*\]/)
    } finally { await close() }
})

test('the Display menu starts a slideshow, and Escape or Exit stops it again', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.getByRole('button', { name: 'Display' }).click()
        assert.equal(await page.locator('#display-panel').isVisible(), true)

        await page.getByLabel('Change every').selectOption('15')
        await page.getByLabel('Albums from').selectOption('random')
        await page.getByRole('button', { name: 'Start slideshow' }).click()

        await page.waitForFunction(() => document.documentElement.dataset.kiosk === 'on')
        assert.match(page.url(), /kiosk=15/)
        assert.match(page.url(), /source=random/)
        assert.equal(await page.locator('.site-header').isHidden(), true)
        assert.equal(await page.locator('#display-panel').isHidden(), true)

        // leave full screen first when the browser went there; then Exit
        await page.mouse.move(100, 100)
        await page.mouse.move(110, 110)
        await page.getByRole('button', { name: 'Exit display mode' }).click()
        await page.waitForFunction(() => !document.documentElement.dataset.kiosk)
        assert.doesNotMatch(page.url(), /kiosk=|source=/)
        assert.equal(await page.locator('.site-header').isVisible(), true)
    } finally { await close() }
})

test('"Full screen" in the menu shows only the poster, and Escape leaves again', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.getByRole('button', { name: 'Display' }).click()
        await page.locator('#menu-fullscreen').click()
        await page.waitForFunction(() => document.documentElement.dataset.display === 'on')
        assert.equal(await page.locator('.site-header').isHidden(), true)

        // when the browser did not go full screen (some cannot), Escape leaves the display mode itself
        if (!await page.evaluate(() => Boolean(document.fullscreenElement))) {
            await page.keyboard.press('Escape')
            await page.waitForFunction(() => !document.documentElement.dataset.display)
        } else {
            await page.evaluate(() => document.exitFullscreen())
            await page.waitForFunction(() => !document.documentElement.dataset.display)
        }
        assert.equal(await page.locator('.site-header').isVisible(), true)
    } finally { await close() }
})

test('freezing the line breaks keeps every text as high as it is on screen, and undoes cleanly', async () => {
    // a narrow poster, so that long tracks wrap
    const { page, close } = await open(`#${LUX}`, { viewport: { width: 420, height: 1600 } })
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const result = await page.evaluate(async () => {
            const { freezeLineBreaks, freezeAllLineBreaks } = await import('/scripting/lineBreaks.js')
            const lineHeight = li => parseFloat(getComputedStyle(li).lineHeight)
            const items = [...document.querySelectorAll('#track-list li')]
            // make two tracks long enough to wrap, one of them over three lines
            items[0].firstChild.data = 'Sexo, violencia y llantas con un titel dat echt te lang is'
            items[1].firstChild.data = 'Mio Cristo piange diamanti'
            const wrapping = items.filter(li => li.getBoundingClientRect().height > lineHeight(li) * 1.5)

            const before = wrapping.map(li => ({ text: li.textContent, height: li.getBoundingClientRect().height }))
            const undo = freezeAllLineBreaks()
            const frozen = wrapping.map(li => ({
                lines: li.firstChild.data.split('\n').length,
                height: li.getBoundingClientRect().height,
                whiteSpace: li.style.whiteSpace
            }))
            undo()
            const after = wrapping.map(li => ({ text: li.textContent, whiteSpace: li.style.whiteSpace }))
            return { count: wrapping.length, before, frozen, after, single: typeof freezeLineBreaks }
        })

        assert.ok(result.count > 0, 'the test needs tracks that wrap on screen')
        result.before.forEach((item, i) => {
            const { lines, height, whiteSpace } = result.frozen[i]
            assert.ok(lines >= 2, `${item.text} has real line breaks`)
            assert.ok(Math.abs(height - item.height) < 1, `${item.text} is as high as before`)
            assert.equal(whiteSpace, 'pre')
            assert.deepEqual(result.after[i], { text: item.text, whiteSpace: '' })
        })
    } finally { await close() }
})

test('with colors=cover the poster gets the colours of the cover', async () => {
    const { page, close } = await open(`?colors=cover#${LUX}`)
    try {
        await page.waitForFunction(() => document.getElementById('album-container').style.getPropertyValue('--poster-bg') !== '')
        const bg = await page.locator('#album-container').evaluate(el => el.style.getPropertyValue('--poster-bg'))
        assert.match(bg, /^rgb\(\d+ \d+ \d+\)$/)
    } finally { await close() }
})

for (const layout of ['classic', 'minimal', 'swiss']) {
    test(`on a phone the ${layout} poster fits the screen and nothing sticks out`, async () => {
        const { page, close } = await open(`?layout=${layout}#${LUX}`, { viewport: { width: 375, height: 812 } })
        try {
            await poster(page).title.getByText('LUX').waitFor()
            await page.waitForFunction(() => document.getElementById('album-cover').naturalWidth > 0)
            const { scrollWidth, innerWidth, right } = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                innerWidth,
                right: document.getElementById('album-info').getBoundingClientRect().right
            }))
            assert.ok(scrollWidth <= innerWidth, `page scrolls sideways: ${scrollWidth} > ${innerWidth}`)
            assert.ok(right <= innerWidth, 'the poster runs off the screen')
        } finally { await close() }
    })
}

// The export library comes from jsDelivr, so the tests that export need the internet
async function jsDelivrReachable() {
    return fetch('https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/+esm', { method: 'HEAD' })
        .then(response => response.ok, () => false)
}

// Opens the album, picks the export options, downloads, and gives back the file name and bytes
async function exportFile({ format, quality }) {
    const { page, close } = await open(`#${ABBEY}`, { acceptDownloads: true })
    try {
        await poster(page).title.getByText('Abbey Road').waitFor()
        await page.waitForFunction(() => document.getElementById('album-cover').naturalWidth > 0)
        await page.getByRole('button', { name: 'Export' }).click()
        await page.getByLabel('File type').selectOption(format)
        await page.getByLabel('Quality').selectOption(quality)
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60_000 }),
            page.getByRole('button', { name: 'Download' }).click()
        ])
        const bytes = await readFile(await download.path())
        // the cover is back to the size of the page afterwards
        const cover = await page.evaluate(() => document.getElementById('album-cover').src)
        return { filename: download.suggestedFilename(), bytes, cover }
    } finally { await close() }
}

const pngInfo = bytes => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const chunks = {}
    for (let offset = 8; offset < bytes.length; offset += 12 + view.getUint32(offset)) {
        chunks[Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString('ascii')] = offset + 8
    }
    return {
        width: view.getUint32(chunks.IHDR),
        height: view.getUint32(chunks.IHDR + 4),
        pixelsPerMeter: chunks.pHYs ? view.getUint32(chunks.pHYs) : null
    }
}

test('download PNG gives a file named after the album, 2400 px wide at 300 dpi', async t => {
    if (!await jsDelivrReachable()) return t.skip('jsDelivr is not reachable')

    const { filename, bytes } = await exportFile({ format: 'png', quality: 'standard' })
    assert.equal(filename, 'The Beatles - Abbey Road.png')
    const { width, pixelsPerMeter } = pngInfo(bytes)
    assert.equal(width, 2400)
    assert.equal(pixelsPerMeter, 11811)
})

test('the higher qualities make larger PNGs, and the page goes back to its own cover', async t => {
    if (!await jsDelivrReachable()) return t.skip('jsDelivr is not reachable')

    const high = await exportFile({ format: 'png', quality: 'high' })
    assert.equal(pngInfo(high.bytes).width, 4000)
    assert.equal(high.cover, 'https://images.test/front.svg')
})

test('download PDF gives a one page PDF as large as the image at 300 dpi', async t => {
    if (!await jsDelivrReachable()) return t.skip('jsDelivr is not reachable')

    const { filename, bytes } = await exportFile({ format: 'pdf', quality: 'standard' })
    assert.equal(filename, 'The Beatles - Abbey Road.pdf')
    const text = Buffer.from(bytes).toString('latin1')
    assert.ok(text.startsWith('%PDF-1.4'))
    assert.match(text, /\/MediaBox \[0 0 576\.00 \d+\.\d\d\]/) // 2400 / 300 * 72 = 576 points
    assert.match(text, /\/Width 2400 /)
    assert.match(text, /\/Title <FEFF/)
})
