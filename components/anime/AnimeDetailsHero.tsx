'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Play,
  Heart,
  Bell,
  ChevronDown,
  Star,
  Tv,
  Clock,
  Calendar,
  Radio,
  Subtitles,
  Check,
} from 'lucide-react';
import { HoshikaAnimeItem } from '@/types/anime';
import { AnimeArtworkResult } from '@/types/artwork';
import { EpisodeAvailabilityResult } from '@/lib/episode-store';
import {
  getWatchlistEntry,
  setWatchlistStatus,
  isSubscribed,
  toggleSubscription,
} from '@/lib/storage';
import { useRealtimeArtworkOverride } from '@/hooks/useRealtimeArtworkOverride';
import { getLogoDisplayTailwindClasses } from '@/lib/artwork/logo-selector';

interface AnimeDetailsHeroProps {
  anime: HoshikaAnimeItem;
  artwork?: AnimeArtworkResult | null;
  availability?: EpisodeAvailabilityResult | null;
  priority?: boolean;
}

const WATCHLIST_STATUS_LABELS: Record<string, string> = {
  watching: 'Watching',
  plan_to_watch: 'Plan to Watch',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
};

export function AnimeDetailsHero({
  anime,
  artwork: initialArtwork,
  availability,
  priority = true,
}: AnimeDetailsHeroProps) {
  const [inWatchlist, setInWatchlist] = useState(false);
  const [watchlistStatus, setWatchlistStatusState] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
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

  const dropdownRef = useRef<HTMLDivElement>(null);

  const title =
    anime.titleEnglish ||
    anime.titleRomaji ||
    anime.titleLocalized ||
    'Featured Anime';

  // Subtitle above logo
  const subtitleText =
    anime.titleEnglish &&
    anime.titleRomaji &&
    anime.titleEnglish !== anime.titleRomaji
      ? anime.titleEnglish
      : title;

  useEffect(() => {
    const entry = getWatchlistEntry(anime.shortId);
    setInWatchlist(Boolean(entry));
    setWatchlistStatusState(entry?.status || (entry ? 'watching' : null));
    setSubscribed(isSubscribed(anime.shortId));

    const handleWatchlistUpdate = () => {
      const updated = getWatchlistEntry(anime.shortId);
      setInWatchlist(Boolean(updated));
      setWatchlistStatusState(updated?.status || (updated ? 'watching' : null));
    };

    const handleSubUpdate = () => {
      setSubscribed(isSubscribed(anime.shortId));
    };

    window.addEventListener('aniscroll_watchlist_updated', handleWatchlistUpdate);
    window.addEventListener('aniscroll_subscriptions_updated', handleSubUpdate);

    // Click outside to close dropdown
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.removeEventListener('aniscroll_watchlist_updated', handleWatchlistUpdate);
      window.removeEventListener('aniscroll_subscriptions_updated', handleSubUpdate);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [anime.shortId]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleSelectStatus = (
    status:
      | 'watching'
      | 'plan_to_watch'
      | 'completed'
      | 'on_hold'
      | 'dropped'
      | 'remove'
  ) => {
    const success = setWatchlistStatus(
      {
        hoshikaId: anime.shortId,
        title,
        coverImage: anime.coverImage || undefined,
        format: anime.format || undefined,
        rating: anime.averageScore || undefined,
        seasonYear: anime.seasonYear || undefined,
      },
      status
    );
    setInWatchlist(success);
    setWatchlistStatusState(status === 'remove' ? null : status);
    setIsDropdownOpen(false);
    showToast(
      status === 'remove'
        ? `Removed ${title} from your list`
        : `Added to ${WATCHLIST_STATUS_LABELS[status] || 'Watchlist'}`
    );
  };

  const handleSubscribeToggle = () => {
    const nowSubscribed = toggleSubscription(anime.shortId);
    setSubscribed(nowSubscribed);
    showToast(
      nowSubscribed
        ? `Subscribed to new episode alerts for ${title}`
        : `Unsubscribed from ${title}`
    );
  };

  // 1. Ordered multi-candidate landscape backdrops: Fanart.tv showbackground -> Hoshika banner -> AniList banner -> Hoshika cover
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

  // 2. Transparent Anime Title Logo: Fanart.tv hdtvlogo/clearlogo/custom override
  const hasLogo = !logoError && Boolean(artwork?.logoUrl);
  const logoSizingClasses = getLogoDisplayTailwindClasses(
    artwork?.logoDisplay,
    'details'
  );

  // Metadata formatting
  const scoreDisplay = anime.averageScore
    ? anime.averageScore >= 10
      ? anime.averageScore.toFixed(1)
      : (anime.averageScore * 10).toFixed(1)
    : anime.canonScore
    ? String(anime.canonScore)
    : null;

  const formatDisplay =
    anime.format?.toUpperCase() === 'TV' ? 'Tv' : anime.format || 'Tv';

  const durationDisplay = anime.episodeDuration
    ? `${anime.episodeDuration}m`
    : null;

  const seasonName = anime.season
    ? anime.season.charAt(0).toUpperCase() + anime.season.slice(1).toLowerCase()
    : null;
  const seasonYearDisplay =
    seasonName && anime.seasonYear
      ? `${seasonName} ${anime.seasonYear}`
      : anime.seasonYear
      ? String(anime.seasonYear)
      : null;

  const statusDisplay =
    anime.status?.toUpperCase() === 'RELEASING' ||
    anime.status?.toUpperCase() === 'AIRING'
      ? 'Currently Airing'
      : anime.status?.toUpperCase() === 'FINISHED'
      ? 'Finished Airing'
      : anime.status?.toUpperCase() === 'NOT_YET_RELEASED'
      ? 'Upcoming'
      : anime.status || 'Finished Airing';

  const studioName =
    anime.studios && anime.studios.length > 0 ? anime.studios[0].name : null;
  const sourceName = anime.source || null;

  return (
    <div className="relative w-full overflow-hidden bg-[#000000] min-h-[620px] md:min-h-[660px] lg:h-[720px] max-h-[800px] flex items-center select-none pt-24 sm:pt-28 pb-12">
      {/* 1. Full-Width Landscape Backdrop Layer (Full Brightness + Localized Gradients) */}
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
          {/* Localized Readability Gradients (Preserves vibrant backdrop artwork while keeping poster and metadata clear) */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/82 via-black/45 via-42% to-black/10 pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 via-24% to-transparent pointer-events-none" />
          <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/45 to-transparent pointer-events-none" />
        </div>
      ) : (
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-[#141414] via-[#0A0A0A] to-black" />
      )}

      {/* 2. Hero Content Container: Left Poster + Right Information */}
      <div className="relative z-20 w-full max-w-[1600px] mx-auto h-full px-6 sm:px-10 md:px-14 lg:px-16 flex flex-col md:flex-row items-center gap-8 md:gap-12 lg:gap-16 justify-center md:justify-start">
        {/* Left Side: Anime Poster (Aspect 2:3, ~325px wide on desktop) */}
        {anime.coverImage && (
          <div className="w-full max-w-[200px] sm:max-w-[240px] md:w-[240px] lg:w-[325px] flex-shrink-0 aspect-[2/3] relative rounded-2xl overflow-hidden shadow-2xl shadow-black ring-1 ring-white/15 group">
            <Image
              src={anime.coverImage}
              alt={`${title} poster`}
              fill
              priority
              sizes="(min-width: 1024px) 325px, (min-width: 768px) 240px, 200px"
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              referrerPolicy="no-referrer"
            />
            {/* Subtle gloss highlight on edge */}
            <div className="absolute inset-0 pointer-events-none rounded-2xl ring-1 ring-inset ring-white/10" />
          </div>
        )}

        {/* Right Side: Anime Content & Actions */}
        <div className="flex-1 min-w-0 flex flex-col justify-center space-y-3.5 lg:space-y-4 text-left w-full">
          {/* 1. Anime Title Text as Small Subtitle Above Logo */}
          <div className="text-xs sm:text-sm md:text-base font-medium text-white/80 tracking-wide drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            {subtitleText}
          </div>

          {/* 2. Transparent Fanart.tv Anime Title Logo (Max width ~580px) */}
          <div className="py-1">
            {hasLogo ? (
              <div
                className={`relative w-full ${logoSizingClasses} filter drop-shadow-[0_4px_24px_rgba(0,0,0,0.95)] transition-transform duration-300`}
              >
                <Image
                  src={artwork!.logoUrl!}
                  alt={title}
                  fill
                  priority={priority}
                  sizes="(min-width: 1024px) 580px, 420px"
                  className="object-contain object-left"
                  referrerPolicy="no-referrer"
                  onError={() => setLogoError(true)}
                />
              </div>
            ) : (
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight drop-shadow-[0_4px_20px_rgba(0,0,0,0.9)]">
                {title}
              </h1>
            )}
          </div>

          {/* 3. Horizontal Compact Metadata Row */}
          <div className="flex flex-wrap items-center gap-x-4 sm:gap-x-5 gap-y-2 text-xs sm:text-sm font-medium text-white/95 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            {/* Rating */}
            {scoreDisplay && (
              <div className="flex items-center gap-1.5 font-bold text-white">
                <Star size={15} fill="currentColor" className="text-white" />
                <span>{scoreDisplay}</span>
              </div>
            )}

            {/* Format */}
            <div className="flex items-center gap-1.5 text-white/95">
              <Tv size={15} className="text-[#D0D0D0]" />
              <span>{formatDisplay}</span>
            </div>

            {/* Duration */}
            {durationDisplay && (
              <div className="flex items-center gap-1.5 text-white/95">
                <Clock size={15} className="text-[#D0D0D0]" />
                <span>{durationDisplay}</span>
              </div>
            )}

            {/* Release Season & Year */}
            {seasonYearDisplay && (
              <div className="flex items-center gap-1.5 text-white/95">
                <Calendar size={15} className="text-[#D0D0D0]" />
                <span>{seasonYearDisplay}</span>
              </div>
            )}

            {/* Airing Status */}
            {statusDisplay && (
              <div className="flex items-center gap-1.5 text-white/95">
                <Radio size={15} className="text-[#D0D0D0]" />
                <span>{statusDisplay}</span>
              </div>
            )}

            {/* Language Sub/Dub */}
            {(!availability || availability.sub.available || availability.dub.available) && (
              <div className="flex items-center gap-1.5 text-white/95">
                <Subtitles size={15} className="text-[#D0D0D0]" />
                <span>
                  {availability?.sub.available && availability?.dub.available
                    ? 'Sub / Dub'
                    : availability?.dub.available
                    ? 'Dub'
                    : 'Sub'}
                </span>
              </div>
            )}
          </div>

          {/* 4. Genre Tags: Rounded Dark Translucent Pills */}
          {anime.genres && anime.genres.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {anime.genres.slice(0, 5).map((g) => (
                <Link
                  key={g.slug || g.name}
                  href={`/genres/${g.slug || g.name.toLowerCase()}`}
                  className="px-4 py-1.5 rounded-full bg-black/55 backdrop-blur-md border border-white/20 text-xs text-white/95 font-medium hover:border-white/50 hover:text-white transition-all shadow-sm"
                >
                  {g.name}
                </Link>
              ))}
            </div>
          )}

          {/* 5. Studio and Source Information */}
          {(studioName || sourceName) && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs sm:text-sm text-white/80 pt-1 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
              {studioName && (
                <div>
                  Studio:{' '}
                  <span className="text-white font-semibold">{studioName}</span>
                </div>
              )}
              {sourceName && (
                <div>
                  Source:{' '}
                  <span className="text-white font-semibold uppercase">
                    {sourceName}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 6. Action Buttons */}
          <div className="flex flex-wrap items-center gap-3 pt-3">
            {/* Primary: Play Episode 1 */}
            <Link
              href={`/watch/${anime.shortId}/1`}
              className="inline-flex items-center gap-2 px-6 sm:px-7 py-3 sm:py-3.5 rounded-full bg-white text-black font-semibold text-xs sm:text-sm hover:bg-neutral-200 transition-all shadow-xl active:scale-95"
            >
              <Play size={17} fill="currentColor" />
              <span>Play Episode 1</span>
            </Link>

            {/* Secondary: Add to List with Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setIsDropdownOpen((prev) => !prev)}
                className={`inline-flex items-center gap-2 px-5 sm:px-6 py-3 sm:py-3.5 rounded-full border text-xs sm:text-sm font-medium transition-all active:scale-95 ${
                  inWatchlist
                    ? 'bg-white/15 backdrop-blur-md border-white/35 text-white'
                    : 'bg-black/60 backdrop-blur-md border-white/25 text-white hover:bg-white/15'
                }`}
                aria-expanded={isDropdownOpen}
                aria-haspopup="true"
              >
                <Heart
                  size={17}
                  className={inWatchlist ? 'fill-white text-white' : 'text-white'}
                />
                <span>
                  {watchlistStatus
                    ? WATCHLIST_STATUS_LABELS[watchlistStatus] || 'In List'
                    : 'Add to list'}
                </span>
                <ChevronDown
                  size={14}
                  className={`text-white/70 transition-transform duration-200 ${
                    isDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* Watchlist Status Dropdown Menu */}
              {isDropdownOpen && (
                <div className="absolute left-0 bottom-full mb-2 w-48 rounded-2xl bg-[#141414]/95 backdrop-blur-xl border border-[#292929] shadow-2xl py-2 z-50 text-xs">
                  <div className="px-3 py-1.5 text-[10px] font-bold text-[#707070] uppercase tracking-wider border-b border-[#222222]">
                    Watchlist Status
                  </div>
                  {(
                    [
                      'watching',
                      'plan_to_watch',
                      'completed',
                      'on_hold',
                      'dropped',
                    ] as const
                  ).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => handleSelectStatus(st)}
                      className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-white/10 transition-colors ${
                        watchlistStatus === st
                          ? 'text-white font-semibold bg-white/5'
                          : 'text-[#B0B0B0]'
                      }`}
                    >
                      <span>{WATCHLIST_STATUS_LABELS[st]}</span>
                      {watchlistStatus === st && (
                        <Check size={14} className="text-white" />
                      )}
                    </button>
                  ))}

                  {inWatchlist && (
                    <>
                      <div className="my-1 border-t border-[#222222]" />
                      <button
                        type="button"
                        onClick={() => handleSelectStatus('remove')}
                        className="w-full px-3 py-2 text-left text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        Remove from List
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Tertiary: Subscribe to Notifications */}
            <button
              type="button"
              onClick={handleSubscribeToggle}
              className={`inline-flex items-center gap-2 px-5 sm:px-6 py-3 sm:py-3.5 rounded-full border text-xs sm:text-sm font-medium transition-all active:scale-95 ${
                subscribed
                  ? 'bg-white/15 backdrop-blur-md border-white/40 text-white ring-1 ring-white/20'
                  : 'bg-black/60 backdrop-blur-md border-white/25 text-white hover:bg-white/15'
              }`}
              title={
                subscribed
                  ? 'Subscribed to notifications'
                  : 'Subscribe to notifications'
              }
            >
              <Bell
                size={17}
                className={subscribed ? 'fill-white text-white' : 'text-white'}
              />
              <span>{subscribed ? 'Subscribed' : 'Subscribe'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Subtle Toast Feedback */}
      {toastMessage && (
        <div className="absolute bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl bg-[#141414]/90 backdrop-blur-md border border-[#292929] text-xs text-white font-medium shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <Check size={14} className="text-white" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
