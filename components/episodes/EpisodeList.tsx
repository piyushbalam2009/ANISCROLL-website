'use client';

import React from 'react';
import { HoshikaEpisodeItem } from '@/types/anime';
import { WatchHistoryEntry } from '@/types/streaming';
import { EpisodeRow } from './EpisodeRow';
import { Film } from 'lucide-react';

interface EpisodeListProps {
  animeId: string | number;
  episodes: HoshikaEpisodeItem[];
  currentEpisode?: number;
  historyMap?: Record<number, WatchHistoryEntry>;
  className?: string;
}

export function EpisodeList({
  animeId,
  episodes,
  currentEpisode,
  historyMap = {},
  className = '',
}: EpisodeListProps) {
  if (!episodes || episodes.length === 0) {
    return (
      <div className="py-12 flex flex-col items-center justify-center text-center text-[#707070] space-y-2">
        <Film size={28} className="text-[#404040]" />
        <p className="text-xs">No episodes found matching this criteria.</p>
      </div>
    );
  }

  return (
    <div className={`space-y-2 sm:space-y-2.5 ${className}`}>
      {episodes.map((ep) => (
        <EpisodeRow
          key={ep.number}
          animeId={animeId}
          episode={ep}
          isCurrent={currentEpisode === ep.number}
          historyEntry={historyMap[ep.number] || null}
        />
      ))}
    </div>
  );
}
