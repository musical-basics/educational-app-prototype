// TypeScript Prop Interface (Step 14)
// Defines the AppState interface for UI components
// This allows easy integration with a Zustand store later

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
