// The poster layouts, in the order that the pickers show them. Pure data, no DOM, so that the poster
// page, the wall and the tests all use the same list.

export const LAYOUT_LABELS = {
    classic: 'Classic',
    minimal: 'Minimal',
    swiss: 'Swiss',
    blur: 'Blur',
    cd: 'CD',
    'cd-blur': 'CD blur',
    festival: 'Festival',
    receipt: 'Receipt',
    gallery: 'Gallery',
    setlist: 'Setlist',
    typographic: 'Typographic',
    riso: 'Riso',
    film: 'Film',
    vinyl: 'Vinyl'
}

export const LAYOUTS = Object.keys(LAYOUT_LABELS)
export const DEFAULT_LAYOUT = 'classic'
