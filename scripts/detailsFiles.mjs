// The prepared details of the albums: one file per album in data/details/<id>.json, in the shape
// that albumCache.js keeps in the browser. Used by scripts/details.mjs and by the admin server.
import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { formatDetails } from '../scripting/albumData.js'

export const detailsDir = root => join(root, 'data', 'details')

export async function writeDetails(root, id, record) {
    const text = formatDetails(record, id) // throws when it is not valid
    await mkdir(detailsDir(root), { recursive: true })
    const file = join(detailsDir(root), `${id}.json`)
    await writeFile(`${file}.tmp`, text)
    await rename(`${file}.tmp`, file)
}

// The ids that have a file, with when they were fetched
export async function listDetails(root) {
    let names = []
    try {
        names = await readdir(detailsDir(root))
    } catch {
        return new Map()
    }
    const found = new Map()
    for (const name of names.filter(name => name.endsWith('.json'))) {
        try {
            const record = JSON.parse(await readFile(join(detailsDir(root), name), 'utf8'))
            found.set(name.slice(0, -'.json'.length), record.fetchedAt ?? 0)
        } catch {
            // a broken file counts as missing, and is written again
        }
    }
    return found
}

// Removes the files of albums that are no longer in the list; returns the ids that went
export async function pruneDetails(root, keepIds) {
    const keep = new Set(keepIds)
    const gone = [...(await listDetails(root)).keys()].filter(id => !keep.has(id))
    await Promise.all(gone.map(id => rm(join(detailsDir(root), `${id}.json`), { force: true })))
    return gone
}
