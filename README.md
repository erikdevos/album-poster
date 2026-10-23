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

The header has a search box (an ARIA combobox: arrow keys, Enter, Escape). Next to it are the layout menu and four round icon buttons: random album, display, export and light/dark. The buttons show only an icon; each has a name (`aria-label`) and the same text as a tooltip (`title`) for screen readers and for hovering. The search box is short; its list of results is wider than the box. On a phone the box gets its own row. Empty, the box suggests the albums you viewed last (kept in this browser only) and the curated list.

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

- `?controls=false` - Hides the header (search, layout, random, display, export, light/dark), for showing just the poster on a screen
- `?display=true`, `?kiosk=10`, `source=random`, `progress=false` - see Display mode and slideshow below
- `?layout=classic|minimal|swiss|blur|cd|cd-blur` - The look of the poster (classic is the default; cd is the back of a cd case: a centred numbered tracklist with the details at the bottom, and cd-blur is the same on the blurred cover; blur puts the cover, enlarged and blurred, behind the poster; in display mode the blurred cover fills the whole screen and the poster keeps its layout on top); the header has a menu that changes the URL too
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
