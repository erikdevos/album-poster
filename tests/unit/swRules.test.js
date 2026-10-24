import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { CACHES, LIMITS, SHELL, classify, cacheFor } from '../../scripting/swRules.js'

const SITE = 'https://erikdevos.github.io/album-poster/'
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const kind = (url, scope = SITE, method) => classify(url, scope, method)

test('the app files are "code", on the site root and in a subfolder', () => {
    assert.equal(kind(`${SITE}`), 'code')
    assert.equal(kind(`${SITE}?layout=cd`), 'code')
    assert.equal(kind(`${SITE}scripting/main.js`), 'code')
    assert.equal(kind(`${SITE}wall/`), 'code')
    assert.equal(kind(`${SITE}data/albums.json`), 'code')
    assert.equal(kind('http://localhost:8000/styles/style.css', 'http://localhost:8000/'), 'code')
})

test('prepared details have their own rule', () => {
    assert.equal(kind(`${SITE}data/details/bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0.json`), 'details')
})

test('the admin, the api and the worker itself are left alone, and so is everything but a GET', () => {
    assert.equal(kind(`${SITE}admin/`), null)
    assert.equal(kind(`${SITE}api/albums`), null)
    assert.equal(kind(`${SITE}sw.js`), null)
    assert.equal(kind(`${SITE}scripting/main.js`, SITE, 'POST'), null)
    assert.equal(kind('https://erikdevos.github.io/other-site/x.js'), null) // another site on the same host
})

test('small and middle covers are kept, the originals and the JSON are not', () => {
    assert.equal(kind('https://coverartarchive.org/release-group/bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0/front-250'), 'thumb')
    assert.equal(kind('https://ia800000.us.archive.org/1/items/mbid-x/mbid-x-12345-250.jpg'), 'thumb')
    assert.equal(kind('https://coverartarchive.org/release-group/bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0/front-1200'), 'cover')
    assert.equal(kind('https://ia800000.us.archive.org/1/items/mbid-x/mbid-x-12345-1200.jpg'), 'cover')
    assert.equal(kind('https://archive.org/download/mbid-x/mbid-x-12345-500.png'), 'cover')
    assert.equal(kind('https://archive.org/download/mbid-x/mbid-x-12345.jpg'), null) // the original
    assert.equal(kind('https://coverartarchive.org/release-group/bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0'), null) // the JSON
    assert.equal(kind('https://notarchive.org/x-250.jpg'), null)
    assert.equal(kind('https://evilarchive.org/x-250.jpg'), null)
})

test('the fonts are kept, and MusicBrainz is not (the albums are kept by the page)', () => {
    assert.equal(kind('https://fonts.googleapis.com/css2?family=Roboto'), 'font-css')
    assert.equal(kind('https://fonts.gstatic.com/s/roboto/v30/x.woff2'), 'font-file')
    assert.equal(kind('https://musicbrainz.org/ws/2/release-group?query=x'), null)
})

test('every kind goes to a cache, and the covers are limited', () => {
    for (const name of ['code', 'details', 'thumb', 'cover', 'font-css', 'font-file']) {
        assert.ok(Object.values(CACHES).includes(cacheFor(name)), name)
    }
    assert.equal(cacheFor('nonsense'), null)
    assert.ok(LIMITS.thumbs > LIMITS.covers)
})

test('the list of files to keep ready has every page, script and style of the app, and nothing that does not exist', async () => {
    // the admin is only for this computer, and albumData.js is only used by the admin and its server
    const notInTheApp = new Set(['admin.js', 'albumData.js', 'admin.css'])
    const listed = new Set(SHELL)
    const folders = { 'scripting/': await readdir(`${ROOT}scripting`), 'styles/': await readdir(`${ROOT}styles`), 'scripting/sources/': await readdir(`${ROOT}scripting/sources`) }
    for (const [folder, names] of Object.entries(folders)) {
        for (const name of names.filter(name => /\.(js|css)$/.test(name) && !notInTheApp.has(name))) {
            assert.ok(listed.has(folder + name), `${folder}${name} is not in SHELL (sw.js keeps it ready for offline use)`)
        }
    }
    for (const path of SHELL.filter(path => !path.endsWith('/'))) {
        await access(ROOT + path).catch(() => assert.fail(`${path} is in SHELL but does not exist`))
    }
})
