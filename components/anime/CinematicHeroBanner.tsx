'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Play, Info, Bookmark, Star, Tv } from 'lucide-react';
import { HoshikaAnimeItem } from '@/types/anime';
import { AnimeArtworkResult } from '@/types/artwork';
import { isInWatchlist, toggleWatchlist } from '@/lib/storage';

interface CinematicHeroBannerProps {
  anime: HoshikaAnimeItem;
  artwork?: AnimeArtworkResult | null;
  mode?: 'home' | 'details';
  priority?: boolean;
  children?: React.ReactNode;
}

export function CinematicHeroBanner({
  anime,
  artwork,
  mode = 'home',
  priority = true,
  children,
}: CinematicHeroBannerProps) {
  const [inWatchlist, setInWatchlist] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [bgError, setBgError] = useState(false);

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

  // Background artwork priority: Fanart.tv showbackground -> Hoshika banner -> Hoshika cover
  const backgroundUrl = !bgError
    ? artwork?.backgroundUrl || anime.bannerImage || anime.coverImage
    : anime.bannerImage || anime.coverImage;

  // Logo: Fanart.tv hdtvlogo / clearlogo -> Typography fallback
  const hasLogo = !logoError && Boolean(artwork?.logoUrl);

  const scoreDisplay = anime.averageScore
    ? anime.averageScore >= 10
      ? (anime.averageScore).toFixed(1)
      : (anime.averageScore * 10).toFixed(1)
    : anime.canonScore
    ? String(anime.canonScore)
    : '89.0';

  return (
    <div className="relative w-full h-[90vh] md:h-[92vh] lg:h-[95vh] min-h-[640px] max-h-[960px] flex items-end select-none overflow-hidden bg-[#000000]">
      {/* 1. Full-Bleed Edge-to-Edge Background Artwork */}
      {backgroundUrl ? (
        <div className="absolute inset-0 z-0 overflow-hidden">
          <Image
            src={backgroundUrl}
            alt={title}
            fill
            priority={priority}
            sizes="100vw"
            className="object-cover object-center opacity-60 filter brightness-90 transition-transform duration-700 hover:scale-102"
            referrerPolicy="no-referrer"
            onError={() => setBgError(true)}
          />
          {/* Measured Cinematic Scrims (Monochrome gradients preserving vibrant art) */}
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/85 via-35% to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/75 via-45% to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-transparent pointer-events-none" />
        </div>
      ) : (
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-[#141414] via-[#0A0A0A] to-black" />
      )}

      {/* 2. Hero Content Layer: Left-aligned Bottom Info */}
      <div className="relative z-20 p-6 sm:p-10 md:p-16 lg:p-20 pb-20 sm:pb-24 md:pb-28 max-w-3xl flex flex-col justify-end w-full space-y-3.5 sm:space-y-4">
        {/* Transparent Fanart.tv Title Logo */}
        <div className="mb-1">
          {hasLogo ? (
            <div className="relative w-full max-w-[340px] sm:max-w-[440px] md:max-w-[520px] h-20 sm:h-24 md:h-28 lg:h-32 filter drop-shadow-[0_4px_24px_rgba(0,0,0,0.95)]">
              <Image
                src={artwork!.logoUrl!}
                alt={title}
                fill
                priority={priority}
                sizes="(min-width: 1024px) 520px, 340px"
                className="object-contain object-left-bottom"
                referrerPolicy="no-referrer"
                onError={() => setLogoError(true)}
              />
            </div>
          ) : (
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white mb-2 leading-tight drop-shadow-md">
              {title}
            </h1>
          )}
        </div>

        {/* Synopsis (2-3 lines max) */}
        {anime.synopsis && (
          <p className="text-xs sm:text-sm md:text-base text-white/80 line-clamp-2 sm:line-clamp-3 max-w-2xl leading-relaxed text-balance">
            {anime.synopsis}
          </p>
        )}

        {/* Genre Tags (Rounded Dark Translucent Pills) */}
        {anime.genres && anime.genres.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {anime.genres.slice(0, 4).map((g) => (
              <Link
                key={g.slug || g.name}
                href={`/genres/${g.slug || g.name.toLowerCase()}`}
                className="px-3.5 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/15 text-xs text-white/90 font-medium hover:border-white/40 hover:text-white transition-all shadow-sm"
              >
                {g.name}
              </Link>
            ))}
          </div>
        )}

        {/* Metadata Line: Rating & Format */}
        <div className="flex items-center gap-4 text-xs sm:text-sm font-semibold text-white/90 pt-1">
          <div className="flex items-center gap-1.5 font-bold text-white">
            <Star size={15} fill="currentColor" className="text-white" />
            <span>{scoreDisplay}</span>
          </div>
          <div className="flex items-center gap-1.5 text-white/90">
            <Tv size={15} className="text-[#A0A0A0]" />
            <span className="uppercase">{anime.format || 'TV'}</span>
          </div>
        </div>

        {/* Action Buttons: View Details (Purple pill from screenshot) + Watch Episode 1 */}
        <div className="flex flex-wrap items-center gap-3 pt-3">
          <Link
            href={`/anime/${anime.shortId}`}
            className="inline-flex items-center gap-2.5 px-6 sm:px-7 py-3 sm:py-3.5 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs sm:text-sm transition-all shadow-xl shadow-purple-950/40 active:scale-95"
          >
            <Play size={16} fill="currentColor" />
            <span>View Details</span>
          </Link>

          <Link
            href={`/watch/${anime.shortId}/1`}
            className="inline-flex items-center gap-2 px-5 sm:px-6 py-3 sm:py-3.5 rounded-full bg-black/50 backdrop-blur-md border border-white/20 hover:bg-white/10 text-white font-medium text-xs sm:text-sm transition-all active:scale-95"
          >
            <span>Play Episode 1</span>
          </Link>

          <button
            type="button"
            onClick={handleWatchlistToggle}
            className={`inline-flex items-center gap-2 px-4 py-3 sm:py-3.5 rounded-full border transition-all active:scale-95 ${
              inWatchlist
                ? 'bg-white text-black border-white font-medium shadow-md'
                : 'bg-black/50 backdrop-blur-md border-white/20 text-[#A0A0A0] hover:text-white hover:border-white/40'
            }`}
            title={inWatchlist ? 'In Watchlist' : 'Add to Watchlist'}
            aria-label={inWatchlist ? 'In Watchlist' : 'Add to Watchlist'}
          >
            <Bookmark size={16} fill={inWatchlist ? 'currentColor' : 'none'} />
            <span className="text-xs font-medium hidden sm:inline">
              {inWatchlist ? 'Saved' : 'Watchlist'}
            </span>
          </button>
        </div>
      </div>

      {/* Children for Carousel controls & indicators */}
      {children}
    </div>
  );
}
