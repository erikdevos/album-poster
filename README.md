View deployed at:
https://erikdevos.github.io/album-poster/

## Run locally

The app uses ES modules and `fetch`, so it needs a web server (opening `index.html` directly fails):

```
python3 -m http.server 8000
```

Then open http://localhost:8000. The styles are written in SCSS (`styles/*.scss`) and compiled to `styles/style.css`, which is committed. Keep both in sync until the build setup is replaced.

## Data

Album data comes from [MusicBrainz](https://musicbrainz.org/) (title, artist, year, label, genres, tracks) and the [Cover Art Archive](https://coverartarchive.org/) (covers). Both allow browser requests (CORS), including for the image files, so no proxy is needed and the colour palette can be read from the cover.

All data access sits behind two functions in `scripting/source.js`: `searchAlbums(query)` and `getAlbum(id)`. The MusicBrainz implementation is in `scripting/sources/musicbrainz.js` and can be replaced by another source with the same interface. MusicBrainz allows about one request per second; the source queues its requests and retries on a 503.

`data/albums.json` is the curated list: `id` is the MusicBrainz release-group id, `audiodbId` the id the app used before, so old links keep working. `scripts/migrate-albums.mjs` was used for the one-off conversion.

## URL Parameters

### Loading Specific Albums
Use the hash to load a specific album by its MusicBrainz release-group id. Without a hash a random album is shown. Search in debug mode (`?debug=true`) to find the id of any album: picking a result puts it in the URL.
```
#album-id
```

Examples:
- `#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0` - Loads Rosalia's LUX album
- `#2110671` - Old TheAudioDB id of Rihanna's Rated R, still redirected to the new id

### Additional Options
Add query parameters before the hash:

- `?debug=true` - Shows the search bar to find any album
- `?size=l` - Sets large poster size
- `?size=m` - Sets medium poster size
- `?size=s` - Sets small poster size
- `?theme=dark` - Sets dark theme (black background, white text)
- `?theme=light` - Sets light theme (light background, black text) - default

#### Combined Examples:
- `?debug=true#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0` - Load specific album with search bar visible
- `?size=l#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0` - Load specific album with large size
- `?theme=dark#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0` - Load specific album with dark theme
- `?debug=true&size=s&theme=dark#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0` - Load specific album with debug bar, small size, and dark theme

The older form with the options after the hash (`#bb3ec118-57df-4eb9-a8fe-a26a70a7dbe0?debug=true`) still works.
