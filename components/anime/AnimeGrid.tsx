'use client';

import React from 'react';
import { AnimeCard } from './AnimeCard';
import { HoshikaAnimeItem } from '@/types/anime';

interface AnimeGridProps {
  animeList: HoshikaAnimeItem[];
  isLoading?: boolean;
  emptyMessage?: string;
  count?: number;
}

export function AnimeGrid({
  animeList,
  isLoading = false,
  emptyMessage = 'No anime found.',
  count = 10,
}: AnimeGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col bg-[#141414] rounded-xl overflow-hidden border border-[#292929] animate-pulse"
          >
            <div className="aspect-[3/4] bg-[#1B1B1B]" />
            <div className="p-3 space-y-2">
              <div className="h-4 bg-[#1B1B1B] rounded w-3/4" />
              <div className="h-3 bg-[#1B1B1B] rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (animeList.length === 0) {
    return (
      <div className="py-16 text-center text-[#707070] bg-[#0A0A0A] rounded-2xl border border-[#292929]">
        <p className="text-base">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {animeList.map((anime, idx) => (
        <AnimeCard
          key={anime.id || anime.shortId || idx}
          anime={anime}
          priority={idx < 4}
        />
      ))}
    </div>
  );
}
