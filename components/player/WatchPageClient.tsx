'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { VideoPlayer } from './VideoPlayer';
import { EpisodeSection } from '@/components/episodes/EpisodeSection';
import {
  HoshikaAnimeItem,
  HoshikaEpisodeItem,
  IdMappingResult,
} from '@/types/anime';
import { AniScrollStreamResponse } from '@/types/streaming';
import {
  getSavedHistoryEntry,
  updateWatchHistoryMetadata,
} from '@/lib/storage';
import {
  cacheEpisodes,
  getCachedEpisode,
  fetchEpisodeBatch,
  createEpisodeAvailability,
  EpisodeAvailabilityResult,
} from '@/lib/episode-store';
import { selectEpisodeAudioVersion } from '@/lib/zokoanime-stream';
import {
  getStreamingProviderDisplayName,
  selectStreamingProvider,
} from '@/lib/stream-provider-core';
import { ChevronRight, ArrowLeft, AlertCircle, Loader2 } from 'lucide-react';

const USER_AUDIO_PREF_KEY = 'aniscroll_user_selected_audio_v1';

function getStoredUserAudioVersion(): 'sub' | 'dub' | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = window.sessionStorage.getItem(USER_AUDIO_PREF_KEY);
    return val === 'dub' ? 'dub' : val === 'sub' ? 'sub' : null;
  } catch {
    return null;
  }
}

function setStoredUserAudioVersion(version: 'sub' | 'dub' | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!version) {
      window.sessionStorage.removeItem(USER_AUDIO_PREF_KEY);
    } else {
      window.sessionStorage.setItem(USER_AUDIO_PREF_KEY, version);
    }
  } catch {
    // Ignore storage errors
  }
}

interface CachedEpisodeStreams {
  subAvailable: boolean;
  dubAvailable: boolean;
  subStream: AniScrollStreamResponse | null;
  dubStream: AniScrollStreamResponse | null;
}

const clientEpisodeStreamCache = new Map<string, CachedEpisodeStreams>();

interface WatchPageClientProps {
  anime: HoshikaAnimeItem;
  episodes: HoshikaEpisodeItem[];
  episodeNumber: number;
}

