import { Midi } from '@tonejs/midi'
import type { NoteEvent, ParsedMidi } from '../types'

/**
 * Parse a binary MIDI file buffer into a normalized, sorted NoteEvent array.
 *
 * Key design decisions:
 * - All timings are in absolute seconds (not ticks), accounting for tempo changes
 * - The output array is sorted by startTimeSec (ascending) for O(log n) binary search culling
 * - Each note has a unique `id` for object pool keying
 * - @tonejs/midi handles tick-to-second conversion using the tempo map internally
 */
export function parseMidiFile(buffer: ArrayBuffer, fileName?: string): ParsedMidi {
    const midi = new Midi(buffer)

    // ─── Extract tempo map ──────────────────────────────────────────
    const tempoChanges = midi.header.tempos.map((t) => ({
        time: t.time ?? 0,
        bpm: t.bpm,
    }))

    // ─── Flatten all tracks into a single NoteEvent[] ───────────────
    const notes: NoteEvent[] = []
    let noteIdCounter = 0

    midi.tracks.forEach((track, trackIndex) => {
        track.notes.forEach((note) => {
            const startTimeSec = note.time
            const durationSec = note.duration
            const endTimeSec = startTimeSec + durationSec

            notes.push({
                id: `n-${noteIdCounter++}`,
                pitch: note.midi, // 21 (A0) to 108 (C8)
                startTimeSec,
                endTimeSec,
                durationSec,
                velocity: Math.round(note.velocity * 127), // @tonejs/midi normalizes to 0-1
                trackId: trackIndex,
            })
        })
    })

    // ─── Sort by startTimeSec (ascending) ───────────────────────────
    // MANDATORY for binary search culling in the render loop (Phase 6)
    notes.sort((a, b) => a.startTimeSec - b.startTimeSec)

    // ─── Calculate total duration ───────────────────────────────────
    const durationSec =
        notes.length > 0
            ? Math.max(...notes.map((n) => n.endTimeSec))
            : 0

    // ─── Clean file name ────────────────────────────────────────────
    const name = fileName
        ? fileName.replace(/\.(mid|midi)$/i, '').replace(/[_-]/g, ' ')
        : midi.name || 'Untitled'

    return {
        name,
        durationSec,
        notes,
        trackCount: midi.tracks.length,
        tempoChanges,
    }
}

/**
 * Binary search to find the index of the first note that starts at or after `time`.
 * Used by the render loop for O(log n) view-frustum culling.
 */
export function findFirstNoteIndex(notes: NoteEvent[], time: number): number {
    let lo = 0
    let hi = notes.length

    while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (notes[mid].startTimeSec < time) {
            lo = mid + 1
        } else {
            hi = mid
        }
    }

    return lo
}

/**
 * Get the visible slice of notes for the current playback time.
 * Returns only notes that are currently on screen (between time and time + lookahead)
 * or currently being played (startTimeSec <= time <= endTimeSec).
 *
 * @param notes - Sorted NoteEvent array
 * @param currentTime - Current playback time in seconds
 * @param lookaheadSec - How many seconds ahead to look (based on canvas height / pixelsPerSecond)
 */
export function getVisibleNotes(
    notes: NoteEvent[],
    currentTime: number,
    lookaheadSec: number
): NoteEvent[] {
    if (notes.length === 0) return []

    const windowStart = currentTime
    const windowEnd = currentTime + lookaheadSec

    // Binary search for the first note that could be visible
    // We need notes where endTimeSec > currentTime,
    // so we search backwards from the first note starting at currentTime
    let startIdx = findFirstNoteIndex(notes, windowStart)

    // Walk backwards to include notes that started before windowStart but haven't ended
    while (startIdx > 0 && notes[startIdx - 1].endTimeSec > windowStart) {
        startIdx--
    }

    // Collect visible notes
    const visible: NoteEvent[] = []
    for (let i = startIdx; i < notes.length; i++) {
        const note = notes[i]

        // Past the lookahead window — stop
        if (note.startTimeSec > windowEnd) break

        // Note is visible if it overlaps the [windowStart, windowEnd] range
        if (note.endTimeSec > windowStart) {
            visible.push(note)
        }
    }

    return visible
}
