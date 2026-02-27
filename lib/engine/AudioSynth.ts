/**
 * AudioSynth — Piano Soundfont Playback via smplr
 *
 * DESIGN RULES:
 * 1. AudioContext only created on user interaction (autoplay policy)
 * 2. Supports track muting (left/right hand)
 * 3. Scheduled note playback synced to PlaybackManager clock
 */

import type { NoteEvent } from '../types'

// smplr types based on actual API (v0.18.x)
interface SmplrSoundfont {
    start: (opts: {
        note: number
        velocity?: number
        time?: number
        duration?: number | null
    }) => (() => void)
    stop: (opts?: { stopId?: string | number; time?: number } | string | number) => void
    loaded: () => Promise<unknown>
    output: { setVolume: (vol: number) => void }
    load: Promise<unknown>
}

export class AudioSynth {
    private soundfont: SmplrSoundfont | null = null
    private audioContext: AudioContext
    private _loaded = false
    private _loading = false
    private _volume = 100 // 0-127

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
            console.log('[SynthUI Audio] Loading piano soundfont...')

            // Dynamic import to avoid SSR "window is undefined" crash
            const { Soundfont: SoundfontClass } = await import('smplr')

            this.soundfont = new SoundfontClass(this.audioContext, {
                instrument: 'acoustic_grand_piano',
            }) as unknown as SmplrSoundfont

            // Wait for samples to load — loaded() is a METHOD, not a property
            await this.soundfont.loaded()

            this._loaded = true
            console.log('[SynthUI Audio] ✅ Piano soundfont loaded successfully')
            console.log('[SynthUI Audio] AudioContext state:', this.audioContext.state)
        } catch (err) {
            console.error('[SynthUI Audio] ❌ Failed to load soundfont:', err)
            this._loading = false
            throw err
        }
    }

    /**
     * Play a single note immediately (for testing audio).
     */
    playTestNote(pitch: number = 60): void {
        if (!this.soundfont || !this._loaded) {
            console.warn('[SynthUI Audio] Cannot play test note: soundfont not loaded')
            return
        }
        console.log('[SynthUI Audio] Playing test note:', pitch)
        this.soundfont.start({ note: pitch, velocity: 100, duration: 0.5 })
    }

    /**
     * Schedule a batch of notes for playback relative to the AudioContext clock.
     *
     * @param notes - Notes to schedule
     * @param songStartCtxTime - AudioContext.currentTime when this scheduling call happens
     * @param songOffset - Current song position (seconds into the song)
     * @param playbackRate - Current playback rate multiplier
     * @param mutedTracks - Set of track IDs to mute
     */
    scheduleNotes(
        notes: NoteEvent[],
        songStartCtxTime: number,
        songOffset: number,
        playbackRate: number,
        mutedTracks: Set<number>
    ): number {
        if (!this.soundfont || !this._loaded) {
            console.warn('[SynthUI Audio] scheduleNotes called but soundfont not loaded')
            return 0
        }

        const ctx = this.audioContext
        let scheduled = 0

        for (const note of notes) {
            // Skip muted tracks
            if (mutedTracks.has(note.trackId)) continue

            // Skip notes that have already ended
            if (note.endTimeSec <= songOffset) continue

            // Calculate when this note should play on the AudioContext timeline
            const noteStartInSong = note.startTimeSec - songOffset
            if (noteStartInSong < -0.1) continue // Already in the past

            const ctxTime = songStartCtxTime + (noteStartInSong / playbackRate)

            // Only schedule notes within a 4-second window ahead
            if (ctxTime > ctx.currentTime + 4) continue

            const duration = note.durationSec / playbackRate

            try {
                this.soundfont.start({
                    note: note.pitch,
                    velocity: note.velocity, // 0-127, passed directly
                    time: Math.max(ctxTime, ctx.currentTime), // Never schedule in the past
                    duration: Math.max(duration, 0.05), // minimum 50ms
                })
                scheduled++
            } catch {
                // Silently ignore scheduling errors
            }
        }

        return scheduled
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
     * Set master volume (0-127).
     */
    setVolume(v: number): void {
        this._volume = Math.max(0, Math.min(127, v))
        if (!this.soundfont) return
        try {
            this.soundfont.output.setVolume(this._volume)
        } catch {
            // Ignore if not ready
        }
    }

    destroy(): void {
        this.stopAll()
        this.soundfont = null
        this._loaded = false
        this._loading = false
    }
}
