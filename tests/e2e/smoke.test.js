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
import { sortAlbums } from '../../scripting/wallList.js'

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

// An album at the extremes: a very long title and artist, and a tracklist that is long and has long tracks
const EXTREME = '99999999-aaaa-4bbb-8ccc-eeeeeeeeeeee'
const EXTREME_TITLE = 'The Extraordinarily Long Title of an Album That Goes On and On (Deluxe Anniversary Remastered Edition)'
const EXTREME_ARTIST = 'Konstantinopolitanische Philharmonie of the Extraordinarily Long Names'
const extremeTracks = Array.from({ length: 30 }, (_, i) =>
    i % 3 === 0 ? `A track whose title is so long that it has to wrap onto a second and a third line, number ${i + 1}` : `Track ${i + 1}`)

function release(title, artist, trackNames = ['Come Together', 'Something', 'Octopus\'s Garden']) {
    return {
        title,
        date: '1969-09-26',
        barcode: '5901234123457',
        'artist-credit': [{ name: artist }],
        'label-info': [{ label: { name: 'Apple' } }],
        'release-group': { title, 'first-release-date': '1969-09-26', genres: [{ name: 'rock', count: 3 }] },
        media: [{ tracks: trackNames.map((name, i) => ({
            number: String(i + 1), title: name,
            // as MusicBrainz does: the length on the track, or only on its recording
            ...(i === 0 ? { length: 200_000 } : { recording: { length: 100_000 } })
        })) }]
    }
}

// What the fake MusicBrainz knows: three named albums; any other id gets an album named after the id
const albums = new Map([[EXTREME, [EXTREME_TITLE, EXTREME_ARTIST]], [ABBEY, ['Abbey Road', 'The Beatles']], [LUX, ['LUX', 'ROSALÍA']], [RATED_R, ['Rated R', 'Rihanna']]])
const albumFor = id => albums.get(id) ?? [`Album ${id.slice(0, 8)}`, 'Some Band']
const RANDOM_ID = '11111111-2222-4333-8444-555555555555'
const searches = []
let slowImageMs = 0 // makes the cover images slow, to see that the poster waits for them
let slowMs = 0 // makes MusicBrainz and the Cover Art Archive answer slowly, to see the loading state

async function mockNetwork(context) {
    await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, async route => {
        const url = new URL(route.request().url())
        const path = decodeURIComponent(url.pathname)

        if (slowMs && ['musicbrainz.org', 'coverartarchive.org'].includes(url.hostname)) {
            await new Promise(resolve => setTimeout(resolve, slowMs))
        }

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
                const id = match[1].replace(/^r-/, '')
                return json(route, release(title, artist, id === EXTREME ? extremeTracks : undefined))
            }
        }

        if (url.hostname === 'coverartarchive.org') {
            // the thumbnails of the wall
            if (path.endsWith('/front-250')) {
                return route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: CORS, body: COVER })
            }
            const match = path.match(/\/release-group\/([^/]+)$/)
            if (match) {
                return json(route, {
                    release: `https://musicbrainz.org/release/r-${match[1]}`,
                    images: [{ types: ['Front'], image: `https://images.test/front-${match[1]}.svg`, thumbnails: { 1200: `https://images.test/front-${match[1]}.svg` } }]
                })
            }
            return json(route, {}, 404)
        }

        if (url.hostname === 'images.test') {
            if (slowImageMs) await new Promise(resolve => setTimeout(resolve, slowImageMs))
            return route.fulfill({ status: 200, contentType: 'image/svg+xml', headers: CORS, body: COVER })
        }

        // fonts and the like: fail quietly
        return route.abort()
    })
}

let server, base, browser

before(async () => {
    server = createServer(async (request, response) => {
        let path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname))
        if (path.endsWith('/')) path += 'index.html'
        // the prepared details are left out: these tests are about what the fake MusicBrainz says
        // (offline.test.js covers the prepared details)
        if (path.startsWith('/data/details/')) return void response.writeHead(404).end()
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
async function open(path, { viewport = { width: 1280, height: 900 }, acceptDownloads = false, reducedMotion = 'no-preference' } = {}) {
    // no service worker: it would take the requests that the fake network is meant to answer
    const context = await browser.newContext({ viewport, acceptDownloads, colorScheme: 'dark', reducedMotion, serviceWorkers: 'block' })
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

test('a loader shows in the search box while searching, and the results do not move the page', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const box = page.getByRole('combobox', { name: 'Search albums' })
        const before = await posterTop(page)

        slowMs = 1500
        await box.fill('abbey')
        await page.waitForFunction(() => document.querySelector('.search').hasAttribute('data-searching'))
        assert.equal(await page.locator('#search-results').getAttribute('aria-busy'), 'true')
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.search'), '::after').content), '""')
        await page.getByText('Searching…').waitFor()
        assert.equal(await posterTop(page), before)

        await page.getByRole('option', { name: /Abbey Road/ }).waitFor({ timeout: 15_000 })
        assert.equal(await page.locator('.search').getAttribute('data-searching'), null)
        assert.equal(await page.locator('#search-results').getAttribute('aria-busy'), 'false')
    } finally {
        slowMs = 0
        await close()
    }
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
        assert.equal(await page.locator('#toast').isHidden(), true)
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

test('the blur layout shows the cover enlarged and blurred behind the poster', async () => {
    const { page, close } = await open(`?layout=blur#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.waitForFunction(() => document.getElementById('album-backdrop').naturalWidth > 0)
        const { shown, sameCover, filter, fillsPoster } = await page.evaluate(() => {
            const backdrop = document.getElementById('album-backdrop')
            const box = backdrop.parentElement.getBoundingClientRect()
            const poster = document.getElementById('album-info').getBoundingClientRect()
            return {
                shown: getComputedStyle(backdrop.parentElement).display !== 'none',
                sameCover: backdrop.src === document.getElementById('album-cover').src,
                filter: getComputedStyle(backdrop).filter,
                fillsPoster: Math.abs(box.width - poster.width) < 2 && Math.abs(box.height - poster.height) < 2
            }
        })
        assert.ok(shown && sameCover && fillsPoster)
        assert.match(filter, /blur/)
    } finally { await close() }
})

test('in display mode the blur backdrop fills the whole screen and the poster keeps its place', async () => {
    const { page, close } = await open(`?layout=blur&display=true&controls=false#${LUX}`, { viewport: { width: 1600, height: 900 } })
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.waitForFunction(() => document.documentElement.dataset.display === 'on')
        const { backdrop, info, scrollWidth, scrollHeight } = await page.evaluate(() => {
            const box = selector => {
                const { left, top, width, height } = document.querySelector(selector).getBoundingClientRect()
                return { left, top, width, height }
            }
            return {
                backdrop: box('.poster-backdrop'),
                info: box('#album-info'),
                scrollWidth: document.documentElement.scrollWidth,
                scrollHeight: document.documentElement.scrollHeight
            }
        })
        assert.ok(Math.abs(backdrop.width - 1600) < 2 && Math.abs(backdrop.height - 900) < 2, 'backdrop does not fill the screen')
        assert.ok(Math.abs(backdrop.left) < 2 && Math.abs(backdrop.top) < 2)
        assert.ok(info.width < 1000 && info.height <= 900, 'the poster itself should stay poster-sized')
        assert.ok(scrollWidth <= 1600 && scrollHeight <= 900, 'the page scrolls')
    } finally { await close() }
})

test('the cd layout has a centred numbered tracklist and the album info below it, and no cover or edges', async () => {
    const { page, close } = await open(`?layout=cd#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        assert.equal(await page.locator('.cd-spine').count(), 0)
        const { centred, coverHidden, listAlign } = await page.evaluate(() => {
            const info = document.getElementById('album-info').getBoundingClientRect()
            const li = document.querySelector('#track-list li').getBoundingClientRect()
            return {
                centred: Math.abs((li.left + li.right) / 2 - (info.left + info.right) / 2) < info.width * 0.12,
                coverHidden: getComputedStyle(document.querySelector('.album-cover-wrapper')).display === 'none',
                listAlign: getComputedStyle(document.querySelector('#track-list li')).textAlign
            }
        })
        assert.ok(centred, 'the tracklist is centred')
        assert.equal(listAlign, 'center')
        assert.ok(coverHidden)
    } finally { await close() }
})

test('cd-blur is the cd layout on the blurred cover', async () => {
    const { page, close } = await open(`?layout=cd-blur#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.waitForFunction(() => document.getElementById('album-backdrop').naturalWidth > 0)
        const { backdrop, filter, color } = await page.evaluate(() => {
            const info = document.getElementById('album-info')
            const box = document.querySelector('.poster-backdrop')
            return {
                backdrop: getComputedStyle(box).display,
                filter: getComputedStyle(box.querySelector('img')).filter,
                color: getComputedStyle(info).color
            }
        })
        assert.equal(backdrop, 'block')
        assert.match(filter, /blur/)
        assert.equal(color, 'rgb(255, 255, 255)')
    } finally { await close() }
})

test('the cd layouts show the real barcode of the release, right, above the album info, and the other layouts do not', async () => {
    const { page, close } = await open(`?layout=cd#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const barcode = page.locator('#album-barcode svg')
        await barcode.waitFor()
        assert.match(await barcode.getAttribute('aria-label'), /5901234123457/)
        assert.equal((await barcode.locator('text').allTextContents()).join(''), '5901234123457')
        const { right, bottom, footerTop, infoRight, width } = await page.evaluate(() => {
            const code = document.getElementById('album-barcode').getBoundingClientRect()
            const info = document.getElementById('album-info').getBoundingClientRect()
            const footer = document.querySelector('.album-footer-info').getBoundingClientRect()
            return { right: code.right, bottom: code.bottom, footerTop: footer.top, infoRight: info.right, width: info.width }
        })
        assert.ok(infoRight - right < width * 0.08, 'close to the right edge of the poster')
        assert.ok(bottom <= footerTop, 'above the album info')

        await page.getByLabel('Poster layout').selectOption('classic')
        assert.equal(await page.locator('#album-barcode').isHidden(), true)
        await page.getByLabel('Poster layout').selectOption('cd-blur')
        assert.equal(await page.locator('#album-barcode').isVisible(), true)
    } finally { await close() }
})

test('the cd layouts are square, with a normal tracklist', async () => {
    for (const layout of ['cd', 'cd-blur']) {
        const { page, close } = await open(`?layout=${layout}#${LUX}`, { viewport: { width: 1280, height: 1000 } })
        try {
            await poster(page).title.getByText('LUX').waitFor()
            const ratio = await page.evaluate(() => {
                const box = document.getElementById('album-info').getBoundingClientRect()
                return box.height / box.width
            })
            assert.ok(Math.abs(ratio - 1) < 0.02, `${layout} is ${ratio.toFixed(3)} high for its width`)
        } finally { await close() }
    }
})

test('the backdrop is not shown in the other layouts', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        assert.equal(await page.locator('.poster-backdrop').isHidden(), true)
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
                // the previous and next buttons are left out on a phone
                controls: [...document.querySelectorAll('.header-control')].filter(el => el.offsetParent).map(top),
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
        await page.waitForFunction(() => !document.querySelector('.poster-ghost'))

        await page.keyboard.press('n')
        await changedFrom(afterButton)
        const afterN = await currentId(page)
        await page.waitForFunction(() => !document.querySelector('.poster-ghost'))

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

// ---------- Loading and messages never move the page ----------

const posterTop = page => page.evaluate(() => Math.round(document.getElementById('album-container').getBoundingClientRect().top))

test('while an album loads there is a loader on the Random button and a line at the top, and nothing moves', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const before = { top: await posterTop(page), header: await page.locator('.site-header').boundingBox() }
        assert.equal(await page.evaluate(() => document.documentElement.dataset.loading ?? null), null)

        slowMs = 1500
        const random = page.getByRole('button', { name: 'Random album' })
        await random.click()

        // the loaders show up
        await page.waitForFunction(() => document.documentElement.dataset.loading === 'true')
        assert.equal(await random.getAttribute('aria-busy'), 'true')
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.loading-line')).opacity === '1')

        // ... and the page stays exactly where it is, with no line of text added anywhere
        assert.equal(await posterTop(page), before.top)
        assert.deepEqual(await page.locator('.site-header').boundingBox(), before.header)
        assert.equal(await page.locator('#toast').isHidden(), true)

        // when the album is there, the loaders are gone
        await page.waitForFunction(() => !document.documentElement.dataset.loading, null, { timeout: 15_000 })
        assert.equal(await random.getAttribute('aria-busy'), null)
        assert.equal(await posterTop(page), before.top)
    } finally {
        slowMs = 0
        await close()
    }
})

test('a message is a bubble at the bottom of the window, and does not move the poster either', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const top = await posterTop(page)

        await page.evaluate(() => { location.hash = 'nonsense' })
        const toast = page.locator('#toast')
        await toast.waitFor()
        assert.equal(await toast.evaluate(el => getComputedStyle(el).position), 'fixed')
        assert.equal(await toast.getAttribute('data-type'), 'error')
        assert.equal(await posterTop(page), top)
        assert.equal(await page.getByRole('status').filter({ hasText: 'valid album id' }).count(), 1) // announced to screen readers

        // a new album clears it
        await page.evaluate(id => { location.hash = id }, ABBEY)
        await poster(page).title.getByText('Abbey Road').waitFor()
        assert.equal(await toast.isHidden(), true)
    } finally { await close() }
})

