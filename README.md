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
- **Browser tests** (`tests/e2e`) drive the installed Chrome through `playwright-core` (no browser download; set `CHROME_PATH` to use another one). The site is served from this folder and MusicBrainz and the Cover Art Archive are replaced by fixtures, so the tests are quick and do not depend on them. They check loading from the hash, search with mouse and keyboard, the old numeric links, error recovery, layouts, URL options, cover colours, no sideways scroll on a phone in every layout, the PNG and PDF downloads, the wall, the admin, and the offline behaviour with a real service worker (an album that was opened comes back without a network, searching offline, the covers that are kept, the offline panel). Playwright only routes the requests of a service worker when a switch is set, which `tests/e2e/offline.test.js` does itself; the other browser tests block the worker, because it would take the requests that their fake network answers.

## Deploy

`.github/workflows/ci.yml` runs both test suites on every pull request and on every push to a branch other than `main`. `.github/workflows/pages.yml` runs them on `main` and, when they pass, publishes `index.html`, `sw.js`, `wall`, `scripting`, `styles` and `data` to GitHub Pages. For that to work, set **Settings > Pages > Source** to **GitHub Actions** once.

## Data

Album data comes from [MusicBrainz](https://musicbrainz.org/) (title, artist, year, label, genres, tracks) and the [Cover Art Archive](https://coverartarchive.org/) (covers). Both allow browser requests (CORS), including for the image files, so no proxy is needed and the colour palette can be read from the cover.

All data access sits behind two functions in `scripting/source.js`: `searchAlbums(query)` and `getAlbum(id)`. The MusicBrainz implementation is in `scripting/sources/musicbrainz.js` and can be replaced by another source with the same interface. MusicBrainz allows about one request per second; the source queues its requests and retries on a 503.

`data/albums.json` is the curated list: `id` is the MusicBrainz release-group id, `audiodbId` the id the app used before, so old links keep working. `scripts/migrate-albums.mjs` was used for the one-off conversion.

## Fast and offline

An album that was opened once is kept, so it comes up at once next time, also without a network. Three layers, from the closest to the furthest away:

1. **This browser's own copy** (`scripting/albumCache.js`, IndexedDB `album-poster`). `getAlbum` in `scripting/source.js` first looks in memory, then in IndexedDB, then at the prepared details (layer 3), and only then asks MusicBrainz. Everything that was fetched is kept: title, artist, year, label, genre, barcode, tracks and the cover addresses. A copy older than 30 days is still shown at once, also offline, and is refreshed from MusicBrainz in the background a few seconds later, so corrections arrive without making you wait. A record has a version (`SCHEMA`); bump it when the shape of an album changes and old copies are ignored. When IndexedDB is not available (some private windows) the app works as before. Searching without a connection (or when MusicBrainz does not answer) finds albums in the curated list and the albums that were opened before.
2. **The service worker** (`sw.js`, with its rules in `scripting/swRules.js`, registered as a module worker) keeps the app and the images: the pages, scripts and styles (network first, so a new version arrives at once; the copy when there is no network or it is slow, also for a URL with another query string), the prepared details (the copy at once, a fresh one for next time), the small covers of the wall (at most 600) and the covers of the posters (at most 160, the oldest go first), and the Google Fonts. The original cover files (often several megabytes) and the MusicBrainz and Cover Art Archive JSON are not kept by the worker: the JSON is in layer 1. `SHELL` in `swRules.js` is the list of files that are kept ready from the first visit; a test checks that no script or style is missing from it. It needs `https` or `localhost`, and a browser that has module workers. The first visit is not yet controlled by the worker; from the second page load on it is. The admin and `/api/` are never touched.
3. **Prepared details in the repository** (`data/details/<id>.json`, one file per album of the curated list, the same record as layer 1). The app reads these before it asks MusicBrainz, so these albums come up at once for everybody, and MusicBrainz (about one request a second, two or three per album) is not needed. Fill them with `npm run details` (only albums without a file; `-- --stale` also the files older than 30 days, `-- --all` everything, `-- --id=<id>` one album; the first run takes several minutes) and commit the files. Files of albums that are no longer in the list are removed. The admin does it for you: after Save it fetches the details of the new albums and the server keeps them, and a removed album loses its file.

**Offline panel** (the download icon on the wall): says how many albums of the list are kept in this browser and how much the site uses, downloads the details and covers of the whole list for offline use (three at a time, with a progress bar and a Stop button), and clears what was kept (the app itself and the fonts stay, so the page still opens). The export works offline as well: the library it needs (`html-to-image`, MIT) is in `scripting/vendor/` and no longer comes from a CDN.

Code: `scripting/albumCache.js`, `scripting/source.js`, `scripting/offline.js`, `scripting/swRules.js`, `sw.js`, `scripts/details.mjs`, `scripts/detailsFiles.mjs`, the details record in `scripting/albumData.js`.

## Managing the list (local admin)

`data/albums.json` can be edited by hand, but there is also a page for it that runs on this computer only:

```
npm run admin
```

Then open http://localhost:8001/admin/ (`PORT=9000 npm run admin` for another port). The page shows the list, newest first, with covers, and has:

- **Search:** the same MusicBrainz search as the app, or paste a MusicBrainz id or a link to a release group. Every result shows its cover, and a result without a cover gets a red "No cover" warning (such an album has no colours on the poster and an empty square on the wall). Add puts the album at the end of the list, which is where the newest albums are. An album that is already in the list cannot be added twice.
- **Edit and remove:** Edit changes the name and the artist (what the wall and the search show); Remove can be undone until you save. New and renamed albums are marked, and the top shows what is not saved yet ("Not saved: 2 added, 1 removed"). Revert goes back to the file.
- **Save** writes `data/albums.json` (two spaces, fields in a fixed order, a newline at the end), then fetches the details of the new albums and has the server keep them in `data/details/` (an album that was removed loses its file), after which you run `npm test` and commit both. Nothing is written before Save. If the details of an album cannot be fetched the save still stands, and `npm run details` does it later.

The server (`scripts/admin.mjs`, no dependencies) listens on 127.0.0.1 only, serves only `admin`, `scripting`, `styles` and `data`, refuses a request with another `Host` (DNS rebinding) and a write that does not come from its own page (`Origin`) as JSON, and validates the list before writing (`scripting/albumData.js`: a valid MusicBrainz id, a name and an artist, no doubles). It writes to a temporary file and moves it over the list, so a crash cannot leave half a file. The admin is not part of the site on GitHub Pages: `pages.yml` does not copy `admin` or `scripts`.

## Search

The header has a search box (an ARIA combobox: arrow keys, Enter, Escape). Next to it are the layout menu and round icon buttons: previous and next album, random album, the wall, display, export and light/dark. The buttons show only an icon; each has a name (`aria-label`) and the same text as a tooltip (`title`) for screen readers and for hovering. The search box is short; its list of results is wider than the box. On a phone the box gets its own row. Empty, the box suggests the albums you viewed last (kept in this browser only) and the curated list.

Searching goes through MusicBrainz (`searchAlbums` in `scripting/sources/musicbrainz.js`):

- Every word has to match the album or the artist, the last one as a prefix while you type ("abbey ro" works), and the whole text as a phrase counts extra, so an exact title or artist is found first.
- **Albums, EPs, singles, soundtracks and live albums** are searched, by artist or title: "tron legacy" finds the soundtrack, KATSEYE only has EPs and singles. Live albums and remix albums are searched too, so iconic ones are found; they only count as well as they are known, and recordings of a single night (released only once, or named after a date) are skipped as bootlegs. Compilations, demos and the like are left out. Soundtracks, live albums and remixes are not picked as a random album for the slideshow.
- **A loader** (a small round spinner in the box, and in the list while it says Searching) shows while a search is under way.
- **Popular first.** MusicBrainz orders by relevance only and knows nothing about popularity: for "beatles" the famous albums are not among its first hundred hits. So two searches are done at once, one for the best matches and one for albums with at least 15 releases (a famous album has been released many times), and the hits are ranked together: half the MusicBrainz score, plus 40 times the logarithm of the number of releases, plus a bonus for an exact title or artist (then all albums of that artist count as equally relevant, and the best known come first), and minus a little for an EP or a single. The weights are in `rankGroups` and are tested; "beatles" gives Rubber Soul, Sgt. Pepper, Please Please Me and Abbey Road first.
- Two searches take a little longer than one (a few seconds in a slow moment), because MusicBrainz allows about one request per second.

## Display mode and slideshow (kiosk)

For a screen that only shows the poster. Everything can be set in the URL, so a screen can be pointed at one link, or started from the **Display** menu in the header (the monitor icon).

- `?display=true` shows only the poster, as large as the screen allows: no header, no footer, no scrolling. The width follows from the real shape of the poster (a long tracklist makes it taller), measured after every album.
- `?kiosk=10` is the same, with another album every 10 seconds. `kiosk=true` means 10; the interval is between 3 and 3600 seconds.
- `source=random` takes albums from all of MusicBrainz instead of `data/albums.json`. MusicBrainz has no "random", so each time a random genre (and often a decade) is searched and an album is picked from a random page of the albums with at least 8 releases. An album without a cover is skipped. If MusicBrainz cannot be reached, the slideshow falls back to the curated list.
- The curated list is played in random order, every album once before any repeats, and never the same one twice in a row.
- `progress=false` leaves out the thin line at the bottom that fills up until the next album.
- `controls=false` also leaves out the buttons below, for a screen nobody touches.
- A mouse move, a tap or a key press shows a few buttons for three seconds: full screen, exit display mode and, with a slideshow, pause and next. The keys `F` (full screen), `Space` (pause), `N` or the right arrow (next) and `Escape` (exit) work too.

The slideshow starts with the album in the URL and then shows a new one every interval. The next album is fetched, with its cover, while the current one is on screen; the poster fades out and in. The URL follows the album on screen, so a reload carries on from there. Full screen comes from the menu or the `F` key: a browser only allows it after a click or key press, so a URL alone cannot start it. On a screen that should be full screen on its own, start the browser in kiosk mode (for example Chrome with `--kiosk URL`). While display mode is on, the page asks the screen to stay on (Screen Wake Lock, where the browser has it). When display mode was started by going full screen, leaving full screen leaves display mode too.

Code: `scripting/display.js` (mode, buttons, keys), `scripting/kiosk.js` (the slideshow), `scripting/playlist.js` (order and URL settings), `scripting/fullscreen.js`.

## Export and print

The export panel (the download icon) makes a **PNG** or a **PDF**.

- **PNG:** a width in pixels (2400, 4000 or 6000), with the dpi set to 300 in the file.
- **PDF:** a page for a printer. Instead of pixels it has print units: the **paper size** (A5 to A1, 30 × 40, 40 × 50 and 50 × 70 cm, Letter, Tabloid), the **orientation** (automatic follows the shape of the poster), the **margin** (none, 5, 10 or 20 mm), the **dpi** (150 draft, 300 print, 600 fine art), an optional **3 mm bleed** and optional **crop marks**. The poster is as large as fits inside the margin and sits in the middle; the colour of the page behind it fills the margin and the bleed. A line in the panel says what you get, for example "A3 portrait, poster 280 × 420 mm at 300 dpi, 3307 × 4961 px, 3 mm bleed, crop marks", and the file name has the paper and the dpi that were really reached. When a browser cannot draw that many pixels (a phone or Safari) the dpi is brought down, and the line and the message afterwards say so. With bleed the PDF page is 3 mm larger on every side; with crop marks there is room for a hairline mark in each corner outside the bleed (CMYK black, 5 mm long, at least 3 mm from the trim). The PDF has a `TrimBox` and a `BleedBox`, which is what print shops read. The picture is a JPEG, so a print shop gets one page with one image; text is not vector.
- The settings are remembered in this browser (`album-poster.print`).
- **Print** opens the browser's own print dialog with the same paper, orientation and margin, and the poster as wide as it is on the PDF (a style is added for the moment of printing). Bleed and crop marks are only in the PDF, a browser cannot print them. Without the panel, `Ctrl+P` prints one poster on A4 in the light theme.

Code: `scripting/printPlan.js` (the page and the pixels, pure and tested), `scripting/fileFormats.js` (`buildPdf` with and without a print page), `scripting/exportPoster.js`, `scripting/exportPanel.js` (the panel).

## Light and dark

The switch in the header (sun or moon) flips between light and dark. Until you use it the page follows the system setting, also when that changes. A choice is remembered in this browser. `?theme=light|dark` in the URL wins over it, and when the URL has a theme the switch updates it, so a shared link shows what is on screen. A small script in `index.html` sets the theme before the first paint to avoid a flash of the wrong one. Printing is always light.

## Loading and messages

Nothing that tells you what is going on takes up room in the page, so the poster never jumps (`scripting/feedback.js`):

- **A thin line along the top of the window** runs while an album loads. It shows after a fifth of a second, so a quick load does not flicker. It is left out in display mode, where the poster fades instead.
- **A small round loader on a button** that is busy: on Random while the next album comes, and on Export while a file is made.
- **A bubble at the bottom of the window** for a short message: an error ("Could not load this album...") or "Link copied". It is announced to screen readers (`role="status"`), goes away by itself and is not shown in display mode.

## Changing album: all at once, with a crossfade

When another album is picked, nothing changes on the poster until everything of the new album is there (`fetchAlbumDetails` in `scripting/albumDetails.js`):

1. the data is fetched, and the covers are loaded in the background (with a time limit of six seconds, after which the poster changes without a cover that is still not in);
2. then title, tracklist, covers and colours change in one go. Before this, the new title would stand on screen with the cover of the album before it until the new cover came in.

The change is a crossfade (`scripting/crossfade.js`). A copy of the old poster, with its own sizes, layout and colours, is laid over the real one and fades away in 0.45 seconds while the real poster already shows the new album. The copy is not clickable, hidden from screen readers and has no ids of its own. With "reduce motion" set in the system, the first album and any quick succession of changes, the poster just changes. The slideshow uses the same crossfade.

If another album is picked while one is still loading, the older one is dropped, so the last pick always wins.

## Layout

The colours of the cover are on the poster as custom properties (`--sw-vibrant`, `--sw-muted`, `--sw-darkvibrant`, `--sw-darkmuted`, `--sw-lightvibrant`, `--sw-lightmuted`; a colour the cover does not have is left out), for the layouts that print with them (riso, film, vinyl). Every track has `data-label` (A1, B3, ...) and the first of a side has `data-side-start`, and the tracklist has `--half`, for the vinyl layout. An export is drawn on the background of the poster itself when it has one (html-to-image would otherwise paint the colour of the page over it), so a dark poster on a light page keeps its colour.

The poster is a size container and all measurements inside it are relative to its width, so it scales as one piece. On landscape screens its width follows the viewport height, so the poster stays in view (never narrower than 480px, then the page scrolls). On portrait screens and phones it fills the width and the page scrolls. Long titles, artists and tracklists get a smaller type size, and a poster without back cover gives the tracklist the full width.

## The wall and browsing

`/wall/` (`wall/index.html`, a static page like the rest, so it works on GitHub Pages as it is) shows every album of `data/albums.json` as a cover in a grid, with the covers from the Cover Art Archive (`front-250`, loaded lazily). The header has a filter (every word has to be in the title or the artist; accents and ligatures do not matter, so "aenima" finds Ænima), a sort (artist, title, newest added), a switch to group by artist (a click on an artist then filters on that artist) and a slider for the size of the covers. A click on a cover opens its poster, with the `layout`, `theme` and `colors` of the wall page kept. All settings are in the URL: `?q=muse&sort=title&group=artist&size=12`. The Wall button in the header of the poster page goes the other way, again with the layout, theme and colours.

On the poster page the buttons left and right of the layout menu, and the left and right arrow keys, go to the previous and next album of the list, by artist and then by title, going round at the ends (not while typing in a field, and not in display mode, where the arrow keys belong to the slideshow). An album found with the search box that is not in the list has no neighbours. On a phone the two buttons are left out for lack of room; the wall is there for that.

Code: `scripting/wallList.js` (filter, sort, group, neighbours, URL settings; pure and tested), `scripting/wall.js` (the page), `scripting/browse.js` (previous and next), `styles/wall.css`.

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

- `?controls=false` - Hides the header (search, layout, random, display, export, light/dark), for showing just the poster on a screen
- `?display=true`, `?kiosk=10`, `source=random`, `progress=false` - see Display mode and slideshow below
- `?layout=classic|minimal|swiss|blur|cd|cd-blur|festival|receipt|gallery|setlist|typographic|riso|film|vinyl` - The look of the poster (classic is the default; festival is a gig poster: the artist is the headliner and the tracklist the line-up, the first tracks biggest; receipt is a till receipt in monospace on paper, with the tracks as items, a track total and the barcode of the release (fixed paper colours, so `colors=cover` does not apply); gallery is a framed cover in a white mat on a gallery wall with the label next to it as in a museum; setlist is a sheet of lined paper taped to a stage, in marker handwriting (Permanent Marker, from Google Fonts), with a few songs in red pen and the cover as a tilted photo sticker; typographic is only type: every word of the artist's name on a line of its own in huge type (short names grow, long single words shrink: `--fit-artist-word`), the title in light capitals and a small cover tile next to the tracks (it takes `colors=cover`); riso is a two colour risograph print on grainy paper: the cover is a duotone in two inks taken from its own colours and the title is a little out of register (fixed paper; the inks come from the cover); film is a film poster: the cover fades into black, "artist presents" above it, the title over the fade and the tracks as the small billing block of credits; vinyl is a sleeve with the record half out of it, the label of the record in a colour of the cover, and the tracks as side A and side B (A1, A2, ... B1, ...); cd is the back of a cd case, square when the tracklist allows it (about 18 short titles) and taller for longer lists: a centred numbered tracklist with the details at the bottom, and cd-blur is the same on the blurred cover. Both show the real barcode of the release (MusicBrainz knows it for most releases) at the right, above the album info, drawn as a scannable EAN-13 on a white label; no barcode is shown when the release has none; blur puts the cover, enlarged and blurred, behind the poster; in display mode the blurred cover fills the whole screen and the poster keeps its layout on top); the header has a menu that changes the URL too
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
