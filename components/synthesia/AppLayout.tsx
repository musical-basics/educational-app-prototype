'use client'

import * as React from 'react'
import { Toolbar } from './Toolbar'
import { PianoKeyboard } from './PianoKeyboard'
import { TransportBar } from './TransportBar'
import { useSynthStore } from '@/lib/store'
import { parseMidiFile } from '@/lib/midi/parser'
import { getPlaybackManager, destroyPlaybackManager } from '@/lib/engine/PlaybackManager'
import { AudioSynth } from '@/lib/engine/AudioSynth'
import type { WaterfallRenderer } from '@/lib/engine/WaterfallRenderer'

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

  // ─── Local state ────────────────────────────────────────────────
  const [volume, setVolume] = React.useState(100)

  // ─── Refs (never trigger re-renders) ────────────────────────────
  const audioSynthRef = React.useRef<AudioSynth | null>(null)
  const rendererRef = React.useRef<WaterfallRenderer | null>(null)
  const schedulerTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const displayRafRef = React.useRef<number>(0)
  const lastDisplayUpdateRef = React.useRef<number>(0)

  // Display time state — updated at ~5fps to minimize React re-renders
  const [displayTime, setDisplayTime] = React.useState(0)
  const [rendererReady, setRendererReady] = React.useState(false)

  // ─── Canvas Container Ref ──────────────────────────────────────
  const internalCanvasRef = React.useRef<HTMLDivElement>(null)
  const containerRef = canvasContainerRef || internalCanvasRef

  // ─── Initialize WaterfallRenderer (dynamic import, SSR-safe) ────
  React.useEffect(() => {
    let isCancelled = false
    let localRenderer: WaterfallRenderer | null = null

    const initRenderer = async () => {
      const container = document.getElementById('pixi-canvas-container')
      if (!container) return

      try {
        const { WaterfallRenderer: WR } = await import('@/lib/engine/WaterfallRenderer')
        if (isCancelled) return
        const pm = getPlaybackManager()
        localRenderer = new WR(container, pm)
        await localRenderer.init()

        // CRITICAL FIX: If React unmounted us while waiting, destroy the phantom canvas immediately!
        if (isCancelled) {
          if (localRenderer) localRenderer.destroy()
          return
        }

        rendererRef.current = localRenderer
        setRendererReady(true)
        console.log('[SynthUI] Renderer mounted and ready')
      } catch (err) {
        console.error('[SynthUI] Failed to initialize renderer:', err)
      }
    }

    initRenderer()

    return () => {
      isCancelled = true // Prevent the async block from applying if it hasn't finished

      if (rendererRef.current) {
        rendererRef.current.destroy()
        rendererRef.current = null
      } else if (localRenderer) {
        // Catch the race condition where init finished but ref wasn't set
        localRenderer.destroy()
        localRenderer = null
      }

      setRendererReady(false)
    }
  }, [])


  // ─── Cleanup on unmount ─────────────────────────────────────────
  React.useEffect(() => {
    return () => {
      if (displayRafRef.current) cancelAnimationFrame(displayRafRef.current)
      if (schedulerTimerRef.current) clearInterval(schedulerTimerRef.current)
      audioSynthRef.current?.destroy()
      audioSynthRef.current = null
      destroyPlaybackManager()
    }
  }, [])

  // ─── Sync track visibility to renderer ──────────────────────────
  React.useEffect(() => {
    rendererRef.current?.setTrackVisibility(leftHandActive, rightHandActive)
  }, [leftHandActive, rightHandActive])

  // ─── Sync MIDI data to renderer ─────────────────────────────────
  React.useEffect(() => {
    if (parsedMidi && rendererRef.current) {
      rendererRef.current.loadNotes(parsedMidi)
    }
  }, [parsedMidi, rendererReady])

  // ─── Display Time Update Loop ───────────────────────────────────
  // Update React state for transport bar at ~5fps to minimize jitter.
  // The PixiJS renderer polls PlaybackManager directly at 60fps independently.
  React.useEffect(() => {
    const tick = (timestamp: number) => {
      // Only update React state every 500ms (~2fps) to minimize main-thread re-renders
      if (timestamp - lastDisplayUpdateRef.current > 500) {
        lastDisplayUpdateRef.current = timestamp
        const pm = getPlaybackManager()
        const currentT = pm.getTime()
        setDisplayTime(currentT)

        // Sync isPlaying if PlaybackManager stopped (end of song)
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
  React.useEffect(() => {
    if (!isPlaying || !parsedMidi) return

    const scheduleChunk = () => {
      const pm = getPlaybackManager()
      const synth = audioSynthRef.current
      if (!synth?.loaded || !pm.isPlaying) return

      const mutedTracks = new Set<number>()
      if (!rightHandActive && parsedMidi.trackCount > 0) mutedTracks.add(0)
      if (!leftHandActive && parsedMidi.trackCount > 1) mutedTracks.add(1)

      const ctx = pm.getAudioContext()
      const count = synth.scheduleNotes(
        parsedMidi.notes,
        ctx.currentTime,
        pm.getTime(),
        tempo / 100,
        mutedTracks
      )

      if (count > 0 && false) { // Disabled: console.log stalls the main thread
        console.log(`[SynthUI Audio] Scheduled ${count} notes`)
      }
    }

    // Schedule immediately and then every 1.5 seconds
    scheduleChunk()
    schedulerTimerRef.current = setInterval(scheduleChunk, 1500)

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

      const pm = getPlaybackManager()
      pm.duration = parsed.durationSec
      pm.seek(0)

      // Load notes into renderer
      rendererRef.current?.loadNotes(parsed)

      // Initialize audio on first user interaction (autoplay policy)
      if (!audioSynthRef.current) {
        console.log('[SynthUI Audio] Initializing audio on user interaction...')
        await pm.ensureResumed()
        console.log('[SynthUI Audio] AudioContext resumed, state:', pm.getAudioContext().state)
        const synth = new AudioSynth(pm.getAudioContext())
        await synth.load()
        synth.setVolume(volume)
        audioSynthRef.current = synth

        // Play a test note to confirm audio works
        synth.playTestNote(60)
      }

      console.log('[SynthUI] MIDI loaded:', parsed.name, `${parsed.notes.length} notes, ${parsed.durationSec.toFixed(1)}s`)
    } catch (err) {
      console.error('[SynthUI] Failed to parse MIDI file:', err)
    }

    e.target.value = ''
  }

  // ─── Transport Handlers ─────────────────────────────────────────
  const handlePlayPause = async () => {
    const pm = getPlaybackManager()

    if (isPlaying) {
      pm.pause()
      audioSynthRef.current?.silence() // Silence but keep dedup — prevents re-trigger on unpause
      setPlaying(false)
    } else {
      if (!audioSynthRef.current) {
        console.log('[SynthUI Audio] Initializing audio on Play...')
        await pm.ensureResumed()
        const synth = new AudioSynth(pm.getAudioContext())
        await synth.load()
        synth.setVolume(volume)
        audioSynthRef.current = synth
      }

      pm.setPlaybackRate(tempo / 100)
      audioSynthRef.current?.clearScheduled() // Clear dedup so notes re-schedule from current position
      await pm.play()
      setPlaying(true)
    }
  }

  // ─── Spacebar Play/Pause shortcut ─────────────────────────────────
  const handlePlayPauseRef = React.useRef(handlePlayPause)
  React.useEffect(() => { handlePlayPauseRef.current = handlePlayPause })

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        // Don't trigger if user is typing in an input/textarea
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        e.preventDefault()
        handlePlayPauseRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume)
    audioSynthRef.current?.setVolume(newVolume)
  }

  const handleOpenSettings = () => {
    console.log('[SynthUI] Settings clicked')
  }

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
          {/* Placeholder - hidden once renderer is ready */}
          {!rendererReady && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center space-y-4 opacity-30">
                <div className="w-16 h-16 mx-auto rounded-full border-2 border-dashed border-zinc-600 flex items-center justify-center">
                  <div className="w-3 h-3 rounded-full bg-purple-500 animate-pulse" />
                </div>
                <p className="text-zinc-600 text-sm font-medium">
                  Initializing engine...
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Piano Keyboard */}
      <PianoKeyboard />

      {/* Transport Bar Controls */}
      <TransportBar
        isPlaying={isPlaying}
        currentTime={displayTime}
        duration={duration}
        tempo={tempo}
        volume={volume}
        leftHandActive={leftHandActive}
        rightHandActive={rightHandActive}
        onPlayPause={handlePlayPause}
        onStop={handleStop}
        onStepBackward={handleStepBackward}
        onTimeChange={handleTimeChange}
        onTempoChange={handleTempoChange}
        onVolumeChange={handleVolumeChange}
        onLeftHandToggle={toggleLeftHand}
        onRightHandToggle={toggleRightHand}
      />
    </div>
  )
}

export default AppLayout
