// The export panel: the file type decides which options show. A PNG has a width in pixels; a PDF
// is a page for a printer, with the paper, the margin, bleed, crop marks and the dpi. The print
// settings are remembered in this browser, and the browser's own print dialog uses them too.

import { PAPERS, PRESETS, cleanPrintSettings, planPrint, describePrint, applyPreset, presetFor, DEFAULT_PRINT } from './printPlan.js'
import { canvasLimits } from './exportPlan.js'

const STORAGE_KEY = 'album-poster.print'
const $ = id => document.getElementById(id)

function savedSettings() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
    } catch {
        return {} // storage can be blocked, or hold something else
    }
}

function saveSettings(settings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
        // see savedSettings()
    }
}

export function printSettings() {
    return cleanPrintSettings({
        paper: $('print-paper').value,
        orientation: $('print-orientation').value,
        margin: $('print-margin').value,
        dpi: $('print-dpi').value,
        bleed: $('print-bleed').checked,
        marks: $('print-marks').checked
    })
}

// What the download button needs: { format, quality, print } (print only for a PDF)
export function exportOptions() {
    const format = $('export-format').value
    return {
        format,
        quality: $('export-quality').value,
        print: format === 'pdf' ? printSettings() : null
    }
}

export function setupExportPanel() {
    $('print-paper').replaceChildren(...PAPERS.map(paper => new Option(paper.label, paper.id)))
    $('print-preset').replaceChildren(...PRESETS.map(preset => new Option(preset.label, preset.id)), new Option('Custom', 'custom'))

    const saved = cleanPrintSettings({ ...DEFAULT_PRINT, ...savedSettings() })
    $('print-paper').value = saved.paper
    $('print-orientation').value = saved.orientation
    $('print-margin').value = String(saved.margin)
    $('print-dpi').value = String(saved.dpi)
    $('print-bleed').checked = saved.bleed
    $('print-marks').checked = saved.marks

    // One line that says what the file will be, from the real shape of the poster on screen
    const summarize = () => {
        const { width, height } = $('album-info').getBoundingClientRect()
        if (width === 0 || height === 0) return
        const plan = planPrint({ settings: printSettings(), width, height, limits: canvasLimits(navigator.userAgent) })
        $('print-summary').textContent = describePrint(plan)
    }

    const sync = () => {
        const pdf = $('export-format').value === 'pdf'
        $('print-options').hidden = !pdf
        $('export-quality-field').hidden = pdf
        if (pdf) summarize()
    }

    $('export-format').addEventListener('change', sync)
    // The purpose shows which preset the settings are the same as, and "Custom" after a change of one of them
    const showPreset = () => { $('print-preset').value = presetFor(printSettings()) }
    showPreset()

    $('print-preset').addEventListener('change', () => {
        const settings = applyPreset(printSettings(), $('print-preset').value)
        $('print-margin').value = String(settings.margin)
        $('print-dpi').value = String(settings.dpi)
        $('print-bleed').checked = settings.bleed
        $('print-marks').checked = settings.marks
        saveSettings(printSettings())
        summarize()
    })
    $('print-options').addEventListener('input', ({ target }) => {
        if (target.id === 'print-preset') return // its change handler sets the other fields first
        showPreset()
        saveSettings(printSettings())
        summarize()
    })
    // the shape of the poster changes with the album and the layout
    new ResizeObserver(() => { if ($('export-format').value === 'pdf') summarize() }).observe($('album-info'))
    sync()
}