test('the menu buttons are icons, with a clear name for screen readers and a tooltip', async () => {
    const { page, close } = await open(`#${LUX}`, { viewport: { width: 1000, height: 1400 } }) // a portrait window: the header is on top
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const buttons = { 'shuffle-button': 'Random album', 'display-toggle': 'Display and slideshow', 'export-toggle': 'Export', 'theme-toggle': 'Dark mode' }
        for (const [id, name] of Object.entries(buttons)) {
            const button = page.locator(`#${id}`)
            assert.equal((await button.innerText()).trim(), '', `${id} shows no text`)
            assert.equal(await button.getAttribute('aria-label'), name)
            assert.equal(await button.getAttribute('title'), name)
            assert.equal(await button.locator('svg').count() > 0, true, `${id} has an icon`)
            assert.ok((await button.boundingBox()).width <= 40, `${id} is a small round button`)
        }
        // the name of the layout menu and the search box are there too
        assert.equal(await page.getByLabel('Poster layout').count(), 1)
        assert.equal(await page.getByRole('combobox', { name: 'Search albums' }).count(), 1)
    } finally { await close() }
})

test('the search box is short on a wide screen and the results are wider than the box', async () => {
    const { page, close } = await open(`#${LUX}`, { viewport: { width: 1000, height: 1400 } }) // the header is on top here
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const box = page.getByRole('combobox', { name: 'Search albums' })
        assert.ok((await box.boundingBox()).width <= 180, 'a short box')

        await box.focus()
        const list = page.locator('#search-results')
        await list.waitFor()
        assert.ok((await list.boundingBox()).width >= 280, 'but the list can be read')
        const { x, width } = await list.boundingBox()
        assert.ok(x >= 0 && x + width <= 1280, 'and it is inside the window')
    } finally { await close() }
})

// ---------- A new album changes all at once, with a crossfade ----------

test('the title and the cover change together: the old poster stays until the new cover is in', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.waitForFunction(() => document.getElementById('album-cover').complete)
        const oldCover = await page.evaluate(() => document.getElementById('album-cover').src)

        slowImageMs = 1500
        await page.evaluate(id => { location.hash = id }, ABBEY)

        // while the new cover is on its way, the old poster stays complete: old title, old cover
        await page.waitForFunction(() => document.documentElement.dataset.loading === 'true')
        await page.waitForTimeout(500)
        assert.equal(await poster(page).title.textContent(), 'LUX')
        assert.equal(await page.evaluate(() => document.getElementById('album-cover').src), oldCover)

        // then both change in one go: the new title never stands on the old cover
        await poster(page).title.getByText('Abbey Road').waitFor({ timeout: 15_000 })
        const state = await page.evaluate(() => {
            const cover = document.getElementById('album-cover')
            return { src: cover.src, complete: cover.complete, width: cover.naturalWidth, hidden: cover.classList.contains('hidden') }
        })
        assert.equal(state.src, `https://images.test/front-${ABBEY}.svg`)
        assert.equal(state.complete && state.width > 0 && !state.hidden, true, 'and the new cover is already in')
    } finally {
        slowImageMs = 0
        await close()
    }
})

test('the old poster fades out over the new one, and is gone afterwards', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.evaluate(() => { window.__ghostSeen = []
            new MutationObserver(() => {
                const ghost = document.querySelector('.poster-ghost')
                if (ghost && !window.__ghostSeen.length) {
                    const first = document.querySelector('#album-name').textContent
                    window.__ghostSeen.push({ ghostTitle: ghost.querySelector('.album-name').textContent, liveTitle: first,
                        ghostIds: ghost.querySelectorAll('[id]').length, hidden: ghost.getAttribute('aria-hidden'), clickable: getComputedStyle(ghost).pointerEvents })
                }
            }).observe(document.querySelector('main'), { childList: true })
        })

        await page.evaluate(id => { location.hash = id }, ABBEY)
        await poster(page).title.getByText('Abbey Road').waitFor()
        await page.waitForFunction(() => window.__ghostSeen.length > 0)

        const seen = await page.evaluate(() => window.__ghostSeen[0])
        assert.equal(seen.ghostTitle, 'LUX', 'the copy shows the old album')
        assert.equal(seen.liveTitle, 'Abbey Road', 'while the real poster already shows the new one')
        assert.equal(seen.ghostIds, 0, 'no duplicate ids')
        assert.equal(seen.hidden, 'true')
        assert.equal(seen.clickable, 'none')

        await page.waitForFunction(() => !document.querySelector('.poster-ghost'), null, { timeout: 5000 })
        assert.equal(await page.locator('[id="album-name"]').count(), 1)
    } finally { await close() }
})

