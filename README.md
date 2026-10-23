View deployed at:
https://erikdevos.github.io/album-poster/

## Run locally

The app uses ES modules and `fetch`, so it needs a web server (opening `index.html` directly fails):

```
npm start
```

Then open http://localhost:8000 (this runs `python3 -m http.server 8000`; any static server will do). There is no build step: the styles are plain CSS in `styles/style.css`.

## Tests

```
npm install
npm test            # unit tests, no browser needed
npm run test:e2e    # browser tests
```

- **Unit tests** (`tests/unit`) use the test runner built into Node 22 and have no dependencies. They cover the URL router, the MusicBrainz source (search query, ranking, retries, fallbacks, with a fake `fetch`), the colour picking, the type size rules and the integrity of `data/albums.json`.
- **Browser tests** (`tests/e2e`) drive the installed Chrome through `playwright-core` (no browser download; set `CHROME_PATH` to use another one). The site is served from this folder and MusicBrainz and the Cover Art Archive are replaced by fixtures, so the tests are quick and do not depend on them. They check loading from the hash, search with mouse and keyboard, the old numeric links, error recovery, layouts, URL options, cover colours, no sideways scroll on a phone in every layout, and the PNG download (the last one is skipped when jsDelivr cannot be reached).

## Deploy

`.github/workflows/ci.yml` runs both test suites on every pull request and on every push to a branch other than `main`. `.github/workflows/pages.yml` runs them on `main` and, when they pass, publishes `index.html`, `scripting`, `styles` and `data` to GitHub Pages. For that to work, set **Settings > Pages > Source** to **GitHub Actions** once.

## Data

Album data comes from [MusicBrainz](https://musicbrainz.org/) (title, artist, year, label, genres, tracks) and the [Cover Art Archive](https://coverartarchive.org/) (covers). Both allow browser requests (CORS), including for the image files, so no proxy is needed and the colour palette can be read from the cover.

All data access sits behind two functions in `scripting/source.js`: `searchAlbums(query)` and `getAlbum(id)`. The MusicBrainz implementation is in `scripting/sources/musicbrainz.js` and can be replaced by another source with the same interface. MusicBrainz allows about one request per second; the source queues its requests and retries on a 503.

`data/albums.json` is the curated list: `id` is the MusicBrainz release-group id, `audiodbId` the id the app used before, so old links keep working. `scripts/migrate-albums.mjs` was used for the one-off conversion.

## Search

The header has a search box (an ARIA combobox: arrow keys, Enter, Escape) and a random album button. Searching goes through MusicBrainz: every word has to match the album or the artist, the last one as a prefix while you type. MusicBrainz has no popularity, so hits are ranked by their relevance score plus the number of releases of the album, which puts well-known albums first. Compilations, live albums, remixes and the like are left out. Empty, the box suggests the albums you viewed last (kept in this browser only) and the curated list.

### Layouts

All layouts use the same markup and data, so colours (`?colors=cover`), theme, export and print work with each of them.

- **classic**: the framed poster with the full width cover, rules between the sections and the tracklist in columns.
- **minimal**: no frame, a lot of white space, light type, a plain tracklist and the artist with small colour dots. The back cover is left out.
- **swiss**: a 12 column grid with the artist on top, a very large title and the tracklist beside the cover. On a narrow poster the tracklist moves below the cover.

A layout is a block of CSS keyed on `data-layout` in `styles/style.css`, plus its name in `LAYOUTS` in `scripting/displayOptions.js` and an option in `index.html`. `--poster-ratio` (height divided by width) tells the landscape fitting and nothing else, so set it to what the layout needs.

## Export, print and share

Under the poster are three buttons (hidden with `?controls=false`):

- **Download PNG** renders the poster at 2400px wide (at most five times its size on screen), named "Artist - Album.png". It uses [html-to-image](https://github.com/bubkoo/html-to-image) 1.11.13, loaded from jsDelivr only when someone exports. The cover must come from a source with CORS headers, which is why the Cover Art Archive works here. The browser tab must be visible while exporting; a hidden tab pauses until you come back.
- **Print** prints one poster on an A4 page, always in the light theme, without header, buttons or footer (`@media print` in `styles/style.css`). Turn on "background graphics" in the print dialog if you use `?colors=cover`. A poster with a very long tracklist can run over to a second page.
- **Share link** opens the share sheet where the browser has one, otherwise it copies the link (and as a last resort shows it, to copy by hand).

## Light and dark

The switch in the header (sun or moon) flips between light and dark. Until you use it the page follows the system setting, also when that changes. A choice is remembered in this browser. `?theme=light|dark` in the URL wins over it, and when the URL has a theme the switch updates it, so a shared link shows what is on screen. A small script in `index.html` sets the theme before the first paint to avoid a flash of the wrong one. Printing is always light.

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
- `?layout=classic|minimal|swiss` - The look of the poster (classic is the default); the header has a menu that changes the URL too
- `?size=l` - Sets large poster size
- `?size=m` - Sets medium poster size
- `?size=s` - Sets small poster size
- `?theme=dark` - Sets dark theme (black background, white text)
- `?theme=light` - Sets light theme (light background, black text)
- Without `theme` the page uses the choice made with the light/dark switch in the header, and without such a choice the system setting
- `?colors=cover` - Takes the poster colours from the cover (background, text and numbers), with a contrast check; falls back to the classic look when no readable combination is found

#### Combined Examples:
- `?controls=false#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0` - Load specific album without the header
- `?size=l#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0` - Load specific album with large size
- `?theme=dark#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0` - Load specific album with dark theme
- `?size=s&theme=dark#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0` - Load specific album small size and dark theme

The older form with the options after the hash (`#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0?theme=dark`) still works.
