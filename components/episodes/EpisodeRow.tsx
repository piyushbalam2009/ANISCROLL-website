'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Play, Film, Check, Radio } from 'lucide-react';
import { HoshikaEpisodeItem } from '@/types/anime';
import { WatchHistoryEntry } from '@/types/streaming';

interface EpisodeRowProps {
  animeId: string | number;
  episode: HoshikaEpisodeItem;
  isCurrent?: boolean;
  historyEntry?: WatchHistoryEntry | null;
  className?: string;
}

export function EpisodeRow({
  animeId,
  episode,
  isCurrent = false,
  historyEntry,
  className = '',
}: EpisodeRowProps) {
  const percent =
    historyEntry && historyEntry.duration > 0
      ? Math.min(100, Math.max(0, (historyEntry.currentTime / historyEntry.duration) * 100))
      : 0;

  const isCompleted = historyEntry?.completed || percent >= 90;
  const isPartiallyWatched = !isCompleted && percent > 0;

  const [thumbnailError, setThumbnailError] = useState(false);

  useEffect(() => {
    setThumbnailError(false);
  }, [episode.thumbnail, episode.number]);

  const titleText = episode.title?.trim() || `Episode ${episode.number}`;

  return (
    <Link
      href={`/watch/${animeId}/${episode.number}`}
      className={`group relative flex items-center justify-between gap-3 p-2.5 sm:p-3 rounded-xl border transition-all duration-150 ${
        isCurrent
          ? 'bg-white/10 border-white text-white shadow-md'
          : 'bg-[#141414] border-[#292929] hover:bg-[#1B1B1B] hover:border-[#404040]'
      } ${className}`}
    >
      {/* Left section: Thumbnail + Episode details */}
      <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
        {/* Compact Thumbnail */}
        <div className="relative w-24 sm:w-28 aspect-video bg-[#0A0A0A] rounded-lg overflow-hidden shrink-0 border border-[#292929]">
          {episode.thumbnail && !thumbnailError ? (
            <Image
              key={episode.thumbnail}
              src={episode.thumbnail}
              alt={titleText}
              fill
              sizes="(max-width: 640px) 96px, 112px"
              className="object-cover group-hover:scale-105 transition-transform duration-200"
              referrerPolicy="no-referrer"
              onError={() => setThumbnailError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#707070]">
              <Film size={18} />
            </div>
          )}

          {/* Hover Play Overlay */}
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Play size={16} fill="white" className="text-white ml-0.5" />
          </div>

          {/* Completed Watched Badge Overlay */}
          {isCompleted && (
            <div className="absolute top-1 left-1 px-1 py-0.5 rounded bg-black/80 backdrop-blur-sm text-white flex items-center gap-0.5">
              <Check size={10} strokeWidth={3} />
            </div>
          )}

          {/* Episode Number Badge on Thumbnail */}
          <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/85 backdrop-blur-sm text-[10px] font-mono text-white">
            EP {episode.number}
          </div>

          {/* Bottom Progress Bar for Partially Watched */}
          {isPartiallyWatched && (
            <div className="absolute bottom-0 inset-x-0 h-1 bg-[#292929]">
              <div
                className="h-full bg-white transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>

        {/* Text Content */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-0.5">
            <span
              className={`text-xs font-mono font-bold ${
                isCurrent ? 'text-white' : 'text-[#A0A0A0]'
              }`}
            >
              EP {String(episode.number).padStart(2, '0')}
            </span>

            {/* Now Playing Indicator */}
            {isCurrent && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white text-black tracking-wider uppercase">
                <Radio size={10} className="animate-pulse" />
                <span>Now Playing</span>
              </span>
            )}

            {/* Filler Indicator */}
            {episode.filler && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono text-[#707070] border border-[#292929]">
                Filler
              </span>
            )}

            {/* Watched text badge */}
            {isCompleted && !isCurrent && (
              <span className="text-[10px] text-[#707070] flex items-center gap-0.5 font-mono">
                <Check size={10} />
                <span>Watched</span>
              </span>
            )}
          </div>

          {/* Episode Title */}
          <h4
            className={`text-xs sm:text-sm font-medium truncate group-hover:underline ${
              isCurrent ? 'text-white font-semibold' : 'text-white'
            }`}
            title={titleText}
          >
            {titleText}
          </h4>

          {/* Episode Synopsis or Meta */}
          {episode.synopsis ? (
            <p className="text-[11px] text-[#707070] line-clamp-1 mt-0.5 max-w-xl">
              {episode.synopsis}
            </p>
          ) : episode.aired ? (
            <p className="text-[10px] text-[#707070] font-mono mt-0.5">
              Aired: {new Date(episode.aired).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}
            </p>
          ) : null}
        </div>
      </div>

      {/* Right section: Play button action icon */}
      <div className="shrink-0 pl-2">
        <div
          className={`w-8 h-8 rounded-full border flex items-center justify-center transition-all ${
            isCurrent
              ? 'bg-white text-black border-white'
              : 'border-[#303030] text-[#707070] group-hover:text-white group-hover:border-white group-hover:bg-[#202020]'
          }`}
          title={isCurrent ? 'Currently playing' : `Play Episode ${episode.number}`}
        >
          <Play size={13} fill="currentColor" className="ml-0.5" />
        </div>
      </div>
    </Link>
  );
}
