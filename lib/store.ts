import { create } from 'zustand'
import type { ParsedMidi } from './types'

// ─── Store Interface ───────────────────────────────────────────────
// CRITICAL: currentTime and animation frame data are NEVER stored here.
// They live in PlaybackManager (polled by PixiJS Ticker) to avoid
// React re-rendering 60+ times per second.

interface SynthStore {
    // Playback state (UI-driven, not time-critical)
    isPlaying: boolean
    tempo: number // percentage (50-200), default 100
    leftHandActive: boolean
    rightHandActive: boolean

    // MIDI data
    parsedMidi: ParsedMidi | null
    songTitle: string
    duration: number // total song duration in seconds

    // Display
    zoomLevel: number // pixels per second for waterfall

    // Actions
    setPlaying: (playing: boolean) => void
    setTempo: (tempo: number) => void
    toggleLeftHand: () => void
    toggleRightHand: () => void
    loadMidi: (midi: ParsedMidi) => void
    clearMidi: () => void
    setZoomLevel: (zoom: number) => void
}

export const useSynthStore = create<SynthStore>((set) => ({
    // Initial state
    isPlaying: false,
    tempo: 100,
    leftHandActive: true,
    rightHandActive: true,
    parsedMidi: null,
    songTitle: '',
    duration: 0,
    zoomLevel: 200, // 200 pixels per second default

    // Actions
    setPlaying: (playing) => set({ isPlaying: playing }),
    setTempo: (tempo) => set({ tempo }),
    toggleLeftHand: () => set((s) => ({ leftHandActive: !s.leftHandActive })),
    toggleRightHand: () => set((s) => ({ rightHandActive: !s.rightHandActive })),
    loadMidi: (midi) =>
        set({
            parsedMidi: midi,
            songTitle: midi.name,
            duration: midi.durationSec,
        }),
    clearMidi: () =>
        set({
            parsedMidi: null,
            songTitle: '',
            duration: 0,
            isPlaying: false,
        }),
    setZoomLevel: (zoom) => set({ zoomLevel: zoom }),
}))
