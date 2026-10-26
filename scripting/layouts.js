// The poster layouts, in the order that the pickers show them. Pure data, no DOM, so that the poster
// page, the wall and the tests all use the same list.

export const LAYOUT_LABELS = {
    classic: 'Classic',
    modern: 'Modern',
    minimal: 'Minimal',
    swiss: 'Swiss',
    typographic: 'Typographic',
    blur: 'Blur',
    riso: 'Riso',
    film: 'Film',
    gallery: 'Gallery',
    cd: 'CD',
    'cd-blur': 'CD blur',
    festival: 'Festival',
    receipt: 'Receipt',
    setlist: 'Setlist',
    vinyl: 'Vinyl'
}

export const LAYOUTS = Object.keys(LAYOUT_LABELS)
export const DEFAULT_LAYOUT = 'classic'
