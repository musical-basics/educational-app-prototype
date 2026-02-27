'use client'

import * as React from 'react'
import { 
  Play, 
  Pause, 
  Square, 
  SkipBack,
  Hand,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { TransportBarProps } from '@/lib/types'

// Format time as MM:SS
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export const TransportBar: React.FC<TransportBarProps> = ({
  isPlaying,
  currentTime,
  duration,
  tempo,
  leftHandActive,
  rightHandActive,
  onPlayPause,
  onStop,
  onStepBackward,
  onTimeChange,
  onTempoChange,
  onLeftHandToggle,
  onRightHandToggle,
}) => {
  return (
    <div className="w-full bg-zinc-900 border-t border-zinc-800 p-4 flex flex-col gap-4">
      {/* Timeline Scrubber (Step 9) */}
      <div className="flex items-center gap-4">
        {/* Current Time */}
        <span className="font-mono text-sm text-zinc-400 w-14 text-right tabular-nums">
          {formatTime(currentTime)}
        </span>

        {/* Progress Slider */}
        <div className="flex-1 relative">
          <Slider
            value={[currentTime]}
            min={0}
            max={duration || 100}
            step={0.1}
            onValueChange={(value) => onTimeChange(value[0])}
            className="[&_[data-slot=slider-track]]:bg-zinc-700 [&_[data-slot=slider-range]]:bg-purple-500 [&_[data-slot=slider-thumb]]:border-purple-500 [&_[data-slot=slider-thumb]]:bg-zinc-900"
          />
        </div>

        {/* Duration */}
        <span className="font-mono text-sm text-zinc-400 w-14 tabular-nums">
          {formatTime(duration)}
        </span>
      </div>

      {/* Controls Row */}
      <div className="flex items-center justify-between gap-4">
        {/* Track Isolation - Left Side (Step 11) */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 uppercase tracking-wider mr-2 hidden sm:inline">
            Tracks
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={onLeftHandToggle}
            className={cn(
              'rounded-full px-4 transition-all',
              leftHandActive
                ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700 hover:text-white'
                : 'bg-transparent border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
            )}
          >
            <Hand className="h-4 w-4 mr-1.5 scale-x-[-1]" />
            <span className="hidden sm:inline">Left</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRightHandToggle}
            className={cn(
              'rounded-full px-4 transition-all',
              rightHandActive
                ? 'bg-green-600 border-green-600 text-white hover:bg-green-700 hover:text-white'
                : 'bg-transparent border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
            )}
          >
            <Hand className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Right</span>
          </Button>
        </div>

        {/* Primary Playback Controls - Center (Step 10) */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onStepBackward}
            className="text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <SkipBack className="h-5 w-5" />
            <span className="sr-only">Step Backward</span>
          </Button>

          <Button
            size="lg"
            onClick={onPlayPause}
            className="bg-purple-600 hover:bg-purple-700 text-white rounded-full w-14 h-14 shadow-lg shadow-purple-600/25"
          >
            {isPlaying ? (
              <Pause className="h-6 w-6" />
            ) : (
              <Play className="h-6 w-6 ml-0.5" />
            )}
            <span className="sr-only">{isPlaying ? 'Pause' : 'Play'}</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={onStop}
            className="text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <Square className="h-5 w-5" />
            <span className="sr-only">Stop</span>
          </Button>
        </div>

        {/* Settings & Tempo - Right Side (Step 12) */}
        <div className="flex items-center gap-4">
          {/* Tempo Slider */}
          <div className="hidden md:flex items-center gap-2">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              Tempo
            </span>
            <Slider
              value={[tempo]}
              min={50}
              max={200}
              step={5}
              onValueChange={(value) => onTempoChange(value[0])}
              className="w-24 [&_[data-slot=slider-track]]:bg-zinc-700 [&_[data-slot=slider-range]]:bg-zinc-500 [&_[data-slot=slider-thumb]]:border-zinc-500"
            />
            <span className="font-mono text-sm text-zinc-400 w-12 tabular-nums">
              {tempo}%
            </span>
          </div>

          {/* Key/Transpose Dropdown (Step 13) */}
          <div className="hidden lg:flex items-center gap-2">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              Key
            </span>
            <Select defaultValue="0">
              <SelectTrigger className="w-20 h-8 bg-zinc-800 border-zinc-700 text-zinc-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                {Array.from({ length: 25 }, (_, i) => i - 12).map((semitone) => (
                  <SelectItem
                    key={semitone}
                    value={semitone.toString()}
                    className="text-zinc-300"
                  >
                    {semitone > 0 ? `+${semitone}` : semitone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TransportBar
