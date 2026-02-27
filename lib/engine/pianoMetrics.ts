/**
 * Piano Metrics — Mathematical Coordinate System
 *
 * DESIGN DECISION: Rather than duplicating the CSS flexbox math, we use
 * getBoundingClientRect() on the actual rendered DOM piano keys to get
 * pixel-perfect alignment. This guarantees the PixiJS waterfall notes
 * always land exactly on the CSS piano keys, even after window resize.
 *
 * Fallback: If DOM nodes aren't available (e.g., during tests), we
 * provide a pure-math fallback that mirrors the CSS layout logic.
 */

// ─── Constants ─────────────────────────────────────────────────────

/** Standard 88-key piano: MIDI 21 (A0) to MIDI 108 (C8) */
export const MIDI_MIN = 21
export const MIDI_MAX = 108
export const TOTAL_KEYS = 88
export const WHITE_KEY_COUNT = 52
export const BLACK_KEY_COUNT = 36

/** Black note indices within an octave (C=0) */
const BLACK_NOTE_INDICES = new Set([1, 3, 6, 8, 10]) // C#, D#, F#, G#, A#

/** Per-note offsets for black key centering (matches PianoKeyboard.tsx) */
const BLACK_KEY_OFFSETS: Record<number, number> = {
    1: -0.15,   // C#
    3: 0.15,    // D#
    6: -0.1,    // F#
    8: 0,       // G#
    10: 0.1,    // A#
}

// ─── Types ─────────────────────────────────────────────────────────

export interface KeyMetrics {
    /** MIDI pitch number (21-108) */
    pitch: number
    /** Whether this is a black key */
    isBlack: boolean
    /** X position in pixels (left edge) */
    x: number
    /** Width in pixels */
    width: number
}

export interface PianoMetrics {
    /** Metrics for all 88 keys, indexed by MIDI pitch (21-108) */
    keys: Map<number, KeyMetrics>
    /** Container width in pixels */
    containerWidth: number
    /** Single white key width in pixels */
    whiteKeyWidth: number
    /** Black key width in pixels */
    blackKeyWidth: number
}

// ─── Helper ────────────────────────────────────────────────────────

export function isBlackKey(pitch: number): boolean {
    return BLACK_NOTE_INDICES.has(pitch % 12)
}

/**
 * Count white keys from MIDI 21 up to (but not including) the given pitch.
 */
function countWhiteKeysBefore(pitch: number): number {
    let count = 0
    for (let p = MIDI_MIN; p < pitch; p++) {
        if (!isBlackKey(p)) count++
    }
    return count
}

// ─── DOM-Based Metrics (Primary) ───────────────────────────────────

/**
 * Read pixel positions from the actual rendered piano DOM nodes.
 * The PianoKeyboard component renders keys with id="key-{midiNote}".
 *
 * Call this on mount and on ResizeObserver triggers.
 */
export function calculatePianoMetricsFromDOM(
    pianoContainerEl: HTMLElement
): PianoMetrics | null {
    const containerRect = pianoContainerEl.getBoundingClientRect()
    if (containerRect.width === 0) return null

    const keys = new Map<number, KeyMetrics>()
    let whiteKeyWidth = 0
    let blackKeyWidth = 0

    for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
        const el = document.getElementById(`key-${pitch}`)
        if (!el) continue

        const rect = el.getBoundingClientRect()
        const x = rect.left - containerRect.left
        const width = rect.width
        const black = isBlackKey(pitch)

        if (!black && whiteKeyWidth === 0) whiteKeyWidth = width
        if (black && blackKeyWidth === 0) blackKeyWidth = width

        keys.set(pitch, { pitch, isBlack: black, x, width })
    }

    return {
        keys,
        containerWidth: containerRect.width,
        whiteKeyWidth,
        blackKeyWidth,
    }
}

// ─── Pure-Math Fallback ────────────────────────────────────────────

/**
 * Calculate piano key positions from pure math, mirroring the CSS in
 * PianoKeyboard.tsx (52 flex-1 white keys, black keys at 60% width
 * positioned on white key seams with per-note offsets).
 */
export function calculatePianoMetrics(containerWidth: number): PianoMetrics {
    const whiteKeyWidth = containerWidth / WHITE_KEY_COUNT
    const blackKeyWidth = whiteKeyWidth * 0.6
    const keys = new Map<number, KeyMetrics>()

    let whiteIndex = 0

    for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
        const black = isBlackKey(pitch)

        if (black) {
            // Black key sits on the seam of the previous white key
            const noteInOctave = pitch % 12
            const offset = BLACK_KEY_OFFSETS[noteInOctave] ?? 0
            const baseX = (whiteIndex) * whiteKeyWidth // right edge of previous white key
            const x = baseX - (blackKeyWidth / 2) + (offset * whiteKeyWidth)

            keys.set(pitch, { pitch, isBlack: true, x, width: blackKeyWidth })
        } else {
            const x = whiteIndex * whiteKeyWidth
            keys.set(pitch, { pitch, isBlack: false, x, width: whiteKeyWidth })
            whiteIndex++
        }
    }

    return {
        keys,
        containerWidth,
        whiteKeyWidth,
        blackKeyWidth,
    }
}

// ─── Convenience ───────────────────────────────────────────────────

/**
 * Get the X position and width for a falling note at the given pitch.
 * Returns null if pitch is out of the 21-108 range.
 */
export function getNoteX(
    pitch: number,
    metrics: PianoMetrics
): { x: number; width: number } | null {
    const key = metrics.keys.get(pitch)
    if (!key) return null
    return { x: key.x, width: key.width }
}
