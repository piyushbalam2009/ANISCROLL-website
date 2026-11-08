'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Play, Bookmark } from 'lucide-react';
import { isInWatchlist, toggleWatchlist } from '@/lib/storage';
import { HoshikaAnimeItem } from '@/types/anime';

interface AnimeDetailActionsProps {
  anime: HoshikaAnimeItem;
}

export function AnimeDetailActions({ anime }: AnimeDetailActionsProps) {
  const [inWatchlist, setInWatchlist] = useState(false);

  const title =
    anime.titleEnglish ||
    anime.titleRomaji ||
    anime.titleLocalized ||
    'Anime';

  useEffect(() => {
    setInWatchlist(isInWatchlist(anime.shortId));
    const handleUpdate = () => setInWatchlist(isInWatchlist(anime.shortId));
    window.addEventListener('aniscroll_watchlist_updated', handleUpdate);
    return () => window.removeEventListener('aniscroll_watchlist_updated', handleUpdate);
  }, [anime.shortId]);

  const handleToggle = () => {
    const added = toggleWatchlist({
      hoshikaId: anime.shortId,
      title,
      coverImage: anime.coverImage || undefined,
      format: anime.format || undefined,
      rating: anime.averageScore || undefined,
      seasonYear: anime.seasonYear || undefined,
    });
    setInWatchlist(added);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 mt-6">
      {/* Watch Now CTA - Primary Button: White with black text */}
      <Link
        href={`/watch/${anime.shortId}/1`}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-black font-semibold text-sm hover:bg-neutral-200 transition-colors shadow-lg active:scale-98"
      >
        <Play size={18} fill="currentColor" />
        <span>Watch Episode 1</span>
      </Link>

      {/* Watchlist Toggle - Secondary Button */}
      <button
        type="button"
        onClick={handleToggle}
        className={`inline-flex items-center gap-2 px-5 py-3 rounded-xl border text-sm font-medium transition-colors ${
          inWatchlist
            ? 'bg-white text-black border-white'
            : 'bg-transparent text-white border-white/60 hover:border-white hover:bg-white/10'
        }`}
      >
        <Bookmark size={17} fill={inWatchlist ? 'currentColor' : 'none'} />
        <span>{inWatchlist ? 'In Watchlist' : 'Add to Watchlist'}</span>
      </button>
    </div>
  );
}
