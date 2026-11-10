'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import {
  Monitor,
  Smartphone,
  Sliders,
  RotateCcw,
  Star,
  Tv,
  Play,
} from 'lucide-react';
import {
  DEFAULT_LOGO_DISPLAY_SETTINGS,
  LogoDisplaySettings,
} from '@/types/artwork';
import { getLogoDisplayTailwindClasses } from '@/lib/artwork/logo-selector';

interface ArtworkPreviewProps {
  animeTitle: string;
  backgroundUrl: string;
  posterUrl: string;
  logoUrl: string | null;
  logoDisplay: LogoDisplaySettings;
  onChangeDisplay: (next: LogoDisplaySettings) => void;
}

export function ArtworkPreview({
  animeTitle,
  backgroundUrl,
  posterUrl,
  logoUrl,
  logoDisplay,
  onChangeDisplay,
}: ArtworkPreviewProps) {
  const [heroType, setHeroType] = useState<'home' | 'details'>('details');
  const [viewportMode, setViewportMode] = useState<'desktop' | 'mobile'>('desktop');

  const logoClasses = getLogoDisplayTailwindClasses(logoDisplay, heroType);

  const handleReset = () => {
    onChangeDisplay({ ...DEFAULT_LOGO_DISPLAY_SETTINGS });
  };

  return (
    <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl overflow-hidden">
      {/* Header Toolbar */}
      <div className="px-4 py-3 border-b border-[#292929] flex flex-wrap items-center justify-between gap-3 bg-[#141414]/60">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-white font-mono">
            Live Hero Preview
          </span>
          <span className="px-2 py-0.5 rounded bg-black border border-[#292929] text-[10px] font-mono text-[#A0A0A0]">
            {logoUrl ? 'TRANSPARENT LOGO' : 'TYPOGRAPHY FALLBACK'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Hero Mode Switcher */}
          <div className="inline-flex rounded-lg bg-black border border-[#292929] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setHeroType('details')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                heroType === 'details'
                  ? 'bg-white text-black font-bold'
                  : 'text-[#A0A0A0] hover:text-white'
              }`}
            >
              Details Hero
            </button>
            <button
              type="button"
              onClick={() => setHeroType('home')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                heroType === 'home'
                  ? 'bg-white text-black font-bold'
                  : 'text-[#A0A0A0] hover:text-white'
              }`}
            >
              Homepage Hero
            </button>
          </div>

          {/* Viewport Switcher */}
          <div className="inline-flex rounded-lg bg-black border border-[#292929] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewportMode('desktop')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                viewportMode === 'desktop'
                  ? 'bg-white text-black font-bold'
                  : 'text-[#A0A0A0] hover:text-white'
              }`}
            >
              <Monitor size={13} />
              <span>Desktop</span>
            </button>
            <button
              type="button"
              onClick={() => setViewportMode('mobile')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                viewportMode === 'mobile'
                  ? 'bg-white text-black font-bold'
                  : 'text-[#A0A0A0] hover:text-white'
              }`}
            >
              <Smartphone size={13} />
              <span>Mobile</span>
            </button>
          </div>
        </div>
      </div>

      {/* Simulated Hero Canvas */}
      <div className="p-4 bg-[#050505] flex justify-center">
        <div
          className={`relative overflow-hidden rounded-xl border border-[#292929] bg-black transition-all ${
            viewportMode === 'mobile'
              ? 'w-[360px] h-[440px]'
              : 'w-full h-[380px] sm:h-[420px]'
          }`}
        >
          {/* Background */}
          {backgroundUrl ? (
            <div className="absolute inset-0">
              <Image
                src={backgroundUrl}
                alt={animeTitle}
                fill
                sizes="100vw"
                className="object-cover object-center opacity-55 brightness-90"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-black/40" />
              <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/75 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent" />
            </div>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#141414] to-black" />
          )}

          {/* Content Layout */}
          <div className="relative z-10 h-full px-6 sm:px-10 py-8 flex items-center gap-6 sm:gap-10">
            {heroType === 'details' && viewportMode === 'desktop' && posterUrl && (
              <div className="w-[150px] sm:w-[175px] aspect-[2/3] relative rounded-xl overflow-hidden border border-white/15 shadow-2xl shrink-0 hidden sm:block">
                <Image
                  src={posterUrl}
                  alt={animeTitle}
                  fill
                  sizes="180px"
                  className="object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            )}

            <div className="flex-1 min-w-0 flex flex-col justify-center space-y-2.5">
              {heroType === 'details' && (
                <div className="text-xs font-medium text-[#A0A0A0] truncate">
                  {animeTitle}
                </div>
              )}

              <div className="py-1 overflow-visible">
                {logoUrl ? (
                  <div
                    className={`relative w-full ${logoClasses} filter drop-shadow-[0_4px_20px_rgba(0,0,0,0.95)] transition-all`}
                  >
                    <Image
                      src={logoUrl}
                      alt={animeTitle}
                      fill
                      sizes="520px"
                      className="object-contain object-left"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ) : (
                  <h2 className="text-2xl sm:text-4xl font-black tracking-tight text-white">
                    {animeTitle}
                  </h2>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs text-white/90 font-semibold">
                <span className="inline-flex items-center gap-1">
                  <Star size={13} fill="currentColor" />
                  89.0
                </span>
                <span className="inline-flex items-center gap-1 text-[#A0A0A0]">
                  <Tv size={13} />
                  TV
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-black/50 border border-white/15 text-[11px]">
                  Action
                </span>
              </div>

              <div className="pt-2 flex items-center gap-2.5">
                <span className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-white text-black font-bold text-xs">
                  <Play size={13} fill="currentColor" />
                  <span>{heroType === 'details' ? 'Play Episode 1' : 'View Details'}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Logo Sizing, Scale & Position Controls */}
      <div className="p-4 border-t border-[#292929] bg-[#0D0D0D] space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-white uppercase font-mono">
            <Sliders size={14} />
            <span>Logo Sizing & Alignment Controls</span>
          </div>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1 text-xs font-mono text-[#A0A0A0] hover:text-white cursor-pointer"
          >
            <RotateCcw size={12} />
            <span>Reset Defaults</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Width */}
          <div className="p-3 rounded-lg bg-[#141414] border border-[#292929] space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#A0A0A0]">Max Width</span>
              <span className="font-mono font-bold text-white tabular-nums">
                {logoDisplay.width}px
              </span>
            </div>
            <input
              type="range"
              min={240}
              max={620}
              step={20}
              value={logoDisplay.width}
              onChange={(e) =>
                onChangeDisplay({
                  ...logoDisplay,
                  width: Number(e.target.value),
                })
              }
              className="w-full accent-white cursor-pointer"
            />
          </div>

          {/* Scale */}
          <div className="p-3 rounded-lg bg-[#141414] border border-[#292929] space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#A0A0A0]">Logo Scale</span>
              <span className="font-mono font-bold text-white tabular-nums">
                {logoDisplay.scale}%
              </span>
            </div>
            <input
              type="range"
              min={75}
              max={125}
              step={5}
              value={logoDisplay.scale}
              onChange={(e) =>
                onChangeDisplay({
                  ...logoDisplay,
                  scale: Number(e.target.value),
                })
              }
              className="w-full accent-white cursor-pointer"
            />
          </div>

          {/* Horizontal Offset */}
          <div className="p-3 rounded-lg bg-[#141414] border border-[#292929] space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#A0A0A0]">Horizontal Offset</span>
              <span className="font-mono font-bold text-white tabular-nums">
                {logoDisplay.horizontalPosition > 0
                  ? `+${logoDisplay.horizontalPosition}px`
                  : `${logoDisplay.horizontalPosition}px`}
              </span>
            </div>
            <input
              type="range"
              min={-32}
              max={32}
              step={16}
              value={logoDisplay.horizontalPosition}
              onChange={(e) =>
                onChangeDisplay({
                  ...logoDisplay,
                  horizontalPosition: Number(e.target.value),
                })
              }
              className="w-full accent-white cursor-pointer"
            />
          </div>

          {/* Vertical Offset */}
          <div className="p-3 rounded-lg bg-[#141414] border border-[#292929] space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#A0A0A0]">Vertical Offset</span>
              <span className="font-mono font-bold text-white tabular-nums">
                {logoDisplay.verticalPosition > 0
                  ? `+${logoDisplay.verticalPosition}px`
                  : `${logoDisplay.verticalPosition}px`}
              </span>
            </div>
            <input
              type="range"
              min={-24}
              max={24}
              step={12}
              value={logoDisplay.verticalPosition}
              onChange={(e) =>
                onChangeDisplay({
                  ...logoDisplay,
                  verticalPosition: Number(e.target.value),
                })
              }
              className="w-full accent-white cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
