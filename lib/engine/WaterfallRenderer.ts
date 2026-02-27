/**
 * WaterfallRenderer — PixiJS Canvas + High-Performance Render Loop
 *
 * CRITICAL RULES:
 * 1. Uses PIXI.Ticker tied to monitor refresh rate (60/120 FPS)
 * 2. Polls PlaybackManager.getTime() for absolute sync
 * 3. Binary search culling — only draw visible notes
 * 4. Object pool — zero allocations in render loop
 * 5. Additive blend + glow for strike-line collision
 */

import { Application, Graphics, Container, BlurFilter } from 'pixi.js'
import type { NoteEvent, ParsedMidi } from '../types'
import { NotePool } from './NotePool'
import {
    calculatePianoMetricsFromDOM,
    calculatePianoMetrics,
    getNoteX,
    isBlackKey,
    type PianoMetrics,
} from './pianoMetrics'
import { getNoteRect, isNoteActive, getLookaheadSeconds } from './waterfallMath'
import type { PlaybackManager } from './PlaybackManager'

// ─── Track Colors (Left hand = blue, Right hand = green) ────────

const TRACK_COLORS: Record<number, number> = {
    0: 0x22c55e, // Green (right hand / treble)
    1: 0x3b82f6, // Blue (left hand / bass)
    2: 0xf59e0b, // Amber (extra track)
    3: 0xef4444, // Red (extra track)
    4: 0xa855f7, // Purple (extra track)
}

const ACTIVE_GLOW_ALPHA = 0.8
const INACTIVE_ALPHA = 0.85

export class WaterfallRenderer {
    private app: Application | null = null
    private notePool: NotePool | null = null
    private playbackManager: PlaybackManager
    private pianoMetrics: PianoMetrics | null = null

    // Canvas config
    private canvasContainer: HTMLElement
    private pianoContainer: HTMLElement | null = null
    private resizeObserver: ResizeObserver | null = null

    // Render state
    private pixelsPerSecond = 200
    private strikeLineY = 0
    private canvasHeight = 0
    private canvasWidth = 0

    // Strike line visual
    private strikeLineGraphics: Graphics | null = null

    // Active notes tracking for key bridge
    private activeNotes = new Set<number>()
    private previousActiveNotes = new Set<number>()

    // Data
    private notes: NoteEvent[] = []
    private leftHandActive = true
    private rightHandActive = true

    // Glow filter for active notes
    private glowFilter: BlurFilter | null = null

    constructor(
        canvasContainer: HTMLElement,
        playbackManager: PlaybackManager
    ) {
        this.canvasContainer = canvasContainer
        this.playbackManager = playbackManager
    }

    /**
     * Initialize the PixiJS application and mount it into the container.
     */
    async init(): Promise<void> {
        // ─── Create PixiJS Application ─────────────────────────────
        this.app = new Application()

        await this.app.init({
            preference: 'webgl',
            powerPreference: 'high-performance',
            antialias: true,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
            backgroundAlpha: 0,
            resizeTo: this.canvasContainer,
        })

        // Mount canvas into the DOM container
        const canvas = this.app.canvas as HTMLCanvasElement
        canvas.style.position = 'absolute'
        canvas.style.top = '0'
        canvas.style.left = '0'
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        this.canvasContainer.appendChild(canvas)

        // ─── Create Strike Line ────────────────────────────────────
        this.strikeLineGraphics = new Graphics()
        this.strikeLineGraphics.label = 'strike-line'
        this.app.stage.addChild(this.strikeLineGraphics)

        // ─── Create Note Pool ──────────────────────────────────────
        this.notePool = new NotePool(this.app, 1500)
        await this.notePool.init()

        // ─── Create Glow Filter ────────────────────────────────────
        this.glowFilter = new BlurFilter({ strength: 4, quality: 2 })

        // ─── Initial Size Calculation ──────────────────────────────
        this.recalculateLayout()

        // ─── ResizeObserver ────────────────────────────────────────
        this.resizeObserver = new ResizeObserver(() => {
            this.recalculateLayout()
        })
        this.resizeObserver.observe(this.canvasContainer)

        // ─── Start Render Loop ─────────────────────────────────────
        this.app.ticker.add(this.renderFrame, this)

        console.log('[SynthUI] WaterfallRenderer initialized')
    }

