'use client'

import * as React from 'react'
import { Toolbar } from './Toolbar'
import { PianoKeyboard } from './PianoKeyboard'
import { TransportBar } from './TransportBar'
import type { AppState } from '@/lib/types'

interface AppLayoutProps {
  // Ref to expose the PixiJS canvas container
  canvasContainerRef?: React.RefObject<HTMLDivElement | null>
}

export const AppLayout: React.FC<AppLayoutProps> = ({ canvasContainerRef }) => {
  // Dummy State (Step 14) - Makes UI interactive in preview
  // Can be replaced with Zustand store later
  const [state, setState] = React.useState<AppState>({
    isPlaying: false,
    currentTime: 0,
    duration: 225, // 3:45 in seconds
    tempo: 100,
    leftHandActive: true,
    rightHandActive: true,
    songTitle: 'Chopin - Nocturne Op. 9 No. 2',
  })

  // Simulate playback progress
  React.useEffect(() => {
    if (!state.isPlaying) return

    const interval = setInterval(() => {
      setState((prev) => ({
        ...prev,
        currentTime: prev.currentTime >= prev.duration ? 0 : prev.currentTime + 0.1,
      }))
    }, 100)

    return () => clearInterval(interval)
  }, [state.isPlaying, state.duration])

  // Handlers
  const handlePlayPause = () => {
    setState((prev) => ({ ...prev, isPlaying: !prev.isPlaying }))
  }

  const handleStop = () => {
    setState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }))
  }

  const handleStepBackward = () => {
    setState((prev) => ({ ...prev, currentTime: Math.max(0, prev.currentTime - 5) }))
  }

  const handleTimeChange = (time: number) => {
    setState((prev) => ({ ...prev, currentTime: time }))
  }

  const handleTempoChange = (tempo: number) => {
    setState((prev) => ({ ...prev, tempo }))
  }

  const handleLeftHandToggle = () => {
    setState((prev) => ({ ...prev, leftHandActive: !prev.leftHandActive }))
  }

  const handleRightHandToggle = () => {
    setState((prev) => ({ ...prev, rightHandActive: !prev.rightHandActive }))
  }

  const handleLoadMidi = () => {
    // Placeholder - would open file dialog
    console.log('[v0] Load MIDI clicked')
  }

  const handleOpenSettings = () => {
    // Placeholder - would open settings modal
    console.log('[v0] Settings clicked')
  }

  // Internal ref if none provided
  const internalCanvasRef = React.useRef<HTMLDivElement>(null)
  const containerRef = canvasContainerRef || internalCanvasRef

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950 text-slate-200 flex flex-col">
      {/* Top Toolbar - Absolute positioned overlay (Step 3) */}
      <Toolbar
        songTitle={state.songTitle}
        onLoadMidi={handleLoadMidi}
        onOpenSettings={handleOpenSettings}
      />

      {/* The Graphics Shell - Canvas Mount Point (Step 2) */}
      <div className="flex-1 relative" style={{ height: '65vh' }}>
        <div
          id="pixi-canvas-container"
          ref={containerRef}
          className="relative w-full h-full z-0 bg-black/50"
        >
          {/* PRIMARY AI: INJECT PIXIJS CANVAS HERE */}
          
          {/* Placeholder visual - can be removed when engine is mounted */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center space-y-4 opacity-30">
              <div className="w-16 h-16 mx-auto rounded-full border-2 border-dashed border-zinc-600 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-purple-500 animate-pulse" />
              </div>
              <p className="text-zinc-600 text-sm font-medium">
                PixiJS Canvas Mount Point
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Piano Keyboard (Step 4-7) */}
      <PianoKeyboard ref={containerRef} />

      {/* Transport Bar Controls (Step 8-13) */}
      <TransportBar
        isPlaying={state.isPlaying}
        currentTime={state.currentTime}
        duration={state.duration}
        tempo={state.tempo}
        leftHandActive={state.leftHandActive}
        rightHandActive={state.rightHandActive}
        onPlayPause={handlePlayPause}
        onStop={handleStop}
        onStepBackward={handleStepBackward}
        onTimeChange={handleTimeChange}
        onTempoChange={handleTempoChange}
        onLeftHandToggle={handleLeftHandToggle}
        onRightHandToggle={handleRightHandToggle}
      />
    </div>
  )
}

export default AppLayout
