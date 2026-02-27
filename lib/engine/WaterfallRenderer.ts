/**
 * WaterfallRenderer — PixiJS Canvas + Zero-Allocation Render Loop
 *
 * PERFORMANCE RULES:
 * 1. ZERO object allocations in renderFrame() — all reusable vars pre-allocated
 * 2. DOM key elements cached at init — no getElementById in hot loop
 * 3. Binary search culling — only process visible notes
 * 4. Object pool — sprite acquire/release with no new/destroy
 * 5. All per-frame math uses pre-allocated primitives
 */

import { Application, Graphics, Container } from 'pixi.js'
import type { NoteEvent, ParsedMidi } from '../types'
import { NotePool } from './NotePool'
import {
    calculatePianoMetricsFromDOM,
    calculatePianoMetrics,
    isBlackKey,
    MIDI_MIN,
    MIDI_MAX,
    type PianoMetrics,
} from './pianoMetrics'
import type { PlaybackManager } from './PlaybackManager'

// ─── Track Colors ────────────────────────────────────────────────

const TRACK_COLORS: number[] = [
    0x22c55e, // Track 0: Green (right hand / treble)
    0x3b82f6, // Track 1: Blue (left hand / bass)
    0xf59e0b, // Track 2: Amber
    0xef4444, // Track 3: Red
    0xa855f7, // Track 4: Purple
]
const DEFAULT_COLOR = 0xa855f7

const ACTIVE_ALPHA = 0.95
const INACTIVE_ALPHA = 0.75

export class WaterfallRenderer {
    private app: Application | null = null
    private notePool: NotePool | null = null
    private playbackManager: PlaybackManager

    // Canvas config
    private canvasContainer: HTMLElement
    private resizeObserver: ResizeObserver | null = null

    // Pre-computed layout (no per-frame allocation)
    private pixelsPerSecond = 200
    private strikeLineY = 0
    private canvasHeight = 0
    private canvasWidth = 0

    // Piano metrics (recomputed on resize only)
    private keyX: Float64Array = new Float64Array(128) // indexed by MIDI pitch
    private keyW: Float64Array = new Float64Array(128) // indexed by MIDI pitch
    private keyValid: Uint8Array = new Uint8Array(128) // 1 = valid

    // Strike line visual
    private strikeLineGraphics: Graphics | null = null

    // ─── CACHED DOM ELEMENTS (no getElementById in hot loop) ──────
    private keyElements: (HTMLElement | null)[] = new Array(128).fill(null)

    // Active notes tracking — pre-allocated typed arrays for zero GC
    // Use Uint8Arrays indexed by MIDI pitch (128 values) instead of Sets
    private activeThisFrame: Uint8Array = new Uint8Array(128)
    private activeLastFrame: Uint8Array = new Uint8Array(128)

    // Data
    private notes: NoteEvent[] = []
    private leftHandActive = true
    private rightHandActive = true

    // Bound render function (avoid re-binding per frame)
    private boundRenderFrame: () => void

    // FPS diagnostic
    private frameCount = 0
    private lastFpsTime = 0

    constructor(
        canvasContainer: HTMLElement,
        playbackManager: PlaybackManager
    ) {
        this.canvasContainer = canvasContainer
        this.playbackManager = playbackManager
        this.boundRenderFrame = this.renderFrame.bind(this)
    }

    /**
     * Initialize the PixiJS application and mount it into the container.
     */
    async init(): Promise<void> {
        this.app = new Application()

        await this.app.init({
            preference: 'webgl',
            powerPreference: 'high-performance',
            antialias: false, // Notes are rectangles — AA wastes GPU at Retina resolution
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
            backgroundAlpha: 0,
            resizeTo: this.canvasContainer,
        })

        // Mount canvas
        const canvas = this.app.canvas as HTMLCanvasElement
        canvas.style.position = 'absolute'
        canvas.style.top = '0'
        canvas.style.left = '0'
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        this.canvasContainer.appendChild(canvas)

        // Strike line
        this.strikeLineGraphics = new Graphics()
        this.strikeLineGraphics.label = 'strike-line'
        this.app.stage.addChild(this.strikeLineGraphics)

        // Note pool
        this.notePool = new NotePool(this.app, 1500)
        await this.notePool.init()

        // Cache all piano key DOM elements
        this.cacheKeyElements()

        // Initial layout
        this.recalculateLayout()

        // ResizeObserver
        this.resizeObserver = new ResizeObserver(() => {
            this.recalculateLayout()
            this.cacheKeyElements() // re-cache in case DOM changed
        })
        this.resizeObserver.observe(this.canvasContainer)

        // Start render loop
        this.app.ticker.add(this.boundRenderFrame)

        console.log('[SynthUI] WaterfallRenderer initialized (zero-alloc render loop)')
    }

