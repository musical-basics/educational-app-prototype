'use client'

import * as React from 'react'
import { Toolbar } from './Toolbar'
import { PianoKeyboard } from './PianoKeyboard'
import { TransportBar } from './TransportBar'
import { useSynthStore } from '@/lib/store'
import { parseMidiFile } from '@/lib/midi/parser'
import { getPlaybackManager, destroyPlaybackManager } from '@/lib/engine/PlaybackManager'
import { AudioSynth } from '@/lib/engine/AudioSynth'

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
  const parsedMidi = useSynthStore((s) => s.parsedMidi)

  const setPlaying = useSynthStore((s) => s.setPlaying)
  const setTempo = useSynthStore((s) => s.setTempo)
  const toggleLeftHand = useSynthStore((s) => s.toggleLeftHand)
  const toggleRightHand = useSynthStore((s) => s.toggleRightHand)
  const loadMidi = useSynthStore((s) => s.loadMidi)

  // ─── Refs (never trigger re-renders) ────────────────────────────
  const audioSynthRef = React.useRef<AudioSynth | null>(null)
  const schedulerTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const displayRafRef = React.useRef<number>(0)

  // Display time state — updated via rAF at ~15fps for transport bar
  const [displayTime, setDisplayTime] = React.useState(0)

  // ─── PlaybackManager Setup ──────────────────────────────────────
  // Cleanup on unmount (React Strict Mode safe)
  React.useEffect(() => {
    return () => {
      // Stop any rAF loop
      if (displayRafRef.current) cancelAnimationFrame(displayRafRef.current)
      // Stop scheduler
      if (schedulerTimerRef.current) clearInterval(schedulerTimerRef.current)
      // Destroy audio
      audioSynthRef.current?.destroy()
      audioSynthRef.current = null
      // Destroy PlaybackManager
      destroyPlaybackManager()
    }
  }, [])

  // ─── Display Time Update Loop ───────────────────────────────────
  // Polls PlaybackManager at ~30fps for transport bar display
  React.useEffect(() => {
    let frameCount = 0
    const tick = () => {
      frameCount++
      // Update React state at ~15fps (every other frame at 30fps)
      if (frameCount % 2 === 0) {
        const pm = getPlaybackManager()
        setDisplayTime(pm.getTime())

        // Sync isPlaying state if PlaybackManager stopped (end of song)
        if (!pm.isPlaying && isPlaying) {
          setPlaying(false)
        }
      }
      displayRafRef.current = requestAnimationFrame(tick)
    }

    if (isPlaying) {
      displayRafRef.current = requestAnimationFrame(tick)
    }

    return () => {
      if (displayRafRef.current) {
        cancelAnimationFrame(displayRafRef.current)
        displayRafRef.current = 0
      }
    }
  }, [isPlaying, setPlaying])

  // ─── Audio Note Scheduler ───────────────────────────────────────
  // Schedules notes in batches every 500ms while playing
  React.useEffect(() => {
    if (!isPlaying || !parsedMidi) return

    const scheduleChunk = () => {
      const pm = getPlaybackManager()
      const synth = audioSynthRef.current
      if (!synth?.loaded || !pm.isPlaying) return

      const mutedTracks = new Set<number>()
      // Track 0 is typically right hand, Track 1 is left hand
      // (convention: lower track index = treble/right)
      if (!rightHandActive && parsedMidi.trackCount > 0) mutedTracks.add(0)
      if (!leftHandActive && parsedMidi.trackCount > 1) mutedTracks.add(1)

      const ctx = pm.getAudioContext()
      synth.scheduleNotes(
        parsedMidi.notes,
        ctx.currentTime,
        pm.getTime(),
        tempo / 100,
        mutedTracks
      )
    }

    // Schedule immediately and then every 2 seconds
    scheduleChunk()
    schedulerTimerRef.current = setInterval(scheduleChunk, 2000)

    return () => {
      if (schedulerTimerRef.current) {
        clearInterval(schedulerTimerRef.current)
        schedulerTimerRef.current = null
      }
    }
  }, [isPlaying, parsedMidi, tempo, leftHandActive, rightHandActive])

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
      setDisplayTime(0)

      // Update PlaybackManager duration
      const pm = getPlaybackManager()
      pm.duration = parsed.durationSec
      pm.seek(0)

      // Initialize audio on first user interaction (autoplay policy)
      if (!audioSynthRef.current) {
        await pm.ensureResumed()
        const synth = new AudioSynth(pm.getAudioContext())
        await synth.load()
        audioSynthRef.current = synth
      }

      console.log('[SynthUI] MIDI loaded:', parsed.name, `${parsed.notes.length} notes, ${parsed.durationSec.toFixed(1)}s`)
      console.log('[SynthUI] Tracks:', parsed.trackCount, '| Tempo changes:', parsed.tempoChanges.length)
    } catch (err) {
      console.error('[SynthUI] Failed to parse MIDI file:', err)
    }

    // Reset input so re-selecting the same file triggers onChange
    e.target.value = ''
  }

  // ─── Transport Handlers ─────────────────────────────────────────
  const handlePlayPause = async () => {
    const pm = getPlaybackManager()

    if (isPlaying) {
      pm.pause()
      audioSynthRef.current?.stopAll()
      setPlaying(false)
    } else {
      // Initialize audio if not done yet (first play after load)
      if (!audioSynthRef.current) {
        await pm.ensureResumed()
        const synth = new AudioSynth(pm.getAudioContext())
        await synth.load()
        audioSynthRef.current = synth
      }

      pm.setPlaybackRate(tempo / 100)
      await pm.play()
      setPlaying(true)
    }
  }

  const handleStop = () => {
    const pm = getPlaybackManager()
    pm.stop()
    audioSynthRef.current?.stopAll()
    setPlaying(false)
    setDisplayTime(0)
  }

  const handleStepBackward = () => {
    const pm = getPlaybackManager()
    audioSynthRef.current?.stopAll()
    pm.seek(Math.max(0, pm.getTime() - 5))
    setDisplayTime(pm.getTime())
  }

  const handleTimeChange = (time: number) => {
    const pm = getPlaybackManager()
    audioSynthRef.current?.stopAll()
    pm.seek(time)
    setDisplayTime(time)
  }

  const handleTempoChange = (newTempo: number) => {
    setTempo(newTempo)
    const pm = getPlaybackManager()
    pm.setPlaybackRate(newTempo / 100)
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
                {songTitle ? 'Engine ready — Press Play' : 'Load a MIDI file to begin'}
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
