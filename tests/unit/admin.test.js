// The admin server, started on a free port with a copy of the list in a temporary folder
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAdminServer } from '../../scripts/admin.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const A = 'bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0'
const B = '02a544b3-0459-42c7-bd9c-047162e7b67a'

let folder, albumsPath, admin, base, host

before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'album-admin-'))
    albumsPath = join(folder, 'albums.json')
    await writeFile(albumsPath, JSON.stringify([{ id: A, name: 'LUX', artist: 'Rosalia' }]))
    admin = createAdminServer({ root: ROOT, albumsPath })
    const port = await admin.listen(0)
    host = `127.0.0.1:${port}`
    base = `http://${host}`
})

after(async () => {
    await admin.close()
    await rm(folder, { recursive: true, force: true })
})

const put = (body, headers = {}) => fetch(`${base}/api/albums`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
})

test('the list is read from the file', async () => {
    const response = await fetch(`${base}/api/albums`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), [{ id: A, name: 'LUX', artist: 'Rosalia' }])
})

test('a valid list is written to the file, formatted like the original', async () => {
    const response = await put([{ id: A, name: 'LUX', artist: 'Rosalia' }, { id: B, name: 'Hit Me Hard and Soft', artist: 'Billie Eilish', extra: 1 }])
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { saved: 2 })
    const text = await readFile(albumsPath, 'utf8')
    assert.ok(text.endsWith(']\n'))
    assert.deepEqual(JSON.parse(text).map(album => album.name), ['LUX', 'Hit Me Hard and Soft'])
    assert.equal(text.includes('extra'), false)
})

test('an invalid list is refused and the file stays as it was', async () => {
    const before = await readFile(albumsPath, 'utf8')
    for (const body of [[{ id: 'bad', name: 'x', artist: 'y' }], [{ id: A, name: '', artist: 'y' }], '{nope']) {
        const response = await put(body)
        assert.equal(response.status, 400)
        assert.ok((await response.json()).error)
    }
    assert.equal(await readFile(albumsPath, 'utf8'), before)
})

test('a write from another site, or not as JSON, is refused', async () => {
    const before = await readFile(albumsPath, 'utf8')
    assert.equal((await put([], { origin: 'https://evil.example' })).status, 403)
    assert.equal((await fetch(`${base}/api/albums`, { method: 'PUT', body: '[]', headers: { 'content-type': 'text/plain', origin: base } })).status, 415)
    assert.equal((await fetch(`${base}/api/albums`, { method: 'PUT', body: '[]', headers: { 'content-type': 'application/json' } })).status, 403)
    assert.equal(await readFile(albumsPath, 'utf8'), before)
})

test('a request for another host name (DNS rebinding) is refused', async () => {
    // fetch does not let a script choose the Host header, so this is a raw request
    const { request } = await import('node:http')
    const status = await new Promise(resolve => {
        const raw = request({ host: '127.0.0.1', port: Number(host.split(':')[1]), path: '/api/albums', headers: { host: 'evil.example' } },
            res => { res.resume(); resolve(res.statusCode) })
        raw.end()
    })
    assert.equal(status, 403)
})

test('only the admin page and what it imports are served', async () => {
    assert.equal((await fetch(`${base}/admin/`)).status, 200)
    assert.match(await (await fetch(`${base}/admin/`)).text(), /Album list/)
    assert.equal((await fetch(`${base}/scripting/albumData.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8')
    assert.equal((await fetch(`${base}/package.json`)).status, 404)
    assert.equal((await fetch(`${base}/.git/config`)).status, 404)
    assert.equal((await fetch(`${base}/node_modules/playwright-core/package.json`)).status, 404)
    assert.equal((await fetch(`${base}/admin/..%2f..%2fpackage.json`)).status, 404)
    assert.equal((await fetch(`${base}/api/other`)).status, 404)
})

test('the server listens on this computer only', () => {
    assert.equal(admin.server.address().address, '127.0.0.1')
})
