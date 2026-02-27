/**
 * NotePool — Object Pool for PixiJS Sprites (Zero GC)
 *
 * CRITICAL RULES:
 * 1. Pre-allocate all sprites on startup
 * 2. NEVER use `new` or `.destroy()` inside the render loop
 * 3. acquire() / release() to manage active/inactive sprites
 */

import { Container, Graphics, NineSliceSprite, RenderTexture } from 'pixi.js'
import type { Application } from 'pixi.js'

export class NotePool {
    private pool: NineSliceSprite[] = []
    private activeCount = 0
    private container: Container
    private noteTexture: RenderTexture | null = null

    constructor(
        private app: Application,
        private poolSize: number = 1500
    ) {
        this.container = new Container()
        this.container.label = 'note-pool'
        this.app.stage.addChild(this.container)
    }

    /**
     * Initialize the pool: bake the note texture and pre-allocate sprites.
     * Call once after the app is initialized.
     */
    async init(): Promise<void> {
        // ─── Bake the 2.5D Note Texture ──────────────────────────────
        // Pre-render a rounded rectangle with gradient and inner shadow
        this.noteTexture = this.bakeNoteTexture()

        // ─── Pre-allocate Sprites ────────────────────────────────────
        for (let i = 0; i < this.poolSize; i++) {
            const sprite = new NineSliceSprite({
                texture: this.noteTexture!,
                leftWidth: 6,
                rightWidth: 6,
                topHeight: 6,
                bottomHeight: 6
            })
            sprite.visible = false
            sprite.label = `note-${i}`
            this.container.addChild(sprite)
            this.pool.push(sprite)
        }

        console.log(`[SynthUI] NotePool initialized: ${this.poolSize} sprites pre-allocated`)
    }

    /**
     * Bake a reusable note texture with 2.5D appearance.
     * This creates a rounded rectangle with a vertical gradient,
     * inner highlight, and subtle shadow.
     */
    private bakeNoteTexture(): RenderTexture {
        const width = 64
        const height = 64
        const radius = 6

        const g = new Graphics()

        // Main body with subtle gradient effect using layered fills
        // Base (darker)
        g.roundRect(0, 0, width, height, radius)
        g.fill({ color: 0xFFFFFF, alpha: 0.9 })

        // Inner highlight (top portion for 3D effect)
        g.roundRect(1, 1, width - 2, height * 0.4, radius)
        g.fill({ color: 0xFFFFFF, alpha: 0.3 })

        // Inner shadow (bottom edge)
        g.roundRect(1, height * 0.7, width - 2, height * 0.28, radius)
        g.fill({ color: 0x000000, alpha: 0.15 })

        // Subtle border
        g.roundRect(0.5, 0.5, width - 1, height - 1, radius)
        g.stroke({ color: 0xFFFFFF, width: 0.5, alpha: 0.2 })

        const texture = RenderTexture.create({ width, height })
        this.app.renderer.render({ container: g, target: texture })
        g.destroy()

        return texture
    }

    /**
     * Acquire a sprite from the pool. Returns null if pool is exhausted.
     * ZERO ALLOCATION — just makes an existing sprite visible.
     */
    acquire(): NineSliceSprite | null {
        if (this.activeCount >= this.poolSize) return null

        const sprite = this.pool[this.activeCount]
        sprite.visible = true
        this.activeCount++
        return sprite
    }

    /**
     * Release ALL sprites back to the pool (hide them all).
     * Called at the beginning of each render frame.
     */
    releaseAll(): void {
        for (let i = 0; i < this.activeCount; i++) {
            this.pool[i].visible = false
        }
        this.activeCount = 0
    }

    /**
     * Get the container for z-ordering.
     */
    getContainer(): Container {
        return this.container
    }

    /**
     * Cleanup.
     */
    destroy(): void {
        this.container.destroy({ children: true })
        if (this.noteTexture) {
            this.noteTexture.destroy(true)
            this.noteTexture = null
        }
    }
}