test('with "reduce motion" there is no crossfade, the poster just changes', async () => {
    const { page, close } = await open(`#${LUX}`, { reducedMotion: 'reduce' })
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.evaluate(() => { window.__ghosts = 0
            new MutationObserver(() => { if (document.querySelector('.poster-ghost')) window.__ghosts++ }).observe(document.querySelector('main'), { childList: true })
        })
        await page.evaluate(id => { location.hash = id }, ABBEY)
        await poster(page).title.getByText('Abbey Road').waitFor()
        await page.waitForTimeout(700)
        assert.equal(await page.evaluate(() => window.__ghosts), 0)
    } finally { await close() }
})

test('a quick second choice does not leave copies behind, and the last album wins', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.evaluate(([a, b]) => { location.hash = a; setTimeout(() => { location.hash = b }, 60) }, [ABBEY, RATED_R])
        await poster(page).title.getByText('Rated R').waitFor()
        await page.waitForFunction(() => !document.querySelector('.poster-ghost'), null, { timeout: 5000 })
        assert.equal(await poster(page).title.textContent(), 'Rated R')
        assert.equal(await page.evaluate(() => document.querySelectorAll('.poster-ghost').length), 0)
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

for (const layout of ['classic', 'minimal', 'swiss', 'blur', 'cd', 'cd-blur', 'festival', 'receipt', 'gallery', 'setlist', 'typographic', 'riso', 'film', 'vinyl', 'modern']) {
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


// Opens the album, picks the export options, downloads, and gives back the file name and bytes
async function exportFile({ format, quality, print = {} }) {
    const { page, close } = await open(`#${ABBEY}`, { acceptDownloads: true })
    try {
        await poster(page).title.getByText('Abbey Road').waitFor()
        await page.waitForFunction(() => document.getElementById('album-cover').naturalWidth > 0)
        await page.getByRole('button', { name: 'Export' }).click()
        await page.getByLabel('File type').selectOption(format)
        if (format === 'png') await page.getByLabel('Quality').selectOption(quality)
        // the print options of a PDF: { paper, orientation, margin, dpi, bleed, marks }
        for (const [name, value] of Object.entries(print)) {
            const field = { paper: '#print-paper', orientation: '#print-orientation', margin: '#print-margin', dpi: '#print-dpi' }[name]
            if (field) await page.locator(field).selectOption(String(value))
            else await page.locator(`#print-${name}`).setChecked(value)
        }
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

test('download PNG gives a file named after the album, 2400 px wide at 300 dpi', async () => {

    const { filename, bytes } = await exportFile({ format: 'png', quality: 'standard' })
    assert.equal(filename, 'The Beatles - Abbey Road.png')
    const { width, pixelsPerMeter } = pngInfo(bytes)
    assert.equal(width, 2400)
    assert.equal(pixelsPerMeter, 11811)
})

test('the higher qualities make larger PNGs, and the page goes back to its own cover', async () => {

    const high = await exportFile({ format: 'png', quality: 'high' })
    assert.equal(pngInfo(high.bytes).width, 4000)
    assert.equal(high.cover, `https://images.test/front-${ABBEY}.svg`)
})

test('download PDF gives an A4 page for a printer: a margin, and the dpi in the name', async () => {

    const { filename, bytes } = await exportFile({ format: 'pdf', print: { paper: 'a4', margin: 10, dpi: 300 } })
    assert.match(filename, /^The Beatles - Abbey Road \(A4, (29\d|30\d) dpi\)\.pdf$/)
    const text = Buffer.from(bytes).toString('latin1')
    assert.ok(text.startsWith('%PDF-1.4'))
    assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/) // A4 in points
    assert.match(text, /\/TrimBox \[0\.00 0\.00 595\.28 841\.89\]/)
    assert.match(text, /\/Title <FEFF/)
    // the picture has the pixels for 300 dpi: wider than 1500 and not more than the page holds at 300 dpi
    const width = Number(text.match(/\/Width (\d+) /)[1])
    assert.ok(width > 1500 && width <= 2480, `width ${width}`)
})

test('a PDF with bleed and crop marks has room around the trim, and the marks', async () => {

    const { bytes } = await exportFile({ format: 'pdf', print: { paper: 'a3', margin: 0, dpi: 150, bleed: true, marks: true } })
    const text = Buffer.from(bytes).toString('latin1')
    const pt = mm => (mm / 25.4 * 72).toFixed(2)
    // A3 is 297 x 420 mm; 8 mm for the marks on every side
    assert.match(text, new RegExp(`/MediaBox \\[0 0 ${pt(313)} ${pt(436)}\\]`))
    assert.match(text, new RegExp(`/TrimBox \\[${pt(8)} ${pt(8)} ${pt(305)} ${pt(428)}\\]`))
    assert.match(text, /0 0 0 1 K/)
    assert.equal((text.match(/ l S/g) ?? []).length, 8)
})

test('a PDF named without options still makes the old page, as large as the image at 300 dpi', async () => {

    const { page, close } = await open(`#${ABBEY}`)
    try {
        await poster(page).title.getByText('Abbey Road').waitFor()
        const result = await page.evaluate(async () => {
            const { renderPoster } = await import('/scripting/exportPoster.js')
            const { blob, filename } = await renderPoster({ format: 'pdf', quality: 'standard' })
            return { filename, text: await blob.text() }
        })
        assert.equal(result.filename, 'The Beatles - Abbey Road.pdf')
        assert.match(result.text, /\/MediaBox \[0 0 576\.00 \d+\.\d\d\]/)
    } finally { await close() }
})

test('the export panel shows pixels for a PNG and print options, with dpi, for a PDF', async () => {
    const { page, close } = await open(`#${ABBEY}`)
    try {
        await poster(page).title.getByText('Abbey Road').waitFor()
        await page.getByRole('button', { name: 'Export' }).click()
        assert.equal(await page.locator('#print-options').isHidden(), true)
        assert.equal(await page.locator('#export-quality').isVisible(), true)

        await page.getByLabel('File type').selectOption('pdf')
        assert.equal(await page.locator('#print-options').isVisible(), true)
        assert.equal(await page.locator('#export-quality').isHidden(), true)
        assert.deepEqual(await page.locator('#print-dpi option').allTextContents(), ['150 dpi, draft', '300 dpi, print', '600 dpi, fine art'])
        const paper = await page.locator('#print-paper option').allTextContents()
        for (const name of ['A4', 'A3', '50 × 70 cm', 'Letter (8.5 × 11 in)']) assert.ok(paper.includes(name), name)

        // the summary says what the file will be, and follows the options
        const summary = page.locator('#print-summary')
        await page.waitForFunction(() => document.getElementById('print-summary').textContent.includes('dpi'))
        assert.match(await summary.textContent(), /^A4 portrait, poster \d+ × \d+ mm at 300 dpi, \d+ × \d+ px$/)
        await page.locator('#print-paper').selectOption('a2')
        await page.locator('#print-dpi').selectOption('150')
        await page.locator('#print-bleed').check()
        await page.locator('#print-marks').check()
        assert.match(await summary.textContent(), /^A2 portrait.* at 150 dpi, \d+ × \d+ px, 3 mm bleed, crop marks$/)
    } finally { await close() }
})

test('the purpose sets margin, dpi, bleed and marks together, and says custom when one of them is changed', async () => {
    const { page, close } = await open(`#${ABBEY}`)
    try {
        await poster(page).title.getByText('Abbey Road').waitFor()
        await page.getByRole('button', { name: 'Export' }).click()
        await page.getByLabel('File type').selectOption('pdf')
        assert.equal(await page.locator('#print-preset').inputValue(), 'home') // the default settings

        await page.locator('#print-paper').selectOption('a3')
        await page.locator('#print-preset').selectOption('shop')
        assert.equal(await page.locator('#print-margin').inputValue(), '0')
        assert.equal(await page.locator('#print-dpi').inputValue(), '300')
        assert.equal(await page.locator('#print-bleed').isChecked(), true)
        assert.equal(await page.locator('#print-marks').isChecked(), true)
        assert.equal(await page.locator('#print-paper').inputValue(), 'a3', 'the paper stays')
        assert.match(await page.locator('#print-summary').textContent(), /^A3 portrait.*3 mm bleed, crop marks$/)

        await page.locator('#print-dpi').selectOption('600')
        assert.equal(await page.locator('#print-preset').inputValue(), 'custom')
        await page.locator('#print-preset').selectOption('draft')
        assert.equal(await page.locator('#print-dpi').inputValue(), '150')
        assert.equal(await page.locator('#print-bleed').isChecked(), false)

        // remembered with the rest of the settings
        await page.reload()
        await poster(page).title.getByText('Abbey Road').waitFor()
        assert.equal(await page.locator('#print-preset').inputValue(), 'draft')
    } finally { await close() }
})

test('the print settings are remembered, and the print dialog gets that paper', async () => {
    const { page, close } = await open(`#${ABBEY}`)
    try {
        await poster(page).title.getByText('Abbey Road').waitFor()
        await page.getByRole('button', { name: 'Export' }).click()
        await page.getByLabel('File type').selectOption('pdf')
        await page.locator('#print-paper').selectOption('a3')
        await page.locator('#print-margin').selectOption('5')
        await page.locator('#print-marks').check()

        await page.reload()
        await poster(page).title.getByText('Abbey Road').waitFor()
        assert.equal(await page.locator('#print-paper').inputValue(), 'a3')
        assert.equal(await page.locator('#print-margin').inputValue(), '5')
        assert.equal(await page.locator('#print-marks').isChecked(), true)

        // window.print() is replaced, to see what the page asks the printer for
        const css = await page.evaluate(async () => {
            let seen = ''
            window.print = () => { seen = [...document.querySelectorAll('head style')].map(style => style.textContent).join('\n') }
            const { printPoster } = await import('/scripting/exportPoster.js')
            const { printSettings } = await import('/scripting/exportPanel.js')
            printPoster(printSettings())
            return seen
        })
        assert.match(css, /@page \{ size: 297mm 420mm; margin: 5mm; \}/)
    } finally { await close() }
})

// ---------- The wall and browsing ----------

const curated = JSON.parse(await readFile(join(ROOT, 'data/albums.json'), 'utf8'))
const byArtist = sortAlbums(curated, 'artist') // the same order as the page, which wallList.test.js checks

test('the wall shows a cover for every album, and a count', async () => {
    const { page, errors, close } = await open('wall/')
    try {
        await page.locator('.wall-tile').first().waitFor()
        assert.equal(await page.locator('.wall-tile').count(), curated.length)
        assert.equal((await page.locator('#wall-count').textContent()).trim(), `${curated.length} albums`)
        // the default order is by artist
        const first = await page.locator('.wall-tile').first().getAttribute('title')
        assert.equal(first, `${byArtist[0].name} – ${byArtist[0].artist}`)
        assert.equal(await page.locator('.wall-tile img').first().getAttribute('loading'), 'lazy')
        assert.deepEqual(errors, [])
    } finally { await close() }
})

test('filtering the wall narrows it down and updates the URL; clearing it brings everything back', async () => {
    const { page, close } = await open('wall/')
    try {
        await page.locator('.wall-tile').first().waitFor()
        await page.getByRole('searchbox', { name: 'Filter albums' }).fill('rosalia')
        await page.waitForFunction(() => document.querySelectorAll('.wall-tile').length === 2)
        assert.equal(new URL(page.url()).searchParams.get('q'), 'rosalia')
        assert.match(await page.locator('#wall-count').textContent(), /^2 of \d+ albums$/)

        await page.getByRole('searchbox', { name: 'Filter albums' }).fill('qqqqzzzz')
        await page.getByText('No albums match this filter.').waitFor()

        await page.getByRole('searchbox', { name: 'Filter albums' }).fill('')
        await page.waitForFunction(n => document.querySelectorAll('.wall-tile').length === n, curated.length)
        assert.equal(new URL(page.url()).searchParams.has('q'), false)
    } finally { await close() }
})

test('the wall can be grouped by artist, and a click on an artist filters on that artist', async () => {
    const { page, close } = await open('wall/?group=artist&sort=artist')
    try {
        await page.locator('.wall-group').first().waitFor()
        const artists = new Set(curated.map(album => album.artist))
        assert.equal(await page.locator('.wall-group').count(), artists.size)
        assert.equal(await page.locator('#wall-group').inputValue(), 'artist')

        await page.getByRole('button', { name: 'Tool', exact: true }).click()
        await page.waitForFunction(() => document.querySelectorAll('.wall-group').length === 1)
        assert.equal(await page.getByRole('searchbox', { name: 'Filter albums' }).inputValue(), 'Tool')
    } finally { await close() }
})

test('the wall can be sorted, and the cover size changes the grid', async () => {
    const { page, close } = await open('wall/')
    try {
        await page.locator('.wall-tile').first().waitFor()
        await page.locator('#wall-sort').selectOption('added')
        const newest = curated.at(-1)
        await page.waitForFunction(title => document.querySelector('.wall-tile')?.title === title, `${newest.name} – ${newest.artist}`)
        assert.equal(new URL(page.url()).searchParams.get('sort'), 'added')

        const column = () => page.evaluate(() => document.querySelector('.wall-tile').getBoundingClientRect().width)
        const before = await column()
        await page.locator('#wall-size').fill('20')
        await page.waitForFunction(old => document.querySelector('.wall-tile').getBoundingClientRect().width > old, before)
    } finally { await close() }
})

test('a cover on the wall opens that poster, with the layout of the wall page kept; the wall link goes back', async () => {
    const { page, close } = await open('wall/?layout=cd')
    try {
        await page.locator('.wall-tile').first().waitFor()
        await page.getByRole('searchbox', { name: 'Filter albums' }).fill('rosalia lux')
        await page.locator('.wall-tile').first().click()

        await poster(page).title.getByText('LUX').waitFor()
        const url = new URL(page.url())
        assert.equal(url.pathname, '/')
        assert.equal(url.hash, `#${LUX}`)
        assert.equal(url.searchParams.get('layout'), 'cd')

        await page.getByRole('link', { name: 'Wall: all albums' }).click()
        await page.locator('.wall-tile').first().waitFor()
        assert.equal(new URL(page.url()).pathname, '/wall/')
        assert.equal(new URL(page.url()).searchParams.get('layout'), 'cd')
    } finally { await close() }
})

test('the wall has a layout choice, kept in the URL, and a cover opens its poster in that layout', async () => {
    const { page, close } = await open('wall/')
    try {
        await page.locator('.wall-tile').first().waitFor()
        const options = await page.locator('#wall-layout option').allTextContents()
        assert.ok(options.includes('Vinyl') && options.includes('CD blur'))
        assert.equal(await page.locator('#wall-layout').inputValue(), 'classic')
        assert.equal(new URL(page.url()).searchParams.has('layout'), false) // the default stays out of the URL

        await page.locator('#wall-layout').selectOption('riso')
        assert.equal(new URL(page.url()).searchParams.get('layout'), 'riso')
        assert.match(await page.locator('.wall-tile').first().getAttribute('href'), /\?layout=riso#/)

        await page.reload()
        await page.locator('.wall-tile').first().waitFor()
        assert.equal(await page.locator('#wall-layout').inputValue(), 'riso')

        await page.locator('.wall-tile').first().click()
        await page.locator('#album-container[data-layout="riso"]').waitFor()
    } finally { await close() }
})

test('previous and next go through the list by artist, with buttons and arrow keys', async () => {
    const start = byArtist[10]
    const { page, close } = await open(`#${start.id}`)
    try {
        // the fake MusicBrainz names an unknown album after its id
        await poster(page).title.getByText(`Album ${start.id.slice(0, 8)}`).waitFor()
        const wait = id => page.waitForFunction(id => location.hash === `#${id}`, id)

        await page.getByRole('button', { name: 'Next album' }).click()
        await wait(byArtist[11].id)
        await page.keyboard.press('ArrowRight')
        await wait(byArtist[12].id)
        await page.keyboard.press('ArrowLeft')
        await wait(byArtist[11].id)
        await page.getByRole('button', { name: 'Previous album' }).click()
        await wait(byArtist[10].id)
    } finally { await close() }
})

test('the arrow keys do not browse while typing in the search box, and an album outside the list has no neighbours', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const box = page.getByRole('combobox', { name: 'Search albums' })
        await box.fill('abc')
        await box.press('ArrowLeft')
        assert.equal(await currentId(page), LUX)

        await page.evaluate(() => { location.hash = '99999999-2222-4333-8444-555555555555' })
        await page.waitForFunction(() => document.getElementById('prev-button').disabled)
        assert.equal(await page.locator('#next-button').isDisabled(), true)
    } finally { await close() }
})

// ---------- Festival, receipt and gallery ----------

test('festival, receipt and gallery are in the layout menu', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const options = await page.locator('#layout-select option').allTextContents()
        for (const name of ['Festival', 'Receipt', 'Gallery', 'Setlist', 'Typographic', 'Riso', 'Film', 'Vinyl']) assert.ok(options.includes(name), `${name} is missing`)
        for (const layout of ['festival', 'receipt', 'gallery', 'setlist', 'typographic', 'riso', 'film', 'vinyl', 'modern']) {
            await page.getByLabel('Poster layout').selectOption(layout)
            assert.equal(await page.locator('#album-container').getAttribute('data-layout'), layout)
        }
    } finally { await close() }
})