    /**
     * Cache all 88 piano key DOM elements so we never call getElementById in the hot loop.
     */
    private cacheKeyElements(): void {
        for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
            this.keyElements[pitch] = document.getElementById(`key-${pitch}`)
        }
    }

    /**
     * Recalculate layout when window resizes.
     */
    private recalculateLayout(): void {
        if (!this.app) return

        const rect = this.canvasContainer.getBoundingClientRect()

        // CRITICAL: Prevent infinite layout reflow thrashing
        if (this.canvasWidth === rect.width && this.canvasHeight === rect.height) {
            return
        }

        this.canvasWidth = rect.width
        this.canvasHeight = rect.height
        this.strikeLineY = this.canvasHeight - 4

        // Recalculate piano metrics
        const parent = this.canvasContainer.parentElement?.parentElement || this.canvasContainer
        const metrics =
            calculatePianoMetricsFromDOM(parent) ||
            calculatePianoMetrics(this.canvasWidth)

        // Flatten into typed arrays for zero-alloc render loop access
        this.keyValid.fill(0)
        for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
            const key = metrics.keys.get(pitch)
            if (key) {
                this.keyX[pitch] = key.x
                this.keyW[pitch] = key.width
                this.keyValid[pitch] = 1
            }
        }

        this.drawStrikeLine()
    }

    private drawStrikeLine(): void {
        if (!this.strikeLineGraphics) return
        this.strikeLineGraphics.clear()

        // Main line
        this.strikeLineGraphics.rect(0, this.strikeLineY - 1, this.canvasWidth, 2)
        this.strikeLineGraphics.fill({ color: 0xffffff, alpha: 0.15 })

        // Glow
        this.strikeLineGraphics.rect(0, this.strikeLineY - 3, this.canvasWidth, 6)
        this.strikeLineGraphics.fill({ color: 0xa855f7, alpha: 0.08 })
    }

    loadNotes(midi: ParsedMidi): void {
        this.notes = midi.notes
    }

    setTrackVisibility(leftHand: boolean, rightHand: boolean): void {
        this.leftHandActive = leftHand
        this.rightHandActive = rightHand
    }

    setZoom(pps: number): void {
        this.pixelsPerSecond = pps
    }

    // ─── THE RENDER LOOP (ZERO ALLOCATIONS) ──────────────────────

    /**
     * Called every frame by PIXI.Ticker.
     * ALL variables are pre-allocated class fields or stack primitives.
     * NO object literals, NO .push(), NO new anything.
     */
    private renderFrame(): void {
        if (!this.notePool || this.notes.length === 0) return

        const time = this.playbackManager.getVisualTime()
        const pps = this.pixelsPerSecond
        const strikeY = this.strikeLineY
        const canvasH = this.canvasHeight
        const lookaheadSec = canvasH / pps
        const notes = this.notes

        // ─── Release all sprites ───────────────────────────────────
        this.notePool.releaseAll()

        // ─── Swap active note tracking (zero-alloc) ────────────────
        const temp = this.activeLastFrame
        this.activeLastFrame = this.activeThisFrame
        this.activeThisFrame = temp
        this.activeThisFrame.fill(0)

        // ─── Binary search: find first visible note ────────────────
        const windowStart = time - 0.5
        const windowEnd = time + lookaheadSec

        // We MUST search by startTimeSec because the array is sorted by startTimeSec.
        // Look back 10 seconds to catch any long-held notes that started in the past.
        const searchTime = Math.max(0, windowStart - 10.0)
        let lo = 0
        let hi = notes.length
        while (lo < hi) {
            const mid = (lo + hi) >>> 1
            if (notes[mid].startTimeSec < searchTime) {
                lo = mid + 1
            } else {
                hi = mid
            }
        }

        // ─── Render visible notes ──────────────────────────────────
        for (let i = lo; i < notes.length; i++) {
            const note = notes[i]

            // Safe to break because array is properly sorted by startTimeSec
            if (note.startTimeSec > windowEnd) break

            // Skip notes that already ended before our look-behind window
            if (note.endTimeSec < windowStart) continue

            // Track muting
            if (!this.rightHandActive && note.trackId === 0) continue
            if (!this.leftHandActive && note.trackId === 1) continue

            // Skip if pitch has no valid key mapping
            if (!this.keyValid[note.pitch]) continue

            // ─── Inline Y/Height math (no function call, no object alloc) ─
            const timeUntilStart = note.startTimeSec - time
            const noteBottomY = strikeY - (timeUntilStart * pps)
            const noteHeight = note.durationSec * pps
            const noteTopY = noteBottomY - noteHeight

            // Visibility check (all stack primitives)
            if ((noteTopY + noteHeight) < 0 || noteTopY > canvasH) continue

            // ─── Acquire sprite ──────────────────────────────────────
            const sprite = this.notePool.acquire()
            if (!sprite) break

            // ─── Position (Sub-pixel Y for 120Hz smooth scrolling) ────────────────
            sprite.x = Math.round(this.keyX[note.pitch]) // X stays rounded to align with CSS keys
            sprite.y = noteTopY // NO ROUNDING HERE! Let WebGL interpolate sub-pixels.

            // NineSlice optimization: only assign dimensions if changed to prevent vertex rebuilding
            const w = Math.round(this.keyW[note.pitch])
            const h = Math.max(Math.round(noteHeight), 12)
            if (Math.round(sprite.width) !== w) sprite.width = w
            if (Math.round(sprite.height) !== h) sprite.height = h

            // ─── Color & active state ────────────────────────────────
            const color = TRACK_COLORS[note.trackId] ?? DEFAULT_COLOR
            const active = time >= note.startTimeSec && time <= note.endTimeSec

            if (active) {
                this.activeThisFrame[note.pitch] = 1
                sprite.tint = color
                sprite.alpha = ACTIVE_ALPHA
                // Slight glow expansion
                sprite.x -= 1
                sprite.width += 2
            } else {
                sprite.tint = color
                sprite.alpha = INACTIVE_ALPHA
            }
        }

        // ─── Key Bridge: cached DOM refs, no getElementById ────────
        for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
            const wasActive = this.activeLastFrame[pitch]
            const isActive = this.activeThisFrame[pitch]

            if (wasActive && !isActive) {
                const el = this.keyElements[pitch]
                if (el) el.dataset.active = 'false'
            } else if (!wasActive && isActive) {
                const el = this.keyElements[pitch]
                if (el) el.dataset.active = 'true'
            }
        }

        // ─── FPS Diagnostic (silent — enable console.log below to debug) ──
        this.frameCount++
        const now = performance.now()
        if (now - this.lastFpsTime >= 2000) {
            // const fps = (this.frameCount / ((now - this.lastFpsTime) / 1000)).toFixed(1)
            // console.log(`[FPS] ${fps}fps`)  // Uncomment to debug FPS
            this.frameCount = 0
            this.lastFpsTime = now
        }
    }

    // ─── Cleanup ─────────────────────────────────────────────────

    destroy(): void {
        if (this.app) {
            this.app.ticker.remove(this.boundRenderFrame)
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect()
            this.resizeObserver = null
        }

        // Deactivate all piano keys
        for (let pitch = MIDI_MIN; pitch <= MIDI_MAX; pitch++) {
            const el = this.keyElements[pitch]
            if (el) el.dataset.active = 'false'
        }

        if (this.notePool) {
            this.notePool.destroy()
            this.notePool = null
        }

        if (this.app) {
            const canvas = this.app.canvas
            this.app.destroy(true, { children: true, texture: true })
            if (canvas?.parentElement) {
                canvas.parentElement.removeChild(canvas)
            }
            this.app = null
        }

        this.strikeLineGraphics = null
        this.keyElements.fill(null)

        console.log('[SynthUI] WaterfallRenderer destroyed')
    }
}
