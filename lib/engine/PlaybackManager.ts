/**
 * PlaybackManager — Master Clock (Singleton, outside React)
 *
 * CRITICAL DESIGN RULES:
 * 1. This class is NEVER stored in React state
 * 2. logicalPlaybackTime is derived from AudioContext.currentTime (hardware clock)
 * 3. Never use requestAnimationFrame delta time for sync
 * 4. AudioContext is only created/resumed on user interaction (autoplay policy)
 */

type PlaybackListener = (time: number, isPlaying: boolean) => void

export class PlaybackManager {
    private audioContext: AudioContext | null = null
    private _isPlaying = false

    // Time tracking
    // logicalTime = audioContextTimeAtPlay + (audioContext.currentTime - audioContextTimeAtPlay) * playbackRate
    // Simplified: we track where in the song we are
    private _songPosition = 0 // Where we are in the song (seconds)
    private _playStartedAtCtx = 0 // AudioContext.currentTime when play was pressed
    private _playbackRate = 1.0

    // Song data
    private _duration = 0

    // Listeners (for PixiJS ticker to poll)
    private listeners: Set<PlaybackListener> = new Set()

    // ─── AudioContext Management ──────────────────────────────────

    /**
     * Get or create AudioContext. MUST only be called from a user gesture handler.
     */
    getAudioContext(): AudioContext {
        if (!this.audioContext) {
            this.audioContext = new AudioContext()
        }
        return this.audioContext
    }

    /**
     * Ensure AudioContext is resumed (required after user gesture).
     */
    async ensureResumed(): Promise<void> {
        const ctx = this.getAudioContext()
        if (ctx.state === 'suspended') {
            await ctx.resume()
        }
    }

    // ─── Playback Control ─────────────────────────────────────────

    get isPlaying(): boolean {
        return this._isPlaying
    }

    get duration(): number {
        return this._duration
    }

    set duration(d: number) {
        this._duration = d
    }

    get playbackRate(): number {
        return this._playbackRate
    }

    /**
     * Get the current logical playback time in seconds.
     * This is the ABSOLUTE SOURCE OF TRUTH for visual sync.
     */
    getTime(): number {
        if (!this._isPlaying || !this.audioContext) {
            return this._songPosition
        }

        const elapsed = (this.audioContext.currentTime - this._playStartedAtCtx) * this._playbackRate
        const t = this._songPosition + elapsed

        // Clamp to duration
        if (t >= this._duration) {
            this._songPosition = this._duration
            this._isPlaying = false
            this.notifyListeners()
            return this._duration
        }

        return t
    }

    /**
     * Start or resume playback from current position.
     */
    async play(): Promise<void> {
        if (this._isPlaying) return

        await this.ensureResumed()
        const ctx = this.getAudioContext()

        this._playStartedAtCtx = ctx.currentTime
        this._isPlaying = true
        this.notifyListeners()
    }

    /**
     * Pause playback, preserving current position.
     */
    pause(): void {
        if (!this._isPlaying) return

        // Capture current position before stopping
        this._songPosition = this.getTime()
        this._isPlaying = false
        this.notifyListeners()
    }

    /**
     * Stop playback and reset to beginning.
     */
    stop(): void {
        this._songPosition = 0
        this._isPlaying = false
        this.notifyListeners()
    }

    /**
     * Seek to a specific time in the song.
     * Works whether playing or paused.
     */
    seek(timeSec: number): void {
        const wasPlaying = this._isPlaying

        // Clamp to valid range
        this._songPosition = Math.max(0, Math.min(timeSec, this._duration))

        if (wasPlaying && this.audioContext) {
            // Reset the play reference point
            this._playStartedAtCtx = this.audioContext.currentTime
        }

        this.notifyListeners()
    }

    /**
     * Set playback rate (tempo multiplier). 1.0 = normal speed.
     */
    setPlaybackRate(rate: number): void {
        if (this._isPlaying) {
            // Capture current position at old rate, then resume at new rate
            this._songPosition = this.getTime()
            if (this.audioContext) {
                this._playStartedAtCtx = this.audioContext.currentTime
            }
        }
        this._playbackRate = rate
    }

    // ─── Listeners ────────────────────────────────────────────────

    addListener(fn: PlaybackListener): () => void {
        this.listeners.add(fn)
        return () => this.listeners.delete(fn)
    }

    private notifyListeners(): void {
        const time = this.getTime()
        for (const fn of this.listeners) {
            fn(time, this._isPlaying)
        }
    }

    // ─── Cleanup ──────────────────────────────────────────────────

    async destroy(): Promise<void> {
        this._isPlaying = false
        this.listeners.clear()
        if (this.audioContext) {
            await this.audioContext.close()
            this.audioContext = null
        }
    }
}

// ─── Singleton ──────────────────────────────────────────────────

let _instance: PlaybackManager | null = null

export function getPlaybackManager(): PlaybackManager {
    if (!_instance) {
        _instance = new PlaybackManager()
    }
    return _instance
}

export function destroyPlaybackManager(): void {
    if (_instance) {
        _instance.destroy()
        _instance = null
    }
}
