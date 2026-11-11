'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Play, Bookmark, Star, Tv } from 'lucide-react';
import { HoshikaAnimeItem } from '@/types/anime';
import { AnimeArtworkResult } from '@/types/artwork';
import { isInWatchlist, toggleWatchlist } from '@/lib/storage';
import { useRealtimeArtworkOverride } from '@/hooks/useRealtimeArtworkOverride';
import { getLogoDisplayTailwindClasses } from '@/lib/artwork/logo-selector';

interface CinematicHeroBannerProps {
  anime: HoshikaAnimeItem;
  artwork?: AnimeArtworkResult | null;
  mode?: 'home' | 'details';
  priority?: boolean;
  children?: React.ReactNode;
}

export function CinematicHeroBanner({
  anime,
  artwork: initialArtwork,
  priority = true,
  children,
}: CinematicHeroBannerProps) {
  const [inWatchlist, setInWatchlist] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [candidateIndex, setCandidateIndex] = useState(0);

  const artwork = useRealtimeArtworkOverride(
    anime.shortId,
    initialArtwork,
    anime.format
  );

  useEffect(() => {
    setLogoError(false);
  }, [artwork?.logoUrl, anime.shortId]);

  useEffect(() => {
    setCandidateIndex(0);
  }, [anime.shortId, artwork?.backgroundUrl]);

  const title =
    anime.titleEnglish ||
    anime.titleRomaji ||
    anime.titleLocalized ||
    'Featured Anime';

  useEffect(() => {
    setInWatchlist(isInWatchlist(anime.shortId));
    const handleUpdate = () => setInWatchlist(isInWatchlist(anime.shortId));
    window.addEventListener('aniscroll_watchlist_updated', handleUpdate);
    return () =>
      window.removeEventListener('aniscroll_watchlist_updated', handleUpdate);
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

  // Ordered multi-candidate backdrop list: Fanart.tv showbackground -> Hoshika banner -> AniList banner -> Hoshika cover
  const backdropCandidates = useMemo(() => {
    const rawList = [
      artwork?.backgroundUrl,
      ...(artwork?.backdropCandidates || []),
      anime.bannerImage,
      anime.coverImage,
    ];
    const seen = new Set<string>();
    const valid: string[] = [];
    for (const item of rawList) {
      if (!item || typeof item !== 'string') continue;
      const trimmed = item.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      valid.push(trimmed);
    }
    return valid;
  }, [
    artwork?.backgroundUrl,
    artwork?.backdropCandidates,
    anime.bannerImage,
    anime.coverImage,
  ]);

  const backgroundUrl = backdropCandidates[candidateIndex] || null;

  const handleBackdropError = () => {
    setCandidateIndex((prev) =>
      prev + 1 < backdropCandidates.length ? prev + 1 : backdropCandidates.length
    );
  };

  // Logo: Fanart.tv hdtvlogo / clearlogo / custom override -> Typography fallback
  const hasLogo = !logoError && Boolean(artwork?.logoUrl);
  const logoSizingClasses = getLogoDisplayTailwindClasses(
    artwork?.logoDisplay,
    'home'
  );

  const scoreDisplay = anime.averageScore
    ? anime.averageScore >= 10
      ? anime.averageScore.toFixed(1)
      : (anime.averageScore * 10).toFixed(1)
    : anime.canonScore
    ? String(anime.canonScore)
    : '89.0';

  return (
    <div className="relative w-full h-[80vh] sm:h-[85vh] md:h-[88vh] lg:h-[90vh] min-h-[580px] max-h-[920px] flex items-end select-none overflow-hidden bg-[#000000]">
      {/* 1. Full-Bleed Edge-to-Edge Background Artwork (Full Brightness + Localized Gradients) */}
      {backgroundUrl ? (
        <div className="absolute inset-0 z-0 overflow-hidden">
          <Image
            key={`${anime.shortId}-${backgroundUrl}`}
            src={backgroundUrl}
            alt={title}
            fill
            priority={priority}
            sizes="100vw"
            className="object-cover object-center opacity-100 transition-transform duration-700 hover:scale-102"
            referrerPolicy="no-referrer"
            onError={handleBackdropError}
          />
          {/* Localized Left & Bottom Gradients (Preserves bright original artwork while protecting text legibility) */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/35 via-38% to-transparent pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 via-24% to-transparent pointer-events-none" />
          <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/45 to-transparent pointer-events-none" />
        </div>
      ) : (
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-[#141414] via-[#0A0A0A] to-black" />
      )}

      {/* 2. Hero Content Layer: Left-aligned Bottom Info */}
      <div className="relative z-20 p-6 sm:p-10 md:p-16 lg:p-20 pb-20 sm:pb-24 md:pb-28 max-w-3xl flex flex-col justify-end w-full space-y-3.5 sm:space-y-4">
        {/* Transparent Fanart.tv Title Logo */}
        <div className="mb-1">
          {hasLogo ? (
            <div
              className={`relative w-full ${logoSizingClasses} filter drop-shadow-[0_4px_24px_rgba(0,0,0,0.95)] transition-transform duration-300`}
            >
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
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white mb-2 leading-tight drop-shadow-[0_4px_20px_rgba(0,0,0,0.9)]">
              {title}
            </h1>
          )}
        </div>

        {/* Synopsis (2-3 lines max) */}
        {anime.synopsis && (
          <p className="text-xs sm:text-sm md:text-base text-white/90 line-clamp-2 sm:line-clamp-3 max-w-2xl leading-relaxed text-balance drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
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
                className="px-3.5 py-1 rounded-full bg-black/55 backdrop-blur-md border border-white/20 text-xs text-white/95 font-medium hover:border-white/50 hover:text-white transition-all shadow-sm"
              >
                {g.name}
              </Link>
            ))}
          </div>
        )}

        {/* Metadata Line: Rating & Format */}
        <div className="flex items-center gap-4 text-xs sm:text-sm font-semibold text-white/95 pt-1 drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
          <div className="flex items-center gap-1.5 font-bold text-white">
            <Star size={15} fill="currentColor" className="text-white" />
            <span>{scoreDisplay}</span>
          </div>
          <div className="flex items-center gap-1.5 text-white/95">
            <Tv size={15} className="text-[#D0D0D0]" />
            <span className="uppercase">{anime.format || 'TV'}</span>
          </div>
        </div>

        {/* Action Buttons: View Details (Monochrome White Pill) + Watch Episode 1 */}
        <div className="flex flex-wrap items-center gap-3 pt-3">
          <Link
            href={`/anime/${anime.shortId}`}
            className="inline-flex items-center gap-2.5 px-6 sm:px-7 py-3 sm:py-3.5 rounded-full bg-white hover:bg-neutral-200 text-black font-bold text-xs sm:text-sm transition-all shadow-xl shadow-black/50 active:scale-95"
          >
            <Play size={16} fill="currentColor" />
            <span>View Details</span>
          </Link>

          <Link
            href={`/watch/${anime.shortId}/1`}
            className="inline-flex items-center gap-2 px-5 sm:px-6 py-3 sm:py-3.5 rounded-full bg-black/60 backdrop-blur-md border border-white/25 hover:bg-white/15 text-white font-medium text-xs sm:text-sm transition-all active:scale-95"
          >
            <span>Play Episode 1</span>
          </Link>

          <button
            type="button"
            onClick={handleWatchlistToggle}
            className={`inline-flex items-center gap-2 px-4 py-3 sm:py-3.5 rounded-full border transition-all active:scale-95 ${
              inWatchlist
                ? 'bg-white text-black border-white font-medium shadow-md'
                : 'bg-black/60 backdrop-blur-md border-white/25 text-white/85 hover:text-white hover:border-white/50'
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
