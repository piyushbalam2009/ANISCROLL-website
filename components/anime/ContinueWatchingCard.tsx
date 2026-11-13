'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { Play, Trash2 } from 'lucide-react';
import { WatchHistoryEntry } from '@/types/streaming';
import {
  calculateWatchProgress,
  getContinueWatchingThumbnailCandidates,
  resolveDisplayAnimeTitle,
  resolveDisplayEpisodeTitle,
} from '@/lib/continue-watching';

interface ContinueWatchingCardProps {
  item: WatchHistoryEntry;
  onRemove?: (e: React.MouseEvent, item: WatchHistoryEntry) => void;
}

export function ContinueWatchingCard({ item, onRemove }: ContinueWatchingCardProps) {
  const candidates = useMemo(
    () => getContinueWatchingThumbnailCandidates(item),
    [item]
  );

  const animeTitle = resolveDisplayAnimeTitle(item);
  const episodeTitle = resolveDisplayEpisodeTitle(item);
  const episodeNumber = Math.max(1, Number(item.episodeNumber || 1));
  const progressPercent = calculateWatchProgress(
    item.currentTime,
    item.duration,
    item.progress
  );

  const resumeSeconds = Math.max(0, Math.floor(item.currentTime || 0));
  const audioParam = item.audioType === 'dub' || item.audioType === 'sub' ? `&type=${item.audioType}` : '';
  const watchHref = `/watch/${item.hoshikaId}/${episodeNumber}?resume=1&t=${resumeSeconds}${audioParam}`;

  return (
    <div
      data-testid={`continue-watching-card-${item.hoshikaId}-${episodeNumber}`}
      className="group relative flex flex-col bg-[#0F0F0F] rounded-xl overflow-hidden border border-[#262626] hover:border-[#4A4A4A] transition-colors duration-200"
    >
      <Link
        href={watchHref}
        aria-label={`Resume ${animeTitle} Episode ${episodeNumber}: ${episodeTitle}`}
        className="flex flex-col flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 rounded-xl"
      >
        {/* Thumbnail Area */}
        <div className="relative aspect-video w-full bg-[#161616] overflow-hidden">
          <ResilientImage
            src={candidates[0]}
            fallbackSrcs={candidates.slice(1)}
            alt={`${animeTitle} - ${episodeTitle}`}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 320px"
            className="object-cover group-hover:scale-[1.03] transition-transform duration-200"
            fallback={
              <div className="w-full h-full flex flex-col items-center justify-center bg-[#141414] px-4 text-center select-none">
                <span className="text-xs font-semibold text-[#A0A0A0] line-clamp-1">
                  {animeTitle}
                </span>
                <span className="text-[11px] font-mono text-[#666666] mt-0.5">
                  Episode {episodeNumber}
                </span>
              </div>
            }
          />

          {/* Subtle Play Hover Affordance */}
          <div className="absolute inset-0 bg-black/35 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
              <Play size={17} fill="currentColor" className="ml-0.5" />
            </div>
          </div>

          {/* Episode Number Badge in Top-Left Corner */}
          <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-black/85 text-white text-[11px] font-mono font-semibold tracking-wide border border-white/15 backdrop-blur-sm">
            EP {episodeNumber}
          </div>

          {/* Watch Progress Bar at Bottom of Thumbnail */}
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#262626]">
            <div
              data-testid={`continue-watching-progress-bar-${item.hoshikaId}-${episodeNumber}`}
              className="h-full bg-white transition-all duration-200"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Information Area */}
        <div className="p-3.5 flex flex-col flex-1 justify-between bg-[#0F0F0F]">
          <div className="space-y-0.5 min-w-0">
            <h3
              className="text-sm font-bold text-white truncate leading-snug group-hover:text-neutral-200 transition-colors"
              title={animeTitle}
            >
              {animeTitle}
            </h3>
            <p
              className="text-xs font-medium text-[#CCCCCC] truncate leading-snug"
              title={episodeTitle}
            >
              {episodeTitle}
            </p>
          </div>

          <div className="flex items-center justify-between text-xs text-[#8E8E8E] pt-2 mt-2 border-t border-[#1F1F1F]">
            <span className="font-medium text-[#A3A3A3]">
              Episode {episodeNumber}
            </span>
            <span className="font-mono tabular-nums text-[11px] text-[#A3A3A3]">
              {progressPercent}% watched
            </span>
          </div>
        </div>
      </Link>

      {/* Optional Remove Button (Top-Right of Thumbnail) */}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => onRemove(e, item)}
          className="absolute top-2.5 right-2.5 z-10 p-1.5 rounded-lg bg-black/75 text-[#A0A0A0] hover:text-white hover:bg-black border border-white/10 transition-colors"
          title={`Remove ${animeTitle} Episode ${episodeNumber} from Continue Watching`}
          aria-label={`Remove ${animeTitle} Episode ${episodeNumber} from Continue Watching`}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
