'use client'

import * as React from 'react'
import { Music, Settings, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ToolbarProps } from '@/lib/types'

export const Toolbar: React.FC<ToolbarProps> = ({
  songTitle,
  onLoadMidi,
  onOpenSettings,
}) => {
  return (
    <div className="absolute top-0 left-0 right-0 z-50 bg-black/40 backdrop-blur-md border-b border-white/10">
      <div className="flex items-center justify-between p-4">
        {/* Left: Logo & Load MIDI */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center">
              <Music className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-white tracking-tight hidden sm:inline">
              SynthUI
            </span>
          </div>

          <Button
            onClick={onLoadMidi}
            className="bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-600/25"
          >
            <Upload className="w-4 h-4 mr-2" />
            Load MIDI
          </Button>
        </div>

        {/* Center: Song Title */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden md:block">
          <h1 className="text-white font-medium text-lg truncate max-w-xs lg:max-w-md text-balance">
            {songTitle || 'No song loaded'}
          </h1>
        </div>

        {/* Right: Settings */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            className="text-zinc-400 hover:text-white hover:bg-white/10"
          >
            <Settings className="w-5 h-5" />
            <span className="sr-only">Settings</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

export default Toolbar