test('festival: the artist is the biggest text and the line-up gets smaller down the list', async () => {
    const { page, close } = await open(`?layout=festival#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const sizes = await page.evaluate(() => ({
            artist: parseFloat(getComputedStyle(document.querySelector('#album-artist')).fontSize),
            title: parseFloat(getComputedStyle(document.querySelector('#album-name')).fontSize),
            tracks: [...document.querySelectorAll('#track-list li')].map(li => parseFloat(getComputedStyle(li).fontSize)),
            bulletAfterFirst: getComputedStyle(document.querySelector('#track-list li'), '::after').content,
            bulletAfterLast: getComputedStyle(document.querySelector('#track-list li:last-child'), '::after').content
        }))
        assert.ok(sizes.artist > sizes.title, 'the artist is bigger than the title')
        assert.ok(sizes.title > sizes.tracks[0] * 0.8, 'the title is not smaller than the first track, about')
        assert.ok(sizes.tracks[0] >= sizes.tracks.at(-1), 'the first track is not smaller than the last')
        assert.equal(sizes.bulletAfterFirst, '"•"')
        assert.notEqual(sizes.bulletAfterLast, '"•"')
    } finally { await close() }
})

test('receipt: a narrow paper strip in monospace, with a track total, and the barcode of the release', async () => {
    const { page, close } = await open(`?layout=receipt#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const { width, parent, font, total, background } = await page.evaluate(() => {
            const info = document.getElementById('album-info')
            return {
                width: info.getBoundingClientRect().width,
                parent: document.getElementById('album-container').getBoundingClientRect().width,
                font: getComputedStyle(info).fontFamily,
                total: getComputedStyle(document.getElementById('track-list'), '::after').content,
                background: getComputedStyle(info).backgroundColor
            }
        })
        assert.ok(width < parent * 0.7, 'narrower than the poster area')
        assert.match(font, /mono|Courier/i)
        assert.equal(total, '"Tracks " counter(track)') // the browser fills in the count when it draws
        assert.equal(background, 'rgb(253, 252, 247)') // paper, in the dark theme too
        await page.locator('#album-barcode svg').waitFor()
    } finally { await close() }
})