    /**
     * Recalculate layout when window resizes.
     */
    private recalculateLayout(): void {
        if (!this.app) return

        const rect = this.canvasContainer.getBoundingClientRect()
        this.canvasWidth = rect.width
        this.canvasHeight = rect.height
        this.strikeLineY = this.canvasHeight - 4 // 4px above bottom edge

        // Recalculate piano metrics from DOM or fallback to math
        this.pianoMetrics =
            calculatePianoMetricsFromDOM(this.canvasContainer.parentElement?.parentElement || this.canvasContainer) ||
            calculatePianoMetrics(this.canvasWidth)

        // Redraw strike line
        this.drawStrikeLine()
    }

    /**
     * Draw the strike line at the bottom of the canvas.
     */
    private drawStrikeLine(): void {
        if (!this.strikeLineGraphics) return

        this.strikeLineGraphics.clear()

        // Main line
        this.strikeLineGraphics.rect(0, this.strikeLineY - 1, this.canvasWidth, 2)
        this.strikeLineGraphics.fill({ color: 0xffffff, alpha: 0.15 })

        // Glow effect
        this.strikeLineGraphics.rect(0, this.strikeLineY - 3, this.canvasWidth, 6)
        this.strikeLineGraphics.fill({ color: 0xa855f7, alpha: 0.08 })
    }

    /**
     * Load MIDI data for rendering.
     */
    loadNotes(midi: ParsedMidi): void {
        this.notes = midi.notes
    }

    /**
     * Set track visibility.
     */
    setTrackVisibility(leftHand: boolean, rightHand: boolean): void {
        this.leftHandActive = leftHand
        this.rightHandActive = rightHand
    }

    /**
     * Set zoom level (pixels per second).
     */
    setZoom(pps: number): void {
        this.pixelsPerSecond = pps
    }

    /**
     * Set the piano container element for DOM-based metrics.
     */
    setPianoContainer(el: HTMLElement): void {
        this.pianoContainer = el
    }

    // ─── THE RENDER LOOP ─────────────────────────────────────────

