'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Play, Info, Bookmark, Star } from 'lucide-react';
import { HoshikaAnimeItem } from '@/types/anime';
import { isInWatchlist, toggleWatchlist } from '@/lib/storage';

interface AnimeHeroProps {
  anime: HoshikaAnimeItem;
}

export function AnimeHero({ anime }: AnimeHeroProps) {
  const [inWatchlist, setInWatchlist] = useState(false);

  const title =
    anime.titleEnglish ||
    anime.titleRomaji ||
    anime.titleLocalized ||
    'Featured Anime';

  useEffect(() => {
    setInWatchlist(isInWatchlist(anime.shortId));
    const handleUpdate = () => setInWatchlist(isInWatchlist(anime.shortId));
    window.addEventListener('aniscroll_watchlist_updated', handleUpdate);
    return () => window.removeEventListener('aniscroll_watchlist_updated', handleUpdate);
  }, [anime.shortId]);

  const handleWatchlistToggle = () => {
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

  const backdrop = anime.bannerImage || anime.coverImage;

  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-[#0A0A0A] border border-[#292929] mb-10 min-h-[420px] md:min-h-[500px] flex items-end">
      {/* Background Artwork */}
      {backdrop && (
        <div className="absolute inset-0 z-0">
          <Image
            src={backdrop}
            alt={title}
            fill
            priority
            sizes="100vw"
            className="object-cover object-center opacity-100 scale-102"
            referrerPolicy="no-referrer"
          />
          {/* Localized Monochrome Contrast Scrims */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 via-30% to-transparent pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/35 via-40% to-transparent pointer-events-none" />
        </div>
      )}

      {/* Content Layer */}
      <div className="relative z-10 p-6 md:p-10 max-w-3xl">
        {/* Format / Year / Score */}
        <div className="flex items-center gap-2.5 text-xs text-[#A0A0A0] mb-3">
          <span className="font-semibold text-white uppercase tracking-wider">
            {anime.format || 'TV Series'}
          </span>
          {anime.seasonYear && (
            <>
              <span aria-hidden="true" className="text-[#707070]">·</span>
              <span>{anime.seasonYear}</span>
            </>
          )}
          {anime.status && (
            <>
              <span aria-hidden="true" className="text-[#707070]">·</span>
              <span className="uppercase text-[11px]">{anime.status}</span>
            </>
          )}
          {anime.averageScore && (
            <>
              <span aria-hidden="true" className="text-[#707070]">·</span>
              <div className="flex items-center gap-1 text-white font-mono">
                <Star size={13} fill="currentColor" />
                <span>{(anime.averageScore / 10).toFixed(1)}</span>
              </div>
            </>
          )}
        </div>

        {/* Headline */}
        <h1 className="text-3xl md:text-5xl font-black tracking-tight text-white mb-2 text-balance leading-tight">
          {title}
        </h1>

        {anime.titleJapanese && (
          <p className="text-sm md:text-base text-[#707070] mb-4 font-sans">
            {anime.titleJapanese}
          </p>
        )}

        {/* Synopsis */}
        {anime.synopsis && (
          <p className="text-sm md:text-base text-[#A0A0A0] line-clamp-3 mb-6 max-w-2xl leading-relaxed">
            {anime.synopsis}
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Watch Now CTA - Primary Button: White with black text */}
          <Link
            href={`/watch/${anime.shortId}/1`}
            className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-white text-black font-semibold text-sm hover:bg-neutral-200 transition-colors shadow-lg active:scale-98"
          >
            <Play size={18} fill="currentColor" />
            <span>Watch Episode 1</span>
          </Link>

          {/* Details CTA - Secondary Button: Transparent with white border */}
          <Link
            href={`/anime/${anime.shortId}`}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-transparent border border-white text-white font-medium text-sm hover:bg-white/10 transition-colors active:scale-98"
          >
            <Info size={17} />
            <span>Details</span>
          </Link>

          {/* Watchlist Button */}
          <button
            type="button"
            onClick={handleWatchlistToggle}
            className={`inline-flex items-center gap-2 px-4 py-3 rounded-xl border transition-colors ${
              inWatchlist
                ? 'bg-white text-black border-white font-medium'
                : 'bg-black/40 border-[#292929] text-[#A0A0A0] hover:text-white hover:border-[#404040]'
            }`}
            title={inWatchlist ? 'In Watchlist' : 'Add to Watchlist'}
            aria-label={inWatchlist ? 'In Watchlist' : 'Add to Watchlist'}
          >
            <Bookmark size={17} fill={inWatchlist ? 'currentColor' : 'none'} />
            <span className="text-sm hidden sm:inline">
              {inWatchlist ? 'Saved' : 'Watchlist'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