test('gallery: the cover sits in a white mat, with the label below it and the tracklist on the right', async () => {
    const { page, close } = await open(`?layout=gallery#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const box = await page.evaluate(() => {
            const rect = selector => document.querySelector(selector).getBoundingClientRect()
            return {
                mat: getComputedStyle(document.querySelector('.album-cover-wrapper')).backgroundColor,
                cover: rect('.album-cover-wrapper'),
                artist: rect('#album-artist'),
                name: rect('#album-name'),
                tracks: rect('#track-list')
            }
        })
        assert.equal(box.mat, 'rgb(255, 255, 255)')
        assert.ok(box.artist.top >= box.cover.bottom, 'the label is below the picture')
        assert.ok(box.name.top > box.artist.top, 'the title is below the artist')
        assert.ok(box.tracks.left > box.name.right, 'the tracklist is to the right of the label')
    } finally { await close() }
})

test('in the cd layouts a track title that wraps is centred, with the number next to it', async () => {
    for (const layout of ['cd', 'cd-blur']) {
        const { page, close } = await open(`?layout=${layout}#${LUX}`)
        try {
            await poster(page).title.getByText('LUX').waitFor()
            assert.equal(await page.locator('#track-list li').first().evaluate(li => getComputedStyle(li).textAlign), 'center', layout)
            // the number is a box in front of the title, so that it stays next to the title when that wraps
            assert.equal(await page.locator('#track-list li').first().evaluate(li => getComputedStyle(li, '::before').display), 'inline-block', layout)
        } finally { await close() }
    }
})

test('cd and cd-blur lay the tracklist out the same, so a long title wraps in the same place, with room between its lines', async () => {
    const measure = async layout => {
        const { page, close } = await open(`?layout=${layout}&size=s#${LUX}`)
        try {
            await poster(page).title.getByText('LUX').waitFor()
            return await page.evaluate(() => {
                const list = document.getElementById('track-list')
                const li = list.querySelector('li')
                const style = getComputedStyle(li)
                return {
                    width: list.getBoundingClientRect().width,
                    ratio: parseFloat(style.lineHeight) / parseFloat(style.fontSize),
                    // the height of a track on one line plus the gap, in em: the list is as tall as it was before
                    pitch: (li.getBoundingClientRect().height + parseFloat(style.marginBottom)) / parseFloat(style.fontSize)
                }
            })
        } finally { await close() }
    }
    const cd = await measure('cd')
    const blur = await measure('cd-blur')
    assert.equal(blur.width, cd.width, 'the tracklist is as wide in cd-blur as in cd')
    assert.ok(cd.ratio >= 1.25, `the lines of a wrapped title are too close: ${cd.ratio}`)
    assert.equal(blur.ratio, cd.ratio)
    assert.ok(Math.abs(cd.pitch - 1.45) < 0.03, `a track on one line takes ${cd.pitch} em`)
})

// ---------- Setlist, typographic, riso, film and vinyl ----------

test('setlist: marker handwriting on a sheet, with the cover as a tilted sticker', async () => {
    const { page, close } = await open(`?layout=setlist#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const look = await page.evaluate(() => {
            const info = getComputedStyle(document.getElementById('album-info'))
            const cover = getComputedStyle(document.querySelector('.album-cover-wrapper'))
            return { font: info.fontFamily, background: info.backgroundColor, position: cover.position, transform: cover.transform, tape: getComputedStyle(document.getElementById('album-info'), '::before').content }
        })
        assert.match(look.font, /Permanent Marker/)
        assert.equal(look.background, 'rgb(245, 242, 233)') // paper, in the dark theme too
        assert.equal(look.position, 'absolute')
        assert.notEqual(look.transform, 'none')
        assert.equal(look.tape, '""') // a piece of tape
    } finally { await close() }
})

test('typographic: every word of the artist is on a line of its own, and the title is light type', async () => {
    const { page, close } = await open('?layout=typographic#11111111-2222-4333-8444-555555555555') // the fake MusicBrainz names the artist "Some Band"
    try {
        await poster(page).title.getByText('Album').waitFor()
        const { lines, size, titleWeight, biggest } = await page.evaluate(() => {
            const artist = document.getElementById('album-artist')
            const fontSize = parseFloat(getComputedStyle(artist).fontSize)
            const lineHeight = parseFloat(getComputedStyle(artist).lineHeight)
            return {
                lines: Math.round(artist.getBoundingClientRect().height / lineHeight),
                size: fontSize,
                titleWeight: getComputedStyle(document.getElementById('album-name')).fontWeight,
                biggest: parseFloat(getComputedStyle(document.getElementById('album-name')).fontSize)
            }
        })
        assert.equal(lines, 2, 'Some / Band')
        assert.ok(size > 3 * 5, 'the artist is set large')
        assert.equal(titleWeight, '300')
        assert.ok(size > biggest * 2)
    } finally { await close() }
})

test('riso: the cover is a duotone in two inks from its own colours, over paper with grain', async () => {
    const { page, close } = await open(`?layout=riso#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.waitForFunction(() => document.getElementById('album-container').style.getPropertyValue('--sw-vibrant') !== '')
        const look = await page.evaluate(() => {
            const poster = document.getElementById('album-container')
            const wrapper = document.querySelector('.album-cover-wrapper')
            return {
                bright: getComputedStyle(poster).getPropertyValue('--ink-bright').trim(),
                vibrant: poster.style.getPropertyValue('--sw-vibrant').trim(),
                coverBlend: getComputedStyle(document.getElementById('album-cover')).mixBlendMode,
                inkBlend: getComputedStyle(wrapper, '::after').mixBlendMode,
                paper: getComputedStyle(document.getElementById('album-info')).backgroundColor,
                grain: getComputedStyle(document.getElementById('album-info'), '::after').backgroundImage.startsWith('url(')
            }
        })
        assert.equal(look.bright, look.vibrant, 'the bright ink is the vibrant colour of the cover')
        assert.equal(look.coverBlend, 'multiply')
        assert.equal(look.inkBlend, 'screen')
        assert.equal(look.paper, 'rgb(244, 239, 227)')
        assert.ok(look.grain)
    } finally { await close() }
})

test('the colours of the cover are on the poster as --sw-* properties, and are gone for the next cover that lacks them', async () => {
    const { page, close } = await open(`#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.waitForFunction(() => document.getElementById('album-container').style.getPropertyValue('--sw-vibrant') !== '')
        const names = await page.evaluate(() => [...document.getElementById('album-container').style].filter(name => name.startsWith('--sw-')))
        assert.ok(names.includes('--sw-vibrant'))
        assert.ok(names.every(name => /^--sw-(vibrant|muted|darkvibrant|darkmuted|lightvibrant|lightmuted)$/.test(name)))
    } finally { await close() }
})

test('film: the title sits over the fade at the bottom of the cover, and the tracks are one paragraph of credits', async () => {
    const { page, close } = await open(`?layout=film#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const look = await page.evaluate(() => {
            const rect = selector => document.querySelector(selector).getBoundingClientRect()
            return {
                coverBottom: rect('.album-cover-wrapper').bottom,
                titleTop: rect('#album-name').top,
                background: getComputedStyle(document.getElementById('album-info')).backgroundColor,
                itemDisplay: getComputedStyle(document.querySelector('#track-list li')).display,
                separator: getComputedStyle(document.querySelector('#track-list li'), '::after').content,
                presents: getComputedStyle(document.querySelector('#album-artist'), '::after').content
            }
        })
        assert.ok(look.titleTop < look.coverBottom, 'the title overlaps the cover')
        assert.equal(look.background, 'rgb(9, 9, 11)')
        assert.equal(look.itemDisplay, 'inline')
        assert.match(look.separator, /·/)
        assert.match(look.presents, /presents/)
    } finally { await close() }
})

