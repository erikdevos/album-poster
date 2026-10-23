View deployed at:
https://erikdevos.github.io/album-poster/

## Run locally

The app uses ES modules and `fetch`, so it needs a web server (opening `index.html` directly fails):

```
python3 -m http.server 8000
```

Then open http://localhost:8000. There is no build step: the styles are plain CSS in `styles/style.css`.

## Data

Album data comes from [MusicBrainz](https://musicbrainz.org/) (title, artist, year, label, genres, tracks) and the [Cover Art Archive](https://coverartarchive.org/) (covers). Both allow browser requests (CORS), including for the image files, so no proxy is needed and the colour palette can be read from the cover.

All data access sits behind two functions in `scripting/source.js`: `searchAlbums(query)` and `getAlbum(id)`. The MusicBrainz implementation is in `scripting/sources/musicbrainz.js` and can be replaced by another source with the same interface. MusicBrainz allows about one request per second; the source queues its requests and retries on a 503.

`data/albums.json` is the curated list: `id` is the MusicBrainz release-group id, `audiodbId` the id the app used before, so old links keep working. `scripts/migrate-albums.mjs` was used for the one-off conversion.

## Search

The header has a search box (an ARIA combobox: arrow keys, Enter, Escape) and a random album button. Searching goes through MusicBrainz: every word has to match the album or the artist, the last one as a prefix while you type. MusicBrainz has no popularity, so hits are ranked by their relevance score plus the number of releases of the album, which puts well-known albums first. Compilations, live albums, remixes and the like are left out. Empty, the box suggests the albums you viewed last (kept in this browser only) and the curated list.

## Export, print and share

Under the poster are three buttons (hidden with `?controls=false`):

- **Download PNG** renders the poster at 2400px wide (at most five times its size on screen), named "Artist - Album.png". It uses [html-to-image](https://github.com/bubkoo/html-to-image) 1.11.13, loaded from jsDelivr only when someone exports. The cover must come from a source with CORS headers, which is why the Cover Art Archive works here. The browser tab must be visible while exporting; a hidden tab pauses until you come back.
- **Print** prints one poster on an A4 page, always in the light theme, without header, buttons or footer (`@media print` in `styles/style.css`). Turn on "background graphics" in the print dialog if you use `?colors=cover`. A poster with a very long tracklist can run over to a second page.
- **Share link** opens the share sheet where the browser has one, otherwise it copies the link (and as a last resort shows it, to copy by hand).

## Layout

The poster is a size container and all measurements inside it are relative to its width, so it scales as one piece. On landscape screens its width follows the viewport height, so the poster stays in view (never narrower than 480px, then the page scrolls). On portrait screens and phones it fills the width and the page scrolls. Long titles, artists and tracklists get a smaller type size, and a poster without back cover gives the tracklist the full width.

## URL Parameters

### Loading Specific Albums
Use the hash to load a specific album by its MusicBrainz release-group id. Without a hash a random album is shown. Use the search box to find any album: picking a result puts its id in the URL, so every poster has a link you can share. Without a hash a random album is shown, and its id is put in the URL.
```
#album-id
```

Examples:
- `#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0` - Loads Rosalia's LUX album
- `#2110671` - Old TheAudioDB id of Rihanna's Rated R, still redirected to the new id

### Additional Options
Add query parameters before the hash:

- `?controls=false` - Hides the header with search and the random button, for showing the poster on a screen
- `?size=l` - Sets large poster size
- `?size=m` - Sets medium poster size
- `?size=s` - Sets small poster size
- `?theme=dark` - Sets dark theme (black background, white text)
- `?theme=light` - Sets light theme (light background, black text)
- Without `theme` the page follows the system light/dark setting
- `?colors=cover` - Takes the poster colours from the cover (background, text and numbers), with a contrast check; falls back to the classic look when no readable combination is found

#### Combined Examples:
- `?controls=false#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0` - Load specific album without the header
- `?size=l#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0` - Load specific album with large size
- `?theme=dark#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0` - Load specific album with dark theme
- `?size=s&theme=dark#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0` - Load specific album small size and dark theme

The older form with the options after the hash (`#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0?theme=dark`) still works.
