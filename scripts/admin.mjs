// The local admin for the curated list: a page to search MusicBrainz, preview covers, add, remove
// and rename albums, and a small server that writes data/albums.json. Only for this computer: it
// listens on 127.0.0.1 and refuses requests that did not come from its own page.
//
//   npm run admin            then open http://localhost:8001/admin/
//   PORT=9000 npm run admin  another port

import { createServer } from 'node:http'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatAlbums, validateAlbums } from '../scripting/albumData.js'

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml'
}
// The only folders that are served: the admin page and what it imports
const SERVED = ['admin', 'scripting', 'styles', 'data']
const MAX_BODY = 1_000_000

// `root` is the project folder, `albumsPath` the file that is read and written
export function createAdminServer({ root, albumsPath = join(root, 'data', 'albums.json') }) {
    let port = null
    const send = (response, status, body, type = 'application/json; charset=utf-8') => {
        response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        response.end(body)
    }
    const fail = (response, status, message) => send(response, status, JSON.stringify({ error: message }))

    const server = createServer(async (request, response) => {
        try {
            // A page on another site must not be able to talk to this server (DNS rebinding and forms):
            // the host has to be this computer, and a write has to come from the admin page itself
            const host = request.headers.host ?? ''
            if (!['localhost', '127.0.0.1'].some(name => host === `${name}:${port}`)) return fail(response, 403, 'Wrong host.')

            const { pathname } = new URL(request.url, `http://${host}`)

            if (pathname === '/api/albums') {
                if (request.method === 'GET') return send(response, 200, await readFile(albumsPath, 'utf8'))

                if (request.method === 'PUT') {
                    const origin = request.headers.origin
                    if (origin !== `http://${host}`) return fail(response, 403, 'Wrong origin.')
                    if (!(request.headers['content-type'] ?? '').startsWith('application/json')) return fail(response, 415, 'Send JSON.')

                    let body = ''
                    for await (const chunk of request) {
                        body += chunk
                        if (body.length > MAX_BODY) return fail(response, 413, 'The list is too large.')
                    }
                    let albums
                    try {
                        albums = validateAlbums(JSON.parse(body))
                    } catch (error) {
                        return fail(response, 400, error instanceof SyntaxError ? 'That is not JSON.' : error.message)
                    }
                    // written next to the file and moved over it, so a crash cannot leave half a file
                    const temporary = `${albumsPath}.tmp`
                    await writeFile(temporary, formatAlbums(albums))
                    await rename(temporary, albumsPath)
                    return send(response, 200, JSON.stringify({ saved: albums.length }))
                }
                return fail(response, 405, 'Use GET or PUT.')
            }

            if (request.method !== 'GET') return fail(response, 405, 'Use GET.')
            let path = normalize(decodeURIComponent(pathname))
            if (path.endsWith(sep) || path.endsWith('/')) path += 'index.html'
            const first = path.split(/[\\/]/).filter(Boolean)[0]
            if (!SERVED.includes(first) || path.includes('..')) return fail(response, 404, 'Not found.')
            try {
                send(response, 200, await readFile(join(root, path)), TYPES[extname(path)] ?? 'application/octet-stream')
            } catch {
                fail(response, 404, 'Not found.')
            }
        } catch (error) {
            console.error(error)
            fail(response, 500, 'Something went wrong.')
        }
    })

    return {
        server,
        listen: (wanted = 0) => new Promise(resolve => {
            server.listen(wanted, '127.0.0.1', () => { port = server.address().port; resolve(port) })
        }),
        close: () => new Promise(resolve => server.close(resolve))
    }
}

// Started from the command line (not when a test imports this file)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const admin = createAdminServer({ root: fileURLToPath(new URL('..', import.meta.url)) })
    const port = await admin.listen(Number(process.env.PORT) || 8001)
    console.log(`Album list admin: http://localhost:${port}/admin/`)
    console.log('Only reachable from this computer. Stop with Ctrl+C.')
}
