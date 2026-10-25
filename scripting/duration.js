// Track and album lengths. MusicBrainz gives a length in milliseconds. Pure functions, no DOM.

const pad = value => String(value).padStart(2, '0')

// "3:45", or "1:02:03" from an hour on; '' when the length is not known
export function formatTrackLength(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return ''
    const total = Math.round(ms / 1000)
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = total % 60
    return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

// The length of the whole album, in milliseconds. Only when every track has a length: a sum over
// some of the tracks would be wrong without saying so, so then it is null.
export function albumLength(tracks) {
    if (!tracks?.length) return null
    let total = 0
    for (const track of tracks) {
        if (!Number.isFinite(track.length) || track.length <= 0) return null
        total += track.length
    }
    return total
}

// "41 min 46 sec", or "1 h 2 min" from an hour on (the seconds do not matter then)
export function formatAlbumLength(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return ''
    const total = Math.round(ms / 1000)
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = total % 60
    if (hours) return `${hours} h ${minutes} min`
    return minutes ? `${minutes} min ${seconds} sec` : `${seconds} sec`
}
