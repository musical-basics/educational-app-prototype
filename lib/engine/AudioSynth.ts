/**
 * AudioSynth — Piano Soundfont Playback via smplr
 *
 * DESIGN RULES:
 * 1. AudioContext only created on user interaction (autoplay policy)
 * 2. Soundfont loaded from /public for offline Tauri support
 * 3. Supports track muting (left/right hand)
 * 4. Scheduled note playback synced to PlaybackManager clock
 */

import type { NoteEvent } from '../types'

// smplr is imported dynamically to avoid SSR crashes (window undefined)
type Soundfont = {
    start: (opts: { note: number; velocity: number; time?: number; duration?: number }) => void
    stop: (opts?: { time?: number }) => void
    loaded: Promise<void>
    output: { setVolume: (v: number) => void }
}

export class AudioSynth {
    private soundfont: Soundfont | null = null
    private audioContext: AudioContext
    private _loaded = false
    private _loading = false

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext
    }

    get loaded(): boolean {
        return this._loaded
    }

    /**
     * Load the piano soundfont. Must be called after AudioContext is resumed.
     */
    async load(): Promise<void> {
        if (this._loaded || this._loading) return
        this._loading = true

        try {
            // Dynamic import to avoid SSR "window is undefined" crash
            const { Soundfont: SoundfontClass } = await import('smplr')

            this.soundfont = new SoundfontClass(this.audioContext, {
                instrument: 'acoustic_grand_piano',
            }) as unknown as Soundfont

            await this.soundfont.loaded
            this._loaded = true
            console.log('[SynthUI] Piano soundfont loaded')
        } catch (err) {
            console.error('[SynthUI] Failed to load soundfont:', err)
            this._loading = false
            throw err
        }
    }

    /**
     * Schedule a batch of notes for playback relative to the AudioContext clock.
     *
     * @param notes - Notes to schedule
     * @param songStartCtxTime - AudioContext.currentTime when the song "starts"
     * @param songOffset - Current song position offset (seconds)
     * @param playbackRate - Current playback rate multiplier
     * @param mutedTracks - Set of track IDs to mute
     */
    scheduleNotes(
        notes: NoteEvent[],
        songStartCtxTime: number,
        songOffset: number,
        playbackRate: number,
        mutedTracks: Set<number>
    ): void {
        if (!this.soundfont || !this._loaded) return

        const ctx = this.audioContext

        for (const note of notes) {
            // Skip muted tracks
            if (mutedTracks.has(note.trackId)) continue

            // Skip notes that have already passed
            if (note.endTimeSec <= songOffset) continue

            // Calculate when this note should play on the AudioContext timeline
            const noteStartInSong = Math.max(note.startTimeSec - songOffset, 0)
            const ctxTime = songStartCtxTime + (noteStartInSong / playbackRate)

            // Skip notes too far in the future (schedule in batches)
            if (ctxTime > ctx.currentTime + 5) continue

            // Skip notes that should have already started
            if (ctxTime < ctx.currentTime - 0.05) continue

            const duration = note.durationSec / playbackRate

            try {
                this.soundfont.start({
                    note: note.pitch,
                    velocity: note.velocity / 127, // normalize back to 0-1
                    time: ctxTime,
                    duration: Math.max(duration, 0.05), // minimum 50ms
                })
            } catch {
                // Silently ignore scheduling errors for notes in the past
            }
        }
    }

    /**
     * Stop all currently playing notes.
     */
    stopAll(): void {
        if (!this.soundfont) return
        try {
            this.soundfont.stop()
        } catch {
            // Ignore
        }
    }

    /**
     * Set master volume (0-1).
     */
    setVolume(v: number): void {
        if (!this.soundfont) return
        this.soundfont.output.setVolume(Math.max(0, Math.min(1, v)) * 127)
    }

    destroy(): void {
        this.stopAll()
        this.soundfont = null
        this._loaded = false
        this._loading = false
    }
}