export function WatchPageClient({
  anime,
  episodes,
  episodeNumber,
}: WatchPageClientProps) {
  const router = useRouter();

  const [userSelectedVersion, setUserSelectedVersion] = useState<'sub' | 'dub' | null>(() =>
    getStoredUserAudioVersion()
  );
  const [activeType, setActiveType] = useState<'sub' | 'dub'>(() => {
    const stored = getStoredUserAudioVersion();
    return stored || 'sub';
  });

  const [initialResumeTime, setInitialResumeTime] = useState<number>(0);
  const [idMapping, setIdMapping] = useState<IdMappingResult | null>(null);
  const [isResolvingId, setIsResolvingId] = useState<boolean>(true);
  const [idError, setIdError] = useState<string | null>(null);

  // Episode-specific Sub/Dub availability & streams
  const [episodeHasSub, setEpisodeHasSub] = useState<boolean>(false);
  const [episodeHasDub, setEpisodeHasDub] = useState<boolean>(false);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState<boolean>(true);
  const [episodeStreams, setEpisodeStreams] = useState<{
    sub: AniScrollStreamResponse | null;
    dub: AniScrollStreamResponse | null;
  }>({ sub: null, dub: null });

  const [streamData, setStreamData] = useState<AniScrollStreamResponse | null>(null);
  const [isLoadingStream, setIsLoadingStream] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState<number>(0);

  const userSelectedVersionRef = useRef<'sub' | 'dub' | null>(userSelectedVersion);
  useEffect(() => {
    userSelectedVersionRef.current = userSelectedVersion;
  }, [userSelectedVersion]);

  const totalEpisodes = anime.episodes || episodes.length || 1;

  // Store server-passed episodes into cache on mount
  useEffect(() => {
    if (episodes && episodes.length > 0) {
      cacheEpisodes(anime.shortId, episodes, {
        language: 'sub',
        limit: Math.max(50, episodes.length),
        total: totalEpisodes,
        nextAfter:
          episodes.length < 50 || episodes.length >= totalEpisodes
            ? null
            : undefined,
      });
    }
  }, [anime.shortId, episodes, totalEpisodes]);

  const [activeEpisodeItem, setActiveEpisodeItem] = useState<HoshikaEpisodeItem | null>(() => {
    return (
      episodes.find((e) => e.number === episodeNumber) ||
      getCachedEpisode(anime.shortId, episodeNumber) ||
      null
    );
  });

  useEffect(() => {
    const found =
      episodes.find((e) => e.number === episodeNumber) ||
      getCachedEpisode(anime.shortId, episodeNumber);
    if (found) {
      setActiveEpisodeItem(found);
    } else {
      const afterParam =
        episodeNumber > 50 ? Math.floor((episodeNumber - 1) / 50) * 50 : undefined;
      fetchEpisodeBatch(anime.shortId, afterParam, 50, { language: activeType }).then((items) => {
        const match = items.find((e) => e.number === episodeNumber);
        if (match) {
          setActiveEpisodeItem(match);
        }
      });
    }
  }, [anime.shortId, episodeNumber, episodes, activeType]);

  const handleEpisodesLoaded = useCallback(
    (loaded: HoshikaEpisodeItem[]) => {
      const match = loaded.find((e) => e.number === episodeNumber);
      if (match) {
        setActiveEpisodeItem(match);
      }
    },
    [episodeNumber]
  );

  const title =
    anime.titleEnglish ||
    anime.titleRomaji ||
    anime.titleLocalized ||
    'Anime Episode';

  const currentEpItem = episodes.find((e) => e.number === episodeNumber);
  const resolvedEpTitle = activeEpisodeItem?.title?.trim() || currentEpItem?.title?.trim();
  const episodeTitle = resolvedEpTitle || `Episode ${episodeNumber}`;
  const episodeThumbnail =
    activeEpisodeItem?.thumbnail?.trim() ||
    currentEpItem?.thumbnail?.trim() ||
    undefined;
  const episodeDurationSeconds = (anime.episodeDuration || 24) * 60;

  // Initialize URL query params (?type=dub&t=...) and saved resume time on episode mount
  useEffect(() => {
    const savedEntry = getSavedHistoryEntry(anime.shortId, episodeNumber);

    let urlType: 'sub' | 'dub' | null = null;
    let urlTime: number | null = null;

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tParam = params.get('t');
      const typeParam = params.get('type');
      if (typeParam === 'sub' || typeParam === 'dub') {
        urlType = typeParam;
      }
      if (tParam !== null && tParam !== '') {
        const parsedT = Number(tParam);
        if (Number.isFinite(parsedT) && parsedT > 0) {
          urlTime = parsedT;
        }
      }
    }

    if (urlType) {
      userSelectedVersionRef.current = urlType;
      setUserSelectedVersion(urlType);
      setStoredUserAudioVersion(urlType);
      setActiveType(urlType);
    }

    if (urlTime !== null && urlTime > 0) {
      setInitialResumeTime(urlTime);
    } else if (savedEntry && savedEntry.currentTime > 0 && !savedEntry.completed) {
      setInitialResumeTime(savedEntry.currentTime);
    } else {
      setInitialResumeTime(0);
    }
  }, [anime.shortId, episodeNumber]);

  // Update watch-history metadata whenever resolved
  useEffect(() => {
    updateWatchHistoryMetadata({
      hoshikaId: anime.shortId,
      episodeNumber,
      anilistId: idMapping?.anilistId ?? anime.anilistId ?? null,
      malId: idMapping?.malId ?? streamData?.malId ?? anime.malId ?? null,
      title,
      animeTitle: title,
      coverImage: anime.coverImage || undefined,
      animeCover: anime.coverImage || undefined,
      bannerImage: anime.bannerImage || undefined,
      episodeTitle: resolvedEpTitle || undefined,
      episodeThumbnail,
      audioType: activeType,
    });
  }, [
    anime.shortId,
    anime.anilistId,
    anime.malId,
    anime.coverImage,
    anime.bannerImage,
    episodeNumber,
    title,
    resolvedEpTitle,
    episodeThumbnail,
    idMapping?.anilistId,
    idMapping?.malId,
    streamData?.malId,
    activeType,
  ]);

  // Resolve AniList & MAL IDs for this anime
  useEffect(() => {
    let isMounted = true;
    async function resolveIds() {
      setIsResolvingId(true);
      setIdError(null);

      try {
        const res = await fetch(`/api/resolve-ids/${anime.shortId}`);
        if (!res.ok) throw new Error('ID resolution request failed');
        const data: IdMappingResult = await res.json();

        if (isMounted) {
          setIdMapping(data);
          if (!data.anilistId) {
            setIdError(
              'Could not accurately match this anime with AniList streaming catalogue. Please try again or verify title.'
            );
          }
        }
      } catch {
        if (isMounted) {
          setIdError('Failed to resolve streaming identifier for this anime.');
        }
      } finally {
        if (isMounted) {
          setIsResolvingId(false);
        }
      }
    }

    resolveIds();
    return () => {
      isMounted = false;
    };
  }, [anime.shortId]);

  const effectiveFormat = idMapping?.format || anime.format || null;
  const expectedProvider = selectStreamingProvider({ format: effectiveFormat });
  const expectedProviderLabel = getStreamingProviderDisplayName(expectedProvider);

  // Fetch Episode-Specific Sub/Dub Availability & Routed Provider Stream (MegaPlay for Series, ZokoAnime for Movies)
  useEffect(() => {
    const anilistId = idMapping?.anilistId;
    if (!anilistId) return;

    const controller = new AbortController();
    let isMounted = true;
    const resolvedFormat = idMapping?.format || anime.format || null;
    const routedProvider = selectStreamingProvider({ format: resolvedFormat });
    const routedProviderLabel = getStreamingProviderDisplayName(routedProvider);
    const cacheKey = `${routedProvider}:${anilistId}:${episodeNumber}`;

    async function loadEpisodeAvailabilityAndStream() {
      // Clear previous episode stream state immediately so stale streams/qualities never persist
      setStreamData(null);
      setStreamError(null);

      // Check client cache first (unless manual retry was triggered)
      const cached = retryCounter === 0 ? clientEpisodeStreamCache.get(cacheKey) : undefined;
      if (cached) {
        setEpisodeHasSub(cached.subAvailable);
        setEpisodeHasDub(cached.dubAvailable);
        setEpisodeStreams({ sub: cached.subStream, dub: cached.dubStream });
        setIsCheckingAvailability(false);
        setIsLoadingStream(false);

        const chosenVersion = selectEpisodeAudioVersion({
          subAvailable: cached.subAvailable,
          dubAvailable: cached.dubAvailable,
          userSelectedVersion: userSelectedVersionRef.current,
        });

        if (!chosenVersion) {
          setStreamError(
            `Neither Sub nor Dub is available for Episode ${episodeNumber} on ${routedProviderLabel}.`
          );
          return;
        }

        setActiveType(chosenVersion);
        const chosenStream =
          chosenVersion === 'dub' ? cached.dubStream : cached.subStream;
        setStreamData(chosenStream);
        return;
      }

      setIsCheckingAvailability(true);
      setIsLoadingStream(true);

      try {
        const prefParam = userSelectedVersionRef.current
          ? `&preferredType=${userSelectedVersionRef.current}`
          : '';
        const formatQuery = resolvedFormat
          ? `&format=${encodeURIComponent(resolvedFormat)}`
          : '';
        const res = await fetch(
          `/api/stream?anilistId=${anilistId}&episode=${episodeNumber}&hoshikaId=${anime.shortId}${formatQuery}${prefParam}`,
          { signal: controller.signal }
        );
        const data = await res.json();

        if (!isMounted || controller.signal.aborted) return;

        const subAvailable = Boolean(data.subAvailable && data.subStream);
        const dubAvailable = Boolean(data.dubAvailable && data.dubStream);
        const subStream: AniScrollStreamResponse | null = data.subStream || null;
        const dubStream: AniScrollStreamResponse | null = data.dubStream || null;

        setEpisodeHasSub(subAvailable);
        setEpisodeHasDub(dubAvailable);
        setEpisodeStreams({ sub: subStream, dub: dubStream });
        setIsCheckingAvailability(false);

        if (subAvailable || dubAvailable) {
          clientEpisodeStreamCache.set(cacheKey, {
            subAvailable,
            dubAvailable,
            subStream,
            dubStream,
          });
        }

        const chosenVersion = selectEpisodeAudioVersion({
          subAvailable,
          dubAvailable,
          userSelectedVersion: userSelectedVersionRef.current,
        });

        if (!chosenVersion) {
          setStreamData(null);
          setStreamError(
            data.error ||
              `Neither Sub nor Dub is currently available for Episode ${episodeNumber} on ${routedProviderLabel}.`
          );
          return;
        }

        setActiveType(chosenVersion);
        const chosenStream =
          chosenVersion === 'dub'
            ? dubStream
            : chosenVersion === 'sub'
            ? subStream
            : data.stream || null;

        if (chosenStream) {
          setStreamData(chosenStream);
        } else {
          setStreamError(
            `Stream unavailable for Episode ${episodeNumber} (${chosenVersion.toUpperCase()}) on ${routedProviderLabel}.`
          );
        }
      } catch (err: any) {
        if (!isMounted || err?.name === 'AbortError') return;
        setIsCheckingAvailability(false);
        setEpisodeHasSub(false);
        setEpisodeHasDub(false);
        setStreamError(
          `Failed to connect to ${expectedProviderLabel} streaming servers. Please try again.`
        );
      } finally {
        if (isMounted && !controller.signal.aborted) {
          setIsLoadingStream(false);
        }
      }
    }

    loadEpisodeAvailabilityAndStream();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [
    idMapping?.anilistId,
    idMapping?.format,
    anime.format,
    anime.shortId,
    episodeNumber,
    retryCounter,
    expectedProviderLabel,
  ]);

  // Manual user Sub/Dub switch handler
  const handleManualChangeType = useCallback(
    (newType: 'sub' | 'dub') => {
      if (newType === 'sub' && !episodeHasSub) return;
      if (newType === 'dub' && !episodeHasDub) return;

      userSelectedVersionRef.current = newType;
      setUserSelectedVersion(newType);
      setStoredUserAudioVersion(newType);
      setActiveType(newType);
      setStreamError(null);

      const targetStream =
        newType === 'dub' ? episodeStreams.dub : episodeStreams.sub;
      if (targetStream) {
        setStreamData(targetStream);
      }
    },
    [episodeHasSub, episodeHasDub, episodeStreams]
  );

  const resolvedAnilistId = idMapping?.anilistId;

  const handleRetryStream = useCallback(() => {
    if (resolvedAnilistId) {
      clientEpisodeStreamCache.delete(`${expectedProvider}:${resolvedAnilistId}:${episodeNumber}`);
    }
    setRetryCounter((prev) => prev + 1);
  }, [expectedProvider, resolvedAnilistId, episodeNumber]);

  const handleNavigateEpisode = (newEpisode: number) => {
    router.push(`/watch/${anime.shortId}/${newEpisode}`);
  };

  // Episode-specific availability object for EpisodeSection
  const episodeAvailabilityForSection = useMemo<EpisodeAvailabilityResult | null>(() => {
    if (isCheckingAvailability) return null;
    return createEpisodeAvailability({
      subAvailable: episodeHasSub,
      dubAvailable: episodeHasDub,
      subEpisodeCount: episodeHasSub ? totalEpisodes : 0,
      dubEpisodeCount: episodeHasDub ? totalEpisodes : 0,
    });
  }, [isCheckingAvailability, episodeHasSub, episodeHasDub, totalEpisodes]);

  return (
    <div className="space-y-6 pb-20">
      {/* Navigation Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-[#707070]">
        <Link href="/" className="hover:text-white transition-colors">
          Home
        </Link>
        <ChevronRight size={13} />
        <Link
          href={`/anime/${anime.shortId}`}
          className="hover:text-white transition-colors truncate max-w-[200px]"
        >
          {title}
        </Link>
        <ChevronRight size={13} />
        <span className="text-white">Episode {episodeNumber}</span>
      </nav>

      {/* Main Video Section */}
      <div className="space-y-4">
        {isResolvingId ? (
          <div className="aspect-video w-full rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col items-center justify-center gap-3">
            <Loader2 size={40} className="animate-spin text-white" />
            <div className="text-center">
              <p className="text-sm font-semibold text-white">
                Resolving Anime Streaming ID...
              </p>
              <p className="text-xs text-[#707070] mt-1">
                Matching Hoshika metadata with AniList and AniSkip...
              </p>
            </div>
          </div>
        ) : idError ? (
          <div className="aspect-video w-full rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col items-center justify-center p-6 text-center">
            <AlertCircle size={44} className="text-[#A0A0A0] mb-3" />
            <h3 className="text-base font-bold text-white mb-1">
              ID Resolution Error
            </h3>
            <p className="text-xs text-[#A0A0A0] max-w-md mb-4">
              {idError}
            </p>
            <Link
              href={`/anime/${anime.shortId}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors"
            >
              <ArrowLeft size={14} />
              <span>Back to Anime Details</span>
            </Link>
          </div>
        ) : (
          <VideoPlayer
            animeId={anime.shortId}
            anilistId={idMapping?.anilistId ?? anime.anilistId ?? null}
            animeTitle={title}
            coverImage={anime.coverImage || undefined}
            bannerImage={anime.bannerImage || undefined}
            episodeNumber={episodeNumber}
            episodeTitle={episodeTitle}
            episodeThumbnail={episodeThumbnail}
            episodeDurationSeconds={episodeDurationSeconds}
            initialResumeTime={initialResumeTime}
            totalEpisodes={totalEpisodes}
            malId={idMapping?.malId ?? streamData?.malId ?? anime.malId ?? null}
            streamData={streamData}
            isLoadingStream={isLoadingStream}
            streamError={streamError}
            activeType={activeType}
            onChangeType={handleManualChangeType}
            onNavigateEpisode={handleNavigateEpisode}
            onRetryStream={handleRetryStream}
            hasSub={episodeHasSub}
            hasDub={episodeHasDub}
            isLoadingAvailability={isCheckingAvailability}
          />
        )}

        {/* Episode Info Strip */}
        <div className="p-4 md:p-6 bg-[#0A0A0A] rounded-2xl border border-[#292929] flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-[#A0A0A0]">
              <span className="font-semibold text-white uppercase tracking-wider">
                Episode {episodeNumber}
              </span>
              {(episodeHasSub || episodeHasDub) && (
                <>
                  <span aria-hidden="true" className="text-[#707070]">·</span>
                  <span className="uppercase text-[11px] font-mono">{activeType}</span>
                </>
              )}
              {idMapping?.mappingStatus && (
                <>
                  <span aria-hidden="true" className="text-[#707070]">·</span>
                  <span className="text-[10px] text-[#707070]">
                    Verified AniList ID: {idMapping.anilistId}
                  </span>
                </>
              )}
            </div>
            <h2 className="text-lg md:text-xl font-bold text-white mt-1">
              {episodeTitle}
            </h2>
            <Link
              href={`/anime/${anime.shortId}`}
              className="text-xs text-[#A0A0A0] hover:text-white transition-colors mt-0.5 inline-block"
            >
              {title}
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleNavigateEpisode(episodeNumber - 1)}
              disabled={episodeNumber <= 1}
              className="px-4 py-2 rounded-xl border border-[#292929] text-xs font-medium text-white hover:border-white disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              Previous Episode
            </button>
            <button
              onClick={() => handleNavigateEpisode(episodeNumber + 1)}
              disabled={episodeNumber >= totalEpisodes}
              className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              Next Episode
            </button>
          </div>
        </div>
      </div>

      {/* Episode Selection Section */}
      <div className="p-4 sm:p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929]">
        <EpisodeSection
          animeId={anime.shortId}
          episodes={episodes}
          currentEpisode={episodeNumber}
          totalEpisodes={totalEpisodes}
          activeType={activeType}
          onChangeType={handleManualChangeType}
          onEpisodesLoaded={handleEpisodesLoaded}
          initialAvailability={episodeAvailabilityForSection}
          deferAvailability={isResolvingId || isCheckingAvailability}
        />
      </div>
    </div>
  );
}