test('vinyl: the record is behind the sleeve, and the tracks are side A and side B', async () => {
    const { page, close } = await open(`?layout=vinyl#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const tracks = await page.evaluate(() => [...document.querySelectorAll('#track-list li')].map(li => ({
            label: li.dataset.label, start: li.dataset.sideStart ?? null, left: Math.round(li.getBoundingClientRect().left)
        })))
        // three tracks: two on side A, one on side B
        assert.deepEqual(tracks.map(track => track.label), ['A1', 'A2', 'B1'])
        assert.deepEqual(tracks.map(track => track.start), ['Side A', null, 'Side B'])
        assert.ok(tracks[2].left > tracks[0].left, 'side B is in the second column')
        assert.equal(tracks[0].left, tracks[1].left)
        const record = await page.evaluate(() => {
            const before = getComputedStyle(document.querySelector('.album-cover-wrapper'), '::before')
            return { zIndex: before.zIndex, radius: before.borderRadius, label: before.backgroundImage.includes('radial-gradient') }
        })
        assert.equal(record.zIndex, '-1')
        assert.equal(record.radius, '50%')
        assert.ok(record.label)
    } finally { await close() }
})

test('an export has the background of the poster itself, not the page: the dark film poster on a light page', async () => {
    const { page, close } = await open(`?layout=film&theme=light#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.waitForFunction(() => document.getElementById('album-cover').naturalWidth > 0)
        const corner = await page.evaluate(async () => {
            const { renderPoster } = await import('/scripting/exportPoster.js')
            const { blob } = await renderPoster({ format: 'png', quality: 'standard' })
            const bitmap = await createImageBitmap(blob)
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
            const context = canvas.getContext('2d')
            context.drawImage(bitmap, 0, 0)
            // the bottom left corner, which is the poster's own background
            return Array.from(context.getImageData(8, bitmap.height - 8, 1, 1).data)
        })
        assert.deepEqual(corner, [9, 9, 11, 255])
    } finally { await close() }
})

// ---------- Extremes ----------

// What sticks out of the poster, or out of its own box, in pixels
const overflow = page => page.evaluate(() => {
    const box = document.getElementById('album-container').getBoundingClientRect()
    const out = []
    for (const id of ['album-artist', 'album-name', 'track-list']) {
        const element = document.getElementById(id)
        const rect = element.getBoundingClientRect()
        const outside = Math.max(box.left - rect.left, rect.right - box.right, box.top - rect.top, rect.bottom - box.bottom)
        if (outside > 1) out.push(`${id} sticks out by ${Math.round(outside)}px`)
        if (element.scrollWidth > element.clientWidth + 1) out.push(`${id} is wider than its box by ${element.scrollWidth - element.clientWidth}px`)
    }
    for (const li of document.querySelectorAll('#track-list li')) {
        const rect = li.getBoundingClientRect()
        if (rect.right > box.right + 1 || rect.bottom > box.bottom + 1) { out.push('a track sticks out'); break }
    }
    const container = document.getElementById('album-container')
    if (container.scrollHeight > container.clientHeight + 1) out.push(`the poster is clipped by ${container.scrollHeight - container.clientHeight}px`)
    return out
})

for (const layout of ['setlist', 'typographic', 'riso', 'film', 'vinyl', 'modern']) {
    test(`${layout}: a very long title and artist and 30 tracks stay inside the poster`, async () => {
        for (const size of ['s', 'l']) {
            const { page, close } = await open(`?layout=${layout}&size=${size}#${EXTREME}`)
            try {
                await poster(page).title.getByText('Extraordinarily').waitFor()
                await page.waitForFunction(() => document.getElementById('album-cover').naturalWidth > 0)
                assert.deepEqual(await overflow(page), [], `${layout}, size ${size}`)
            } finally { await close() }
        }
    })
}

test('riso: the ink of a pale cover is darkened until the text and the track numbers can be read on the paper', async () => {
    const { page, close } = await open(`?layout=riso#${LUX}`)
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.waitForFunction(() => document.getElementById('album-container').style.getPropertyValue('--sw-vibrant'))
        const { contrastRatio } = await page.evaluate(async () => {
            const paper = [244, 239, 227]
            const { contrastRatio } = await import('/scripting/colors.js')
            const channels = text => text.match(/\d+/g).map(Number)
            const colorOf = element => getComputedStyle(element).color
            const info = document.getElementById('album-info')
            const number = getComputedStyle(document.querySelector('#track-list li'), '::before').color
            return { contrastRatio: { text: contrastRatio(channels(colorOf(info)), paper), number: contrastRatio(channels(number), paper) } }
        })
        assert.ok(contrastRatio.text >= 4.5, `text ${contrastRatio.text}`)
        assert.ok(contrastRatio.number >= 3, `numbers ${contrastRatio.number}`)
    } finally { await close() }
})

test('film: the fade of the cover does not cover the tracks, also when there are few of them', async () => {
    const { page, close } = await open(`?layout=film#${LUX}`) // three tracks: the cover has room to grow down to them
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const covered = await page.evaluate(() => {
            // what is on top where a track and the footer are, instead of the text itself
            const onTop = element => {
                const rect = element.getBoundingClientRect()
                const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
                return hit && !element.contains(hit) && !hit.contains(element) ? hit.className : null
            }
            return [onTop(document.querySelector('#track-list li')), onTop(document.querySelector('.album-footer-info'))]
        })
        assert.deepEqual(covered, [null, null])
    } finally { await close() }
})

test('in every layout the first track and the footer are on top, not covered by another part of the poster', async () => {
    const { LAYOUTS } = await import('../../scripting/layouts.js')
    const problems = []
    for (const layout of LAYOUTS) {
        const { page, close } = await open(`?layout=${layout}#${LUX}`)
        try {
            await poster(page).title.getByText('LUX').waitFor()
            await page.waitForFunction(() => document.getElementById('album-cover').naturalWidth > 0)
            const covered = await page.evaluate(() => {
                const onTop = element => {
                    const rect = element.getBoundingClientRect()
                    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
                    return hit && !element.contains(hit) && !hit.contains(element) ? String(hit.className) : null
                }
                return [onTop(document.querySelector('#track-list li')), onTop(document.querySelector('.album-footer-info'))]
            })
            if (covered.some(Boolean)) problems.push(`${layout}: ${covered}`)
        } finally { await close() }
    }
    assert.deepEqual(problems, [])
})

// ---------- A phone in portrait ----------

// Pairs of text blocks of the poster that lie on top of each other, in pixels of overlap
const overlaps = page => page.evaluate(() => {
    const blocks = ['album-artist', 'album-name', 'track-list'].map(id => [id, document.getElementById(id)])
    blocks.push(['footer', document.querySelector('.album-footer-info')])
    const found = []
    for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
            const a = blocks[i][1].getBoundingClientRect()
            const b = blocks[j][1].getBoundingClientRect()
            const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
            const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
            if (x > 2 && y > 2) found.push(`${blocks[i][0]} and ${blocks[j][0]} overlap by ${Math.round(x)} × ${Math.round(y)}px`)
        }
    }
    return found
})

for (const [name, id] of [['a normal album', LUX], ['a very long title, artist and tracklist', EXTREME]]) {
    test(`on a phone in portrait every layout fits and nothing overlaps: ${name}`, async () => {
        const { LAYOUTS } = await import('../../scripting/layouts.js')
        const problems = []
        for (const layout of LAYOUTS) {
            const { page, close } = await open(`?layout=${layout}#${id}`, { viewport: { width: 375, height: 812 } })
            try {
                await page.waitForFunction(() => document.getElementById('album-cover').naturalWidth > 0)
                await page.waitForTimeout(150)
                const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
                const found = [...await overflow(page), ...await overlaps(page)]
                if (sideways > 0) found.push(`the page scrolls sideways by ${sideways}px`)
                if (found.length) problems.push(`${layout}: ${found.join('; ')}`)
            } finally { await close() }
        }
        assert.deepEqual(problems, [])
    })
}

test('the export panel and its fields stay inside the window, on a phone and on a desktop', async () => {
    for (const viewport of [{ width: 375, height: 812 }, { width: 320, height: 640 }, { width: 1280, height: 800 }]) {
        const { page, close } = await open(`#${LUX}`, { viewport })
        try {
            await poster(page).title.getByText('LUX').waitFor()
            await page.getByRole('button', { name: 'Export' }).click()
            await page.getByLabel('File type').selectOption('pdf')
            const outside = await page.evaluate(() => {
                const panel = document.getElementById('export-panel').getBoundingClientRect()
                const out = []
                if (panel.left < 0 || panel.right > innerWidth) out.push('the panel is outside the window')
                for (const element of document.querySelectorAll('#export-panel select, #export-panel button, #export-panel .panel-note')) {
                    const rect = element.getBoundingClientRect()
                    if (rect.width && (rect.left < panel.left - 0.5 || rect.right > panel.right + 0.5)) out.push(`${element.id || element.className} sticks out of the panel`)
                }
                if (document.documentElement.scrollWidth > innerWidth) out.push('the page scrolls sideways')
                return out
            })
            assert.deepEqual(outside, [], `${viewport.width} px wide`)
        } finally { await close() }
    }
})