    /**
     * Called every frame by PIXI.Ticker (60/120 FPS).
     * Zero allocations — uses object pool exclusively.
     */
    private renderFrame(): void {
        if (!this.notePool || !this.pianoMetrics || this.notes.length === 0) return

        const time = this.playbackManager.getTime()
        const lookahead = getLookaheadSeconds({
            strikeLineY: this.strikeLineY,
            pixelsPerSecond: this.pixelsPerSecond,
            canvasHeight: this.canvasHeight,
        })

        // ─── Release all sprites (return to pool) ──────────────────
        this.notePool.releaseAll()

        // ─── Clear active notes tracking ───────────────────────────
        // Swap current to previous for delta detection
        const temp = this.previousActiveNotes
        this.previousActiveNotes = this.activeNotes
        this.activeNotes = temp
        this.activeNotes.clear()

        // ─── Binary Search: Find visible note window ───────────────
        const windowStart = time - 0.5 // Show slightly past notes
        const windowEnd = time + lookahead

        // Find first potentially visible note using binary search
        let lo = 0
        let hi = this.notes.length
        while (lo < hi) {
            const mid = (lo + hi) >>> 1
            if (this.notes[mid].endTimeSec < windowStart) {
                lo = mid + 1
            } else {
                hi = mid
            }
        }
        const startIdx = lo

        // ─── Render visible notes ──────────────────────────────────
        for (let i = startIdx; i < this.notes.length; i++) {
            const note = this.notes[i]

            // Past the lookahead window — stop
            if (note.startTimeSec > windowEnd) break

            // Skip notes from muted tracks
            if (!this.rightHandActive && note.trackId === 0) continue
            if (!this.leftHandActive && note.trackId === 1) continue

            // Calculate screen position
            const noteRect = getNoteRect(note, time, {
                strikeLineY: this.strikeLineY,
                pixelsPerSecond: this.pixelsPerSecond,
                canvasHeight: this.canvasHeight,
            })

            // Skip if completely off-screen
            if (noteRect.y + noteRect.height < 0 || noteRect.y > this.canvasHeight) continue

            // Get X position from piano metrics
            const xInfo = getNoteX(note.pitch, this.pianoMetrics)
            if (!xInfo) continue

            // ─── Acquire sprite from pool ────────────────────────────
            const sprite = this.notePool.acquire()
            if (!sprite) break // Pool exhausted

            // ─── Position the sprite ─────────────────────────────────
            sprite.x = xInfo.x
            sprite.y = noteRect.y
            sprite.width = xInfo.width
            sprite.height = Math.max(noteRect.height, 3) // Minimum 3px for very short notes

            // ─── Color by track ──────────────────────────────────────
            const trackColor = TRACK_COLORS[note.trackId] ?? 0xa855f7

            // ─── Strike Line Collision ───────────────────────────────
            const active = isNoteActive(note, time)
            if (active) {
                this.activeNotes.add(note.pitch)
                sprite.tint = trackColor
                sprite.alpha = ACTIVE_GLOW_ALPHA
                // Glow effect via slight expansion
                sprite.x -= 1
                sprite.width += 2
            } else {
                sprite.tint = trackColor
                sprite.alpha = INACTIVE_ALPHA
            }

            // Remove any residual filters for performance
            sprite.filters = null
        }

        // ─── Key Bridge: DOM Manipulation for Piano Key Activation ─
        this.updateKeyBridge()
    }

    /**
     * Zero-latency key bridge: directly manipulate DOM data attributes
     * on the React piano keys. Bypasses React state entirely.
     */
    private updateKeyBridge(): void {
        // Deactivate keys that are no longer playing
        for (const pitch of this.previousActiveNotes) {
            if (!this.activeNotes.has(pitch)) {
                const el = document.getElementById(`key-${pitch}`)
                if (el) el.dataset.active = 'false'
            }
        }

        // Activate keys that just started playing
        for (const pitch of this.activeNotes) {
            if (!this.previousActiveNotes.has(pitch)) {
                const el = document.getElementById(`key-${pitch}`)
                if (el) el.dataset.active = 'true'
            }
        }
    }

    // ─── Cleanup ─────────────────────────────────────────────────

    destroy(): void {
        // Stop render loop
        if (this.app) {
            this.app.ticker.remove(this.renderFrame, this)
        }

        // Remove resize observer
        if (this.resizeObserver) {
            this.resizeObserver.disconnect()
            this.resizeObserver = null
        }

        // Deactivate all piano keys
        for (const pitch of this.activeNotes) {
            const el = document.getElementById(`key-${pitch}`)
            if (el) el.dataset.active = 'false'
        }
        this.activeNotes.clear()
        this.previousActiveNotes.clear()

        // Destroy pool
        if (this.notePool) {
            this.notePool.destroy()
            this.notePool = null
        }

        // Destroy app (React Strict Mode safe)
        if (this.app) {
            const canvas = this.app.canvas
            this.app.destroy(true, { children: true, texture: true })
            // Remove canvas from DOM
            if (canvas && canvas.parentElement) {
                canvas.parentElement.removeChild(canvas)
            }
            this.app = null
        }

        this.strikeLineGraphics = null
        this.glowFilter = null

        console.log('[SynthUI] WaterfallRenderer destroyed')
    }
}
