/**
 * AudioSynth — Piano Soundfont Playback via smplr
 *
 * DESIGN RULES:
 * 1. AudioContext only created on user interaction (autoplay policy)
 * 2. Supports track muting (left/right hand)
 * 3. Uses a GainNode for instant mute/unmute on stop
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
    disconnect: () => void
}

export class AudioSynth {
    private soundfont: SmplrSoundfont | null = null
    private audioContext: AudioContext
    private _loaded = false
    private _loading = false
    private _volume = 100

    // Master gain node for instant stop
    private masterGain: GainNode

    // Dedup: track which notes have already been scheduled
    private scheduledNotes = new Set<string>()

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext
        // Create a master gain node between smplr output and destination
        this.masterGain = audioContext.createGain()
        this.masterGain.connect(audioContext.destination)
    }

    get loaded(): boolean {
        return this._loaded
    }

    /**
     * Load the piano soundfont.
     */
    async load(): Promise<void> {
        if (this._loaded || this._loading) return
        this._loading = true

        try {
            console.log('[SynthUI Audio] Loading piano soundfont...')
            const { Soundfont: SoundfontClass } = await import('smplr')

            this.soundfont = new SoundfontClass(this.audioContext, {
                instrument: 'acoustic_grand_piano',
                destination: this.masterGain, // Route through our gain node
            }) as unknown as SmplrSoundfont

            await this.soundfont.loaded()
            this._loaded = true
            console.log('[SynthUI Audio] ✅ Piano soundfont loaded')
        } catch (err) {
            console.error('[SynthUI Audio] ❌ Failed to load soundfont:', err)
            this._loading = false
            throw err
        }
    }

    /**
     * Play a single test note.
     */
    playTestNote(pitch: number = 60): void {
        if (!this.soundfont || !this._loaded) return
        // Unmute in case it was muted
        this.masterGain.gain.cancelScheduledValues(this.audioContext.currentTime)
        this.masterGain.gain.setValueAtTime(this._volume / 127, this.audioContext.currentTime)
        this.soundfont.start({ note: pitch, velocity: 100, duration: 0.5 })
    }

    /**
     * Schedule notes for playback.
     */
    scheduleNotes(
        notes: NoteEvent[],
        songStartCtxTime: number,
        songOffset: number,
        playbackRate: number,
        mutedTracks: Set<number>
    ): number {
        if (!this.soundfont || !this._loaded) return 0

        // Ensure gain is at normal level when scheduling
        this.masterGain.gain.cancelScheduledValues(this.audioContext.currentTime)
        this.masterGain.gain.setValueAtTime(this._volume / 127, this.audioContext.currentTime)

        const ctx = this.audioContext
        let scheduled = 0

        // Binary search: find first note that starts at or after current position
        // Notes are sorted by startTimeSec
        const searchStart = songOffset
        let lo = 0
        let hi = notes.length
        while (lo < hi) {
            const mid = (lo + hi) >>> 1
            if (notes[mid].startTimeSec < searchStart) {
                lo = mid + 1
            } else {
                hi = mid
            }
        }

        // Only iterate notes in the scheduling window
        const maxLookahead = ctx.currentTime + 4
        for (let i = lo; i < notes.length; i++) {
            const note = notes[i]
            const noteStartInSong = note.startTimeSec - songOffset
            const ctxTime = songStartCtxTime + (noteStartInSong / playbackRate)

            // Past scheduling window — stop scanning
            if (ctxTime > maxLookahead) break

            if (mutedTracks.has(note.trackId)) continue
            if (this.scheduledNotes.has(note.id)) continue
            if (note.endTimeSec <= songOffset) continue

            // Drop notes whose attack is already in the past — prevents
            // machine-gun "catch-up" burst when unpausing
            if (ctxTime < ctx.currentTime - 0.03) continue

            const duration = note.durationSec / playbackRate

            try {
                this.soundfont.start({
                    note: note.pitch,
                    velocity: note.velocity,
                    time: ctxTime,
                    duration: Math.max(duration, 0.05),
                })
                scheduled++
                this.scheduledNotes.add(note.id)
            } catch {
                // Ignore
            }
        }

        return scheduled
    }

    /**
     * SILENCE: Kill all audio immediately but KEEP the dedup set.
     * Use this for pause — notes won't be re-triggered on unpause.
     */
    silence(): void {
        // Instantly ramp gain to 0 (kills all audio in ~20ms)
        const now = this.audioContext.currentTime
        this.masterGain.gain.cancelScheduledValues(now)
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now)
        this.masterGain.gain.linearRampToValueAtTime(0, now + 0.02)

        // Also tell smplr to stop
        if (this.soundfont) {
            try {
                this.soundfont.stop()
            } catch {
                // Ignore
            }
        }
    }

    /**
     * FULL STOP: Kill all audio AND clear dedup set.
     * Use this for stop/seek — allows notes to be re-scheduled from new position.
     */
    stopAll(): void {
        this.silence()
        this.scheduledNotes.clear()
    }

    setVolume(v: number): void {
        this._volume = Math.max(0, Math.min(127, v))
        // Update gain node directly
        const now = this.audioContext.currentTime
        this.masterGain.gain.cancelScheduledValues(now)
        this.masterGain.gain.setValueAtTime(this._volume / 127, now)
    }

    destroy(): void {
        this.stopAll()
        if (this.soundfont) {
            try { this.soundfont.disconnect() } catch { /* ignore */ }
        }
        this.soundfont = null
        this.masterGain.disconnect()
        this._loaded = false
        this._loading = false
    }
}