test('the wall, with its layout menu, the offline panel and the update banner, fits a phone', async () => {
    for (const width of [320, 375]) {
        const { page, close } = await open('wall/?layout=cd-blur', { viewport: { width, height: 700 } })
        try {
            await page.locator('.wall-tile').first().waitFor()
            await page.getByRole('button', { name: 'Offline use' }).click()
            // the banner of a new version, as offline.js makes it
            await page.evaluate(() => {
                const button = document.createElement('button')
                button.id = 'update-banner'
                button.className = 'update-banner'
                button.textContent = 'A new version is available. Reload'
                document.body.append(button)
            })
            const found = await page.evaluate(() => {
                const out = []
                const inside = (selector, label) => {
                    const rect = document.querySelector(selector).getBoundingClientRect()
                    if (rect.left < 0 || rect.right > innerWidth) out.push(`${label} is outside the window (${Math.round(rect.left)}..${Math.round(rect.right)})`)
                }
                inside('#offline-panel', 'the offline panel')
                inside('#update-banner', 'the update banner')
                for (const id of ['wall-filter', 'wall-sort', 'wall-group', 'wall-layout']) inside('#' + id, id)
                if (document.documentElement.scrollWidth > innerWidth) out.push('the page scrolls sideways')
                return out
            })
            assert.deepEqual(found, [], `${width} px wide`)
        } finally { await close() }
    }
})

test('modern: title, artist with the colours, the cover, two columns of tracks and the details at the right', async () => {
    const { page, close } = await open(`?layout=modern#${LUX}`, { viewport: { width: 700, height: 1100 } })
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.waitForFunction(() => document.getElementById('album-cover').naturalWidth > 0)
        const look = await page.evaluate(() => {
            const rect = selector => document.querySelector(selector).getBoundingClientRect()
            const labels = [...document.querySelectorAll('.album-footer-info .footer-item')]
                .map(item => getComputedStyle(item, '::before').content)
            return {
                columns: getComputedStyle(document.getElementById('track-list')).columnCount,
                title: rect('#album-name'), artist: rect('#album-artist'), colors: rect('#album-colors'),
                cover: rect('.album-cover-wrapper'), tracks: rect('#track-list'), footer: rect('.album-footer-info'),
                labels
            }
        })
        assert.equal(look.columns, '2')
        // top to bottom: title, artist and colours on one row, cover, then tracks and details side by side
        assert.ok(look.title.bottom <= look.artist.top + 1)
        assert.ok(Math.abs((look.artist.top + look.artist.bottom) / 2 - (look.colors.top + look.colors.bottom) / 2) < 6, 'the colours are level with the artist')
        assert.ok(look.colors.left > look.artist.right, 'the colours are at the right')
        assert.ok(look.artist.bottom <= look.cover.top + 1 && look.cover.bottom <= look.tracks.top + 1)
        assert.ok(look.footer.left >= look.tracks.right - 1, 'the details are beside the tracks, at the right')
        assert.ok(Math.abs(look.footer.top - look.tracks.top) < 2)
        assert.deepEqual(look.labels, ['"Music Label"', '"Release Year"', '"Genre"', '"Album Length"'])
    } finally { await close() }
})

test('the track lengths come from MusicBrainz, and the album length shows in modern only', async () => {
    const { page, close } = await open(`?layout=modern#${ABBEY}`, { viewport: { width: 700, height: 1100 } })
    try {
        await poster(page).title.getByText('Abbey Road').waitFor()
        // 3 tracks: 200 s on the track, 100 s on each recording
        assert.deepEqual(await page.locator('#track-list li').evaluateAll(items => items.map(li => li.dataset.length)), ['3:20', '1:40', '1:40'])
        const length = page.locator('.footer-length')
        await length.waitFor()
        assert.equal(await page.locator('#album-length').textContent(), '6 min 40 sec')
        assert.equal(await length.evaluate(el => getComputedStyle(el, '::before').content), '"Album Length"')
        assert.equal(await length.evaluate(el => getComputedStyle(el).order), '-1')

        await page.goto(`${base}?layout=classic#${ABBEY}`)
        await poster(page).title.getByText('Abbey Road').waitFor()
        assert.equal(await page.locator('.footer-length').isHidden(), true, 'other layouts do not show it')
    } finally { await close() }
})

test('festival has no colour blocks, and the other layouts that show them still do', async () => {
    for (const [layout, shown] of [['festival', false], ['classic', true]]) {
        const { page, close } = await open(`?layout=${layout}#${LUX}`)
        try {
            await poster(page).title.getByText('LUX').waitFor()
            await page.waitForFunction(() => document.querySelector('#album-colors .album-color'))
            assert.equal(await page.locator('#album-colors').isVisible(), shown, layout)
        } finally { await close() }
    }
})

// ---------- The navigation at the side ----------

test('on a wide landscape screen the navigation is a column at the right and the poster gets the height', async () => {
    const { page, close } = await open(`#${LUX}`, { viewport: { width: 1280, height: 800 } })
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const look = await page.evaluate(() => {
            const rect = selector => document.querySelector(selector).getBoundingClientRect()
            const header = rect('.site-header')
            const controls = [...document.querySelectorAll('.site-header .header-control')].map(el => el.getBoundingClientRect())
            return {
                position: getComputedStyle(document.querySelector('.site-header')).position,
                header, poster: rect('#album-container'), footer: rect('footer'),
                tops: controls.map(r => Math.round(r.top)),
                lefts: controls.map(r => Math.round(r.left)),
                labels: [...document.querySelectorAll('.site-header .control-label')].map(el => el.offsetParent !== null && el.textContent.trim()),
                scrollWidth: document.documentElement.scrollWidth
            }
        })
        assert.equal(look.position, 'fixed')
        assert.equal(Math.round(look.header.right), 1280, 'at the right edge')
        assert.equal(Math.round(look.header.top), 0)
        assert.equal(Math.round(look.header.bottom), 800, 'the whole height')
        assert.ok(look.header.width < 300, 'a narrow column')
        // one under the other, in order from top to bottom; only previous, next and random share a row
        assert.deepEqual([...look.tops].sort((a, b) => a - b), look.tops, 'in order, top to bottom')
        assert.equal(look.tops.length - new Set(look.tops).size, 2, 'three buttons on one row, all others on a row of their own')
        assert.ok(look.tops.length >= 8)
        // the poster is next to the column, not under it, and starts near the top of the window
        assert.ok(look.poster.right <= look.header.left, 'the poster is beside the column')
        assert.ok(look.poster.top < 40, `the poster starts at the top: ${look.poster.top}`)
        assert.equal(look.labels.filter(Boolean).length, look.labels.length - 3, 'the buttons have a name next to the icon, except the three that share a row')
        assert.ok(look.footer.left >= look.header.left && look.footer.bottom <= 800, 'the credit is in the column, at the bottom')
        assert.ok(look.scrollWidth <= 1280)
    } finally { await close() }
})

test('the poster is as high as the window allows: only the page padding is kept free, not a header', async () => {
    const { page, close } = await open(`#${LUX}`, { viewport: { width: 1280, height: 1100 } })
    try {
        await poster(page).title.getByText('LUX').waitFor()
        // classic is about 1.85 times as high as wide: the width follows from the height under 2 rem of padding.
        // Under a header (6.5 rem) the poster would have been (1100 - 104) / 1.85 = 538 px wide.
        const width = await page.evaluate(() => document.getElementById('album-container').getBoundingClientRect().width)
        assert.ok(width > 560 && width <= 800, `${width}`)
    } finally { await close() }
})

test('in a portrait window, and on a narrow one, the header stays on top without names next to the icons', async () => {
    for (const viewport of [{ width: 800, height: 1100 }, { width: 880, height: 700 }, { width: 375, height: 812 }]) {
        const { page, close } = await open(`#${LUX}`, { viewport })
        try {
            await poster(page).title.getByText('LUX').waitFor()
            const look = await page.evaluate(() => ({
                position: getComputedStyle(document.querySelector('.site-header')).position,
                labels: [...document.querySelectorAll('.site-header .control-label')].filter(el => el.offsetParent !== null).length,
                headerBottom: document.querySelector('.site-header').getBoundingClientRect().bottom,
                posterTop: document.getElementById('album-container').getBoundingClientRect().top
            }))
            assert.notEqual(look.position, 'fixed', `${viewport.width}×${viewport.height}`)
            assert.equal(look.labels, 0)
            assert.ok(look.posterTop >= look.headerBottom - 1, 'the poster is under the header')
        } finally { await close() }
    }
})

