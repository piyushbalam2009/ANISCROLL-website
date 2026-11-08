'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Film, Play, Bookmark, Star } from 'lucide-react';
import { HoshikaAnimeItem } from '@/types/anime';
import { isInWatchlist, toggleWatchlist } from '@/lib/storage';

interface AnimeCardProps {
  anime: HoshikaAnimeItem;
  priority?: boolean;
}

export function AnimeCard({ anime, priority = false }: AnimeCardProps) {
  const [inWatchlist, setInWatchlist] = useState(false);
  const [imageError, setImageError] = useState(false);

  const title =
    anime.titleEnglish ||
    anime.titleRomaji ||
    anime.titleLocalized ||
    'Unknown Title';

  useEffect(() => {
    setInWatchlist(isInWatchlist(anime.shortId));
    const handleUpdate = () => setInWatchlist(isInWatchlist(anime.shortId));
    window.addEventListener('aniscroll_watchlist_updated', handleUpdate);
    return () => window.removeEventListener('aniscroll_watchlist_updated', handleUpdate);
  }, [anime.shortId]);

  const handleWatchlistClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
    <div className="group relative flex flex-col bg-[#141414] rounded-xl overflow-hidden border border-[#292929] hover:border-[#404040] transition-all duration-200">
      <Link href={`/anime/${anime.shortId}`} className="block relative aspect-[3/4] overflow-hidden bg-[#0A0A0A]">
        {anime.coverImage && !imageError ? (
          <Image
            src={anime.coverImage}
            alt={title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            priority={priority}
            className="object-cover group-hover:scale-105 transition-transform duration-300 ease-out"
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-[#707070] p-4 text-center">
            <Film size={28} className="mb-2" />
            <span className="text-xs">{title}</span>
          </div>
        )}

        {/* Hover Gradient Overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
          <div className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center transform group-hover:scale-100 scale-75 transition-transform shadow-lg">
            <Play size={20} fill="currentColor" className="ml-0.5" />
          </div>
        </div>

        {/* Quick Watchlist Toggle Button */}
        <button
          type="button"
          onClick={handleWatchlistClick}
          className={`absolute top-2 right-2 p-2 rounded-lg backdrop-blur-md transition-all ${
            inWatchlist
              ? 'bg-white text-black opacity-100'
              : 'bg-black/60 text-white hover:bg-black/90 opacity-0 group-hover:opacity-100'
          }`}
          title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
          aria-label={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
        >
          <Bookmark size={15} fill={inWatchlist ? 'currentColor' : 'none'} />
        </button>

        {/* Airing Status Tag */}
        {anime.status && anime.status === 'RELEASING' && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-semibold bg-black/80 text-white border border-[#292929] backdrop-blur-sm">
            Airing
          </div>
        )}
      </Link>

      {/* Info Body */}
      <div className="p-3 flex-1 flex flex-col justify-between">
        <div>
          <Link
            href={`/anime/${anime.shortId}`}
            className="font-medium text-sm text-white line-clamp-1 hover:underline transition-all"
            title={title}
          >
            {title}
          </Link>
          {anime.titleJapanese && (
            <div className="text-[11px] text-[#707070] truncate mt-0.5">
              {anime.titleJapanese}
            </div>
          )}
        </div>

        {/* Metadata Footer */}
        <div className="flex items-center justify-between text-xs text-[#A0A0A0] mt-2.5 pt-2 border-t border-[#292929]/60">
          <div className="flex items-center gap-1.5">
            <span>{anime.format || 'TV'}</span>
            {anime.seasonYear && (
              <>
                <span aria-hidden="true" className="text-[#707070]">·</span>
                <span>{anime.seasonYear}</span>
              </>
            )}
          </div>

          {anime.averageScore ? (
            <div className="flex items-center gap-1 text-white font-mono text-[11px]">
              <Star size={12} className="text-white fill-white" />
              <span>{(anime.averageScore / 10).toFixed(1)}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
