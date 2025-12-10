View deployed at:
https://erikdevos.github.io/album-poster/

## URL Parameters

### Loading Specific Albums
Use the hash format to load specific albums by ID:
```
#album-id
```

Examples:
- `#2458157` - Loads Rosalia's LUX album
- `#2110671` - Loads Rihanna's Rated R album

### Additional Options
Combine with query parameters for additional features:

- `?debug=true` - Shows the search bar for manual album ID input
- `?size=l` - Sets large poster size
- `?size=m` - Sets medium poster size  
- `?size=s` - Sets small poster size
- `?theme=dark` - Sets dark theme (black background, white text)
- `?theme=light` - Sets light theme (light background, black text) - default

#### Combined Examples:
- `#2458157?debug=true` - Load specific album with search bar visible
- `#2458157?size=l` - Load specific album with large size
- `#2458157?theme=dark` - Load specific album with dark theme
- `#2458157?debug=true&size=s&theme=dark` - Load specific album with debug bar, small size, and dark theme