test('in the column the panels open to the left and stay inside the window, also the tall PDF panel on a low window', async () => {
    for (const height of [800, 600]) {
        const { page, close } = await open(`#${LUX}`, { viewport: { width: 1280, height } })
        try {
            await poster(page).title.getByText('LUX').waitFor()
            await page.getByRole('button', { name: 'Export' }).click()
            await page.getByLabel('File type').selectOption('pdf')
            // the panel grew; it is moved up to fit as soon as the browser has noticed
            await page.waitForFunction(h => document.getElementById('export-panel').getBoundingClientRect().bottom <= h, height, { timeout: 3000 })
            const box = await page.locator('#export-panel').boundingBox()
            const column = await page.locator('.site-header').boundingBox()
            assert.ok(box.x + box.width <= column.x + 1, `the panel is left of the column (${height})`)
            assert.ok(box.y >= 0 && box.y + box.height <= height + 1, `the panel is inside the window (${height})`)
            // the buttons at the bottom of the panel can be used
            await page.getByRole('button', { name: 'Download' }).scrollIntoViewIfNeeded()
            const download = await page.getByRole('button', { name: 'Download' }).boundingBox()
            assert.ok(download.y >= 0 && download.y + download.height <= height, `Download is on screen (${height})`)
        } finally { await close() }
    }
})

test('the credit for the sources is small and quiet, without a band of its own', async () => {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
        const { page, close } = await open(`#${LUX}`, { viewport })
        try {
            await poster(page).title.getByText('LUX').waitFor()
            const look = await page.evaluate(() => {
                const footer = document.querySelector('footer')
                const style = getComputedStyle(footer)
                return { size: parseFloat(style.fontSize), background: style.backgroundColor, text: footer.textContent.trim().replace(/\s+/g, ' '), links: footer.querySelectorAll('a').length }
            })
            assert.ok(look.size <= 11.2, `small: ${look.size}px`)
            assert.equal(look.background, 'rgba(0, 0, 0, 0)')
            assert.equal(look.links, 2)
            assert.match(look.text, /MusicBrainz.*Cover Art Archive/)
        } finally { await close() }
    }
})

test('in the column the style menu has the name "Style" above it, and room under it', async () => {
    const { page, close } = await open(`#${LUX}`, { viewport: { width: 1280, height: 800 } })
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const look = await page.evaluate(() => {
            const rect = selector => document.querySelector(selector).getBoundingClientRect()
            const label = document.querySelector('.field-label')
            return {
                visible: label.offsetParent !== null, text: label.textContent.trim(),
                label: rect('.field-label'), select: rect('#layout-select'), search: rect('#album-search'), next: rect('#prev-button')
            }
        })
        assert.equal(look.visible, true)
        assert.equal(look.text, 'Style')
        assert.ok(look.label.bottom <= look.select.top + 1, 'the name is above the select')
        assert.ok(look.search.bottom < look.label.top, 'and under the search box')
        const gap = look.next.top - look.select.bottom
        assert.ok(gap >= 12, `room under the select: ${gap}px`)
        // still found by its accessible name
        assert.equal(await page.getByLabel('Poster layout').count(), 1)
    } finally { await close() }

    // the header on top has no such name: there the select is a control like the others
    const top = await open(`#${LUX}`, { viewport: { width: 1000, height: 1400 } })
    try {
        await poster(top.page).title.getByText('LUX').waitFor()
        assert.equal(await top.page.locator('.field-label').isHidden(), true)
    } finally { await top.close() }
})

test('in the column previous, next and random are on one row, compact, with only an icon', async () => {
    const { page, close } = await open(`#${LUX}`, { viewport: { width: 1280, height: 800 } })
    try {
        await poster(page).title.getByText('LUX').waitFor()
        const look = await page.evaluate(() => {
            const buttons = ['prev-button', 'next-button', 'shuffle-button'].map(id => document.getElementById(id))
            const rects = buttons.map(b => b.getBoundingClientRect())
            return {
                tops: rects.map(r => Math.round(r.top)), lefts: rects.map(r => r.left), widths: rects.map(r => r.width),
                text: buttons.map(b => b.innerText.trim()),
                names: buttons.map(b => b.getAttribute('aria-label')),
                wall: document.querySelector('#wall-link, a[aria-label="Wall: all albums"]').getBoundingClientRect().top,
                bottom: Math.max(...rects.map(r => r.bottom)), select: document.getElementById('layout-select').getBoundingClientRect().bottom
            }
        })
        assert.equal(new Set(look.tops).size, 1, 'on one row')
        assert.ok(look.lefts[0] < look.lefts[1] && look.lefts[1] < look.lefts[2], 'previous, next, random, from left to right')
        assert.deepEqual(look.text, ['', '', ''], 'only an icon')
        assert.deepEqual(look.names, ['Previous album', 'Next album', 'Random album'], 'still with a name for screen readers')
        assert.ok(look.widths.every(width => width < 80), 'compact')
        assert.ok(look.tops[0] > look.select, 'under the style menu')
        assert.ok(look.wall > look.bottom, 'and above the wall button')
    } finally { await close() }
})

// ---------- Keyboard focus ----------

// Tabs through the page and gives, for every element that gets focus, how its focus ring looks
const focusRings = async (page, steps) => {
    const rings = []
    for (let i = 0; i < steps; i++) {
        await page.keyboard.press('Tab')
        rings.push(await page.evaluate(() => {
            const element = document.activeElement
            const style = getComputedStyle(element)
            return {
                name: element.getAttribute('aria-label') || element.id || element.tagName,
                width: parseFloat(style.outlineWidth), style: style.outlineStyle, color: style.outlineColor,
                background: getComputedStyle(document.body).backgroundColor
            }
        }))
    }
    return rings
}

for (const [theme, ring] of [['light', 'rgb(10, 88, 202)'], ['dark', 'rgb(138, 180, 255)']]) {
    test(`keyboard focus: every control gets a clear blue ring that contrasts with the page, ${theme} theme`, async () => {
        const { contrastRatio } = await import('../../scripting/colors.js')
        const channels = text => text.match(/[\d.]+/g).slice(0, 3).map(Number)
        for (const path of [`?theme=${theme}#${LUX}`, `wall/?theme=${theme}`]) {
            const { page, close } = await open(path, { viewport: { width: 1280, height: 800 } })
            try {
                await page.locator('#album-container .album-name, .wall-tile').first().waitFor()
                const rings = await focusRings(page, 9)
                assert.ok(new Set(rings.map(item => item.name)).size >= 6, 'it moves through the controls')
                for (const item of rings) {
                    assert.equal(item.style, 'solid', item.name)
                    assert.ok(item.width >= 3, `${item.name} ring is ${item.width}px`)
                    assert.equal(item.color, ring, `${item.name} in ${path}`)
                    assert.ok(contrastRatio(channels(item.color), channels(item.background)) >= 3, `${item.name} contrast against the page`)
                }
            } finally { await close() }
        }
    })
}

test('keyboard focus: the fields in a panel have the ring too, and a mouse click does not show one', async () => {
    const { page, close } = await open(`?theme=light#${LUX}`, { viewport: { width: 1280, height: 800 } })
    try {
        await poster(page).title.getByText('LUX').waitFor()
        await page.getByRole('button', { name: 'Export' }).click()
        await page.keyboard.press('Tab') // from the file type select, to the next one
        await page.keyboard.press('Tab')
        const ring = await page.evaluate(() => {
            const style = getComputedStyle(document.activeElement)
            return { tag: document.activeElement.tagName, color: style.outlineColor, width: parseFloat(style.outlineWidth) }
        })
        assert.equal(ring.color, 'rgb(10, 88, 202)')
        assert.ok(ring.width >= 3)

        // a click on a button is not keyboard focus: no ring
        await page.locator('#theme-toggle').click()
        const clicked = await page.evaluate(() => ({ matches: document.activeElement.matches(':focus-visible'), width: getComputedStyle(document.activeElement).outlineWidth }))
        assert.equal(clicked.matches, false)
    } finally { await close() }
})

test('the page opens with the focus on the Style menu, and the arrow keys go through the styles', async () => {
    const { page, close } = await open(`#${LUX}`, { viewport: { width: 1280, height: 800 } })
    try {
        await poster(page).title.getByText('LUX').waitFor()
        assert.equal(await page.evaluate(() => document.activeElement.id), 'layout-select')
        assert.equal(await page.evaluate(() => document.activeElement.matches(':focus-visible')), true, 'with a ring, so that it can be seen')
        assert.equal(await page.locator('#album-container').getAttribute('data-layout'), 'classic')

        await page.keyboard.press('ArrowDown')
        assert.equal(await page.locator('#album-container').getAttribute('data-layout'), 'modern') // the next one in the menu
        assert.equal(new URL(page.url()).searchParams.get('layout'), 'modern')
        await page.keyboard.press('ArrowDown')
        assert.equal(await page.locator('#album-container').getAttribute('data-layout'), 'minimal')
        await page.keyboard.press('ArrowUp')
        assert.equal(await page.locator('#album-container').getAttribute('data-layout'), 'modern')
        // left and right still belong to the select, not to previous and next album
        const id = await currentId(page)
        await page.keyboard.press('ArrowRight')
        assert.equal(await currentId(page), id)
    } finally { await close() }

    // no header, no focus on it
    for (const query of ['?controls=false', '?display=true']) {
        const hidden = await open(`${query}#${LUX}`)
        try {
            await poster(hidden.page).title.getByText('LUX').waitFor()
            assert.notEqual(await hidden.page.evaluate(() => document.activeElement.id), 'layout-select', query)
        } finally { await hidden.close() }
    }
})
