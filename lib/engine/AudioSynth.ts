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

        for (const note of notes) {
            if (mutedTracks.has(note.trackId)) continue
            if (note.endTimeSec <= songOffset) continue

            const noteStartInSong = note.startTimeSec - songOffset
            if (noteStartInSong < -0.1) continue

            const ctxTime = songStartCtxTime + (noteStartInSong / playbackRate)
            if (ctxTime > ctx.currentTime + 4) continue

            const duration = note.durationSec / playbackRate

            try {
                this.soundfont.start({
                    note: note.pitch,
                    velocity: note.velocity,
                    time: Math.max(ctxTime, ctx.currentTime),
                    duration: Math.max(duration, 0.05),
                })
                scheduled++
            } catch {
                // Ignore
            }
        }

        return scheduled
    }

    /**
     * INSTANT STOP: Kill all audio immediately using the master GainNode.
     * This is much more reliable than smplr's .stop() because it kills
     * both currently-playing AND future-scheduled notes.
     */
    stopAll(): void {
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
