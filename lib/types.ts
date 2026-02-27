// TypeScript interfaces for SynthUI
// Core application types

// ─── MIDI Data Types ───────────────────────────────────────────────

/** A single normalized MIDI note event with absolute timing */
export interface NoteEvent {
  id: string
  /** MIDI pitch: 21 (A0) to 108 (C8) */
  pitch: number
  /** Absolute start time in seconds */
  startTimeSec: number
  /** Absolute end time in seconds */
  endTimeSec: number
  /** Duration in seconds */
  durationSec: number
  /** Note velocity (0-127) */
  velocity: number
  /** Track index from MIDI file */
  trackId: number
}

/** Parsed MIDI file data */
export interface ParsedMidi {
  /** Song/file name */
  name: string
  /** Total duration in seconds */
  durationSec: number
  /** Flattened, sorted (by startTimeSec) note events */
  notes: NoteEvent[]
  /** Number of tracks */
  trackCount: number
  /** Tempo map entries */
  tempoChanges: { time: number; bpm: number }[]
}

// ─── UI Component Props ────────────────────────────────────────────

export interface AppState {
  isPlaying: boolean
  currentTime: number
  duration: number
  tempo: number
  leftHandActive: boolean
  rightHandActive: boolean
  songTitle: string
}

export interface PianoKeyProps {
  noteNumber: number
  isBlack: boolean
  leftOffset?: number
}

export interface TransportBarProps {
  isPlaying: boolean
  currentTime: number
  duration: number
  tempo: number
  leftHandActive: boolean
  rightHandActive: boolean
  onPlayPause: () => void
  onStop: () => void
  onStepBackward: () => void
  onTimeChange: (time: number) => void
  onTempoChange: (tempo: number) => void
  onLeftHandToggle: () => void
  onRightHandToggle: () => void
}

export interface ToolbarProps {
  songTitle: string
  onLoadMidi: () => void
  onOpenSettings: () => void
}
