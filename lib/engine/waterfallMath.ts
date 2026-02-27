/**
 * Waterfall Math — Y-axis positioning for falling notes
 *
 * Core equations (strictly time-based, never physics-based):
 *   Y = strikeLineY - ((note.startTimeSec - logicalPlaybackTime) * pixelsPerSecond)
 *   Height = note.durationSec * pixelsPerSecond
 *
 * Notes fall downward: future notes have Y < strikeLineY (above),
 * currently-playing notes span the strike line, past notes have Y > strikeLineY (below).
 */

import type { NoteEvent } from '../types'

// ─── Types ─────────────────────────────────────────────────────────

export interface WaterfallConfig {
    /** Y coordinate of the strike line (bottom of canvas, where notes hit the piano) */
    strikeLineY: number
    /** Pixels per second — how fast notes fall (controlled by zoom level) */
    pixelsPerSecond: number
    /** Canvas height in pixels */
    canvasHeight: number
}

export interface NoteRect {
    /** Top edge Y in canvas pixels */
    y: number
    /** Height in canvas pixels */
    height: number
}

// ─── Core Math ─────────────────────────────────────────────────────

/**
 * Calculate the Y position and height for a falling note.
 *
 * The note's top edge is determined by how far into the future it starts,
 * and its height is determined by its duration.
 *
 * At logicalTime == note.startTimeSec, the top of the note reaches the strike line.
 * At logicalTime == note.endTimeSec, the bottom of the note passes the strike line.
 */
export function getNoteRect(
    note: NoteEvent,
    logicalTime: number,
    config: WaterfallConfig
): NoteRect {
    const { strikeLineY, pixelsPerSecond } = config

    // Time until the note starts (negative = already started)
    const timeUntilStart = note.startTimeSec - logicalTime

    // Y is measured from top of canvas (0 = top)
    // A note in the future has timeUntilStart > 0, so it should be above the strike line
    const y = strikeLineY - (timeUntilStart * pixelsPerSecond)

    // Height is always positive, based on duration
    const height = note.durationSec * pixelsPerSecond

    // The note's visual top edge (y - height because it extends upward from the bottom edge)
    return {
        y: y - height,
        height,
    }
}

/**
 * Check if a note is currently being struck (crossing the strike line).
 */
export function isNoteActive(note: NoteEvent, logicalTime: number): boolean {
    return logicalTime >= note.startTimeSec && logicalTime <= note.endTimeSec
}

/**
 * Check if a note rectangle is visible within the canvas bounds.
 */
export function isNoteVisible(rect: NoteRect, canvasHeight: number): boolean {
    // Note is visible if its bottom edge is below the top of canvas
    // AND its top edge is above the bottom of canvas
    return (rect.y + rect.height) > 0 && rect.y < canvasHeight
}

/**
 * Calculate how many seconds of music are visible in the canvas.
 * Used for the binary search lookahead in getVisibleNotes().
 */
export function getLookaheadSeconds(config: WaterfallConfig): number {
    return config.canvasHeight / config.pixelsPerSecond
}
