'use client'

import * as React from 'react'
import { Toolbar } from './Toolbar'
import { PianoKeyboard } from './PianoKeyboard'
import { TransportBar } from './TransportBar'
import { useSynthStore } from '@/lib/store'
import { parseMidiFile } from '@/lib/midi/parser'

interface AppLayoutProps {
  canvasContainerRef?: React.RefObject<HTMLDivElement | null>
}

export const AppLayout: React.FC<AppLayoutProps> = ({ canvasContainerRef }) => {
  // ─── Zustand Store ──────────────────────────────────────────────
  const isPlaying = useSynthStore((s) => s.isPlaying)
  const tempo = useSynthStore((s) => s.tempo)
  const leftHandActive = useSynthStore((s) => s.leftHandActive)
  const rightHandActive = useSynthStore((s) => s.rightHandActive)
  const songTitle = useSynthStore((s) => s.songTitle)
  const duration = useSynthStore((s) => s.duration)

  const setPlaying = useSynthStore((s) => s.setPlaying)
  const setTempo = useSynthStore((s) => s.setTempo)
  const toggleLeftHand = useSynthStore((s) => s.toggleLeftHand)
  const toggleRightHand = useSynthStore((s) => s.toggleRightHand)
  const loadMidi = useSynthStore((s) => s.loadMidi)

  // ─── Display Time (ref-based, NOT React state) ──────────────────
  // This will be updated by PlaybackManager via rAF loop in Phase 4.
  // For now, we use a local ref + rAF to update the transport bar display.
  const displayTimeRef = React.useRef(0)
  const [displayTime, setDisplayTime] = React.useState(0)

  // Simulate playback time for transport bar display
  // Will be replaced by PlaybackManager in Phase 4
  React.useEffect(() => {
    if (!isPlaying) return

    let lastTimestamp: number | null = null
    let rafId: number

    const tick = (timestamp: number) => {
      if (lastTimestamp !== null) {
        const deltaSec = ((timestamp - lastTimestamp) / 1000) * (tempo / 100)
        displayTimeRef.current = Math.min(
          displayTimeRef.current + deltaSec,
          duration
        )
        // Update display at ~15fps to avoid excessive React re-renders
        setDisplayTime(displayTimeRef.current)
      }
      lastTimestamp = timestamp
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [isPlaying, tempo, duration])

  // ─── Hidden File Input for MIDI loading ─────────────────────────
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const handleLoadMidi = () => {
    fileInputRef.current?.click()
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const buffer = await file.arrayBuffer()
      const parsed = parseMidiFile(buffer, file.name)
      loadMidi(parsed)
      displayTimeRef.current = 0
      setDisplayTime(0)
      console.log('[SynthUI] MIDI loaded:', parsed.name, `${parsed.notes.length} notes, ${parsed.durationSec.toFixed(1)}s`)
      console.log('[SynthUI] Tracks:', parsed.trackCount, '| Tempo changes:', parsed.tempoChanges.length)
      console.log('[SynthUI] First 5 notes:', parsed.notes.slice(0, 5))
    } catch (err) {
      console.error('[SynthUI] Failed to parse MIDI file:', err)
    }

    // Reset input so re-selecting the same file triggers onChange
    e.target.value = ''
  }

  // ─── Handlers ──────────────────────────────────────────────────
  const handlePlayPause = () => {
    setPlaying(!isPlaying)
  }

  const handleStop = () => {
    setPlaying(false)
    displayTimeRef.current = 0
    setDisplayTime(0)
  }

  const handleStepBackward = () => {
    displayTimeRef.current = Math.max(0, displayTimeRef.current - 5)
    setDisplayTime(displayTimeRef.current)
  }

  const handleTimeChange = (time: number) => {
    displayTimeRef.current = time
    setDisplayTime(time)
  }

  const handleTempoChange = (newTempo: number) => {
    setTempo(newTempo)
  }

  const handleOpenSettings = () => {
    console.log('[SynthUI] Settings clicked')
  }

  // ─── Canvas Container Ref ──────────────────────────────────────
  const internalCanvasRef = React.useRef<HTMLDivElement>(null)
  const containerRef = canvasContainerRef || internalCanvasRef

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950 text-slate-200 flex flex-col">
      {/* Hidden file input for MIDI loading */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mid,.midi"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Top Toolbar */}
      <Toolbar
        songTitle={songTitle}
        onLoadMidi={handleLoadMidi}
        onOpenSettings={handleOpenSettings}
      />

      {/* The Graphics Shell - Canvas Mount Point */}
      <div className="flex-1 relative" style={{ height: '65vh' }}>
        <div
          id="pixi-canvas-container"
          ref={containerRef}
          className="relative w-full h-full z-0 bg-black/50"
        >
          {/* Placeholder visual - removed when PixiJS engine mounts in Phase 5 */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center space-y-4 opacity-30">
              <div className="w-16 h-16 mx-auto rounded-full border-2 border-dashed border-zinc-600 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-purple-500 animate-pulse" />
              </div>
              <p className="text-zinc-600 text-sm font-medium">
                {songTitle ? 'Engine ready — Play to begin' : 'Load a MIDI file to begin'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Piano Keyboard */}
      <PianoKeyboard ref={containerRef} />

      {/* Transport Bar Controls */}
      <TransportBar
        isPlaying={isPlaying}
        currentTime={displayTime}
        duration={duration}
        tempo={tempo}
        leftHandActive={leftHandActive}
        rightHandActive={rightHandActive}
        onPlayPause={handlePlayPause}
        onStop={handleStop}
        onStepBackward={handleStepBackward}
        onTimeChange={handleTimeChange}
        onTempoChange={handleTempoChange}
        onLeftHandToggle={toggleLeftHand}
        onRightHandToggle={toggleRightHand}
      />
    </div>
  )
}

export default AppLayout
