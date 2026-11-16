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
  getUserPreferences,
  updateWatchHistoryMetadata,
} from '@/lib/storage';
import {
  cacheEpisodes,
  getCachedEpisode,
  fetchEpisodeBatch,
  createEpisodeAvailability,
  EpisodeAvailabilityResult,
} from '@/lib/episode-store';
import {
  resolveEffectiveAudioPreference,
  sanitizeStreamUrlForDiagnostic,
  selectEpisodeAudioVersion,
} from '@/lib/zokoanime-stream';
import { clientEpisodeStreamCache } from '@/lib/client-stream-cache';
import {
  getStreamingProviderDisplayName,
  selectStreamingProvider,
} from '@/lib/stream-provider-core';
import { ChevronRight, ArrowLeft, AlertCircle, Loader2 } from 'lucide-react';

const STREAM_DEBUG_ENABLED =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_DEBUG_STREAM === 'true';

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

  const [defaultAudio, setDefaultAudio] = useState<'sub' | 'dub'>('sub');
  const [userSelectedVersion, setUserSelectedVersion] = useState<'sub' | 'dub' | null>(null);
  const [preferencesReady, setPreferencesReady] = useState<boolean>(false);
  const [activeType, setActiveType] = useState<'sub' | 'dub'>('sub');

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

  const defaultAudioRef = useRef<'sub' | 'dub'>(defaultAudio);
  const userSelectedVersionRef = useRef<'sub' | 'dub' | null>(userSelectedVersion);
  const isCheckingAvailabilityRef = useRef<boolean>(isCheckingAvailability);
  const episodeHasSubRef = useRef<boolean>(episodeHasSub);
  const episodeHasDubRef = useRef<boolean>(episodeHasDub);
  const episodeStreamsRef = useRef(episodeStreams);
  const episodeErrorCodesRef = useRef<{ sub: string | null; dub: string | null }>({
    sub: null,
    dub: null,
  });

  useEffect(() => {
    defaultAudioRef.current = defaultAudio;
  }, [defaultAudio]);

  useEffect(() => {
    userSelectedVersionRef.current = userSelectedVersion;
  }, [userSelectedVersion]);

  useEffect(() => {
    isCheckingAvailabilityRef.current = isCheckingAvailability;
  }, [isCheckingAvailability]);

  useEffect(() => {
    episodeHasSubRef.current = episodeHasSub;
  }, [episodeHasSub]);

  useEffect(() => {
    episodeHasDubRef.current = episodeHasDub;
  }, [episodeHasDub]);

  useEffect(() => {
    episodeStreamsRef.current = episodeStreams;
  }, [episodeStreams]);

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

  // Hydrate persistent Default Audio Mode setting & session manual override, and subscribe to live Settings/Cloud updates
  useEffect(() => {
    const syncAudioPreferences = () => {
      const prefs = getUserPreferences();
      const nextDefault: 'sub' | 'dub' = prefs.defaultAudio === 'dub' ? 'dub' : 'sub';
      defaultAudioRef.current = nextDefault;
      setDefaultAudio(nextDefault);

      const storedManual = getStoredUserAudioVersion();
      userSelectedVersionRef.current = storedManual;
      setUserSelectedVersion(storedManual);
      setPreferencesReady(true);

      const effectivePref = resolveEffectiveAudioPreference({
        manualSelection: storedManual,
        defaultAudio: nextDefault,
      });

      if (!storedManual && !isCheckingAvailabilityRef.current) {
        const errCodeForPreferred =
          nextDefault === 'dub'
            ? episodeErrorCodesRef.current.dub
            : episodeErrorCodesRef.current.sub;
        const availableForPreferred =
          nextDefault === 'dub' ? episodeHasDubRef.current : episodeHasSubRef.current;

        if (
          !availableForPreferred &&
          errCodeForPreferred &&
          errCodeForPreferred !== 'not_found'
        ) {
          setRetryCounter((prev) => prev + 1);
          return;
        }

        const chosen = selectEpisodeAudioVersion({
          subAvailable: episodeHasSubRef.current,
          dubAvailable: episodeHasDubRef.current,
          userSelectedVersion: null,
          defaultAudio: nextDefault,
        });
        if (chosen) {
          const chosenStream =
            chosen === 'dub' ? episodeStreamsRef.current.dub : episodeStreamsRef.current.sub;
          if (chosenStream && chosenStream.type === chosen) {
            setActiveType(chosen);
            setStreamError(null);
            setStreamData(chosenStream);
          }
        }
      } else if (!storedManual) {
        setActiveType(effectivePref);
      }
    };

    syncAudioPreferences();

    const handlePrefsUpdated = () => syncAudioPreferences();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'aniscroll_preferences') {
        syncAudioPreferences();
      }
    };

    window.addEventListener('aniscroll_preferences_updated', handlePrefsUpdated);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('aniscroll_preferences_updated', handlePrefsUpdated);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

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
      audioType: streamData?.type ?? undefined,
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
    streamData?.type,
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
    if (!anilistId || !preferencesReady) return;

    const controller = new AbortController();
    let isMounted = true;
    const resolvedFormat = idMapping?.format || anime.format || null;
    const routedProvider = selectStreamingProvider({ format: resolvedFormat });
    const routedProviderLabel = getStreamingProviderDisplayName(routedProvider);

    async function loadEpisodeAvailabilityAndStream() {
      // Clear previous episode stream & availability state immediately so stale streams/audio flags never leak
      setStreamData(null);
      setStreamError(null);
      episodeHasSubRef.current = false;
      episodeHasDubRef.current = false;
      episodeStreamsRef.current = { sub: null, dub: null };
      episodeErrorCodesRef.current = { sub: null, dub: null };
      setEpisodeHasSub(false);
      setEpisodeHasDub(false);
      setEpisodeStreams({ sub: null, dub: null });

      const effectivePreferred = resolveEffectiveAudioPreference({
        manualSelection: userSelectedVersionRef.current,
        defaultAudio: defaultAudioRef.current,
      });

      // Check audio-type-isolated client cache first (unless manual retry was triggered)
      const cached =
        retryCounter === 0
          ? clientEpisodeStreamCache.resolveForPreference({
              provider: routedProvider,
              anilistId: anilistId!,
              episode: episodeNumber,
              userSelectedVersion: userSelectedVersionRef.current,
              defaultAudio: defaultAudioRef.current,
            })
          : null;

      if (cached) {
        episodeHasSubRef.current = cached.subAvailable;
        episodeHasDubRef.current = cached.dubAvailable;
        episodeStreamsRef.current = { sub: cached.subStream, dub: cached.dubStream };
        episodeErrorCodesRef.current = {
          sub: cached.subErrorCode ?? null,
          dub: cached.dubErrorCode ?? null,
        };
        isCheckingAvailabilityRef.current = false;

        setEpisodeHasSub(cached.subAvailable);
        setEpisodeHasDub(cached.dubAvailable);
        setEpisodeStreams({ sub: cached.subStream, dub: cached.dubStream });
        setIsCheckingAvailability(false);
        setIsLoadingStream(false);

        if (STREAM_DEBUG_ENABLED) {
          console.debug('[AniScroll][WatchPageClient] client cache hit', {
            anilistId,
            episodeNumber,
            provider: routedProvider,
            requestedType: effectivePreferred,
            defaultAudio: defaultAudioRef.current,
            userSelectedVersion: userSelectedVersionRef.current,
            subAvailable: cached.subAvailable,
            dubAvailable: cached.dubAvailable,
            selectedType: cached.chosenVersion,
            returnedStreamType: cached.chosenStream?.type ?? null,
            sanitizedUrl: sanitizeStreamUrlForDiagnostic(cached.chosenStream?.hlsProxyUrl),
          });
        }

        if (!cached.chosenVersion || !cached.chosenStream) {
          setStreamError(
            `Neither Sub nor Dub is available for Episode ${episodeNumber} on ${routedProviderLabel}.`
          );
          return;
        }

        setActiveType(cached.chosenVersion);
        setStreamData(cached.chosenStream);
        return;
      }

      isCheckingAvailabilityRef.current = true;
      setIsCheckingAvailability(true);
      setIsLoadingStream(true);

      try {
        const formatQuery = resolvedFormat
          ? `&format=${encodeURIComponent(resolvedFormat)}`
          : '';
        const res = await fetch(
          `/api/stream?anilistId=${anilistId}&episode=${episodeNumber}&hoshikaId=${anime.shortId}${formatQuery}&type=${effectivePreferred}&preferredType=${effectivePreferred}&provider=${routedProvider}`,
          { signal: controller.signal, cache: 'no-store' }
        );
        const data = (await res.json().catch(() => null)) as Record<string, any> | null;

        if (!isMounted || controller.signal.aborted) return;

        if (!data) {
          isCheckingAvailabilityRef.current = false;
          setIsCheckingAvailability(false);
          setEpisodeHasSub(false);
          setEpisodeHasDub(false);
          setStreamData(null);
          setStreamError(
            res.status === 504
              ? `${routedProviderLabel} timed out while resolving Episode ${episodeNumber}. Please retry.`
              : `${routedProviderLabel} returned an unexpected error (HTTP ${res.status}). Please retry.`
          );
          return;
        }

        const rawSubStream: AniScrollStreamResponse | null = data.subStream || null;
        const rawDubStream: AniScrollStreamResponse | null = data.dubStream || null;
        const subStream =
          rawSubStream && rawSubStream.type === 'sub' ? rawSubStream : null;
        const dubStream =
          rawDubStream && rawDubStream.type === 'dub' ? rawDubStream : null;
        const subAvailable = Boolean(data.subAvailable && subStream);
        const dubAvailable = Boolean(data.dubAvailable && dubStream);
        const subErrorCode: string | null =
          typeof data.subErrorCode === 'string' ? data.subErrorCode : null;
        const dubErrorCode: string | null =
          typeof data.dubErrorCode === 'string' ? data.dubErrorCode : null;

        episodeHasSubRef.current = subAvailable;
        episodeHasDubRef.current = dubAvailable;
        episodeStreamsRef.current = { sub: subStream, dub: dubStream };
        episodeErrorCodesRef.current = { sub: subErrorCode, dub: dubErrorCode };
        isCheckingAvailabilityRef.current = false;

        setEpisodeHasSub(subAvailable);
        setEpisodeHasDub(dubAvailable);
        setEpisodeStreams({ sub: subStream, dub: dubStream });
        setIsCheckingAvailability(false);

        if (subAvailable || dubAvailable) {
          clientEpisodeStreamCache.setEpisodeBundle({
            provider: routedProvider,
            anilistId: anilistId!,
            episode: episodeNumber,
            subAvailable,
            dubAvailable,
            subStream,
            dubStream,
            subErrorCode,
            dubErrorCode,
          });
        }

        // Recompute using the latest manual & Default Audio Mode refs so concurrent updates are respected
        const chosenVersion = selectEpisodeAudioVersion({
          subAvailable,
          dubAvailable,
          userSelectedVersion: userSelectedVersionRef.current,
          defaultAudio: defaultAudioRef.current,
        });

        const chosenStream =
          chosenVersion === 'dub'
            ? dubStream
            : chosenVersion === 'sub'
            ? subStream
            : null;

        if (STREAM_DEBUG_ENABLED) {
          console.debug('[AniScroll][WatchPageClient] stream resolved', {
            anilistId,
            episodeNumber,
            provider: routedProvider,
            requestedType: effectivePreferred,
            defaultAudio: defaultAudioRef.current,
            userSelectedVersion: userSelectedVersionRef.current,
            subAvailable,
            dubAvailable,
            apiSelectedType: data.selectedType ?? null,
            chosenVersion,
            cacheHit: false,
            returnedStreamType: chosenStream?.type ?? null,
            playbackMode: chosenStream?.playbackMode ?? null,
            sanitizedUrl: sanitizeStreamUrlForDiagnostic(chosenStream?.hlsProxyUrl),
          });
        }

        if (!chosenVersion) {
          setStreamData(null);
          setStreamError(
            data.error ||
              (res.status === 429
                ? `${routedProviderLabel} rate limit reached. Please wait a moment and retry.`
                : res.status === 504
                ? `${routedProviderLabel} timed out resolving Episode ${episodeNumber}. Please retry.`
                : `Neither Sub nor Dub is currently available for Episode ${episodeNumber} on ${routedProviderLabel}.`)
          );
          return;
        }

        if (chosenStream && chosenStream.type === chosenVersion) {
          setActiveType(chosenVersion);
          setStreamData(chosenStream);
        } else {
          setStreamData(null);
          setStreamError(
            data.error ||
              `Stream unavailable for Episode ${episodeNumber} (${chosenVersion.toUpperCase()}) on ${routedProviderLabel}.`
          );
        }
      } catch (err: any) {
        if (!isMounted || err?.name === 'AbortError') return;
        isCheckingAvailabilityRef.current = false;
        setIsCheckingAvailability(false);
        setEpisodeHasSub(false);
        setEpisodeHasDub(false);
        setStreamData(null);
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
    preferencesReady,
  ]);

  const resolvedAnilistId = idMapping?.anilistId;

  // Manual user Sub/Dub switch handler
  const handleManualChangeType = useCallback(
    (newType: 'sub' | 'dub') => {
      if (newType === 'sub' && !episodeHasSubRef.current) return;
      if (newType === 'dub' && !episodeHasDubRef.current) return;

      userSelectedVersionRef.current = newType;
      setUserSelectedVersion(newType);
      setStoredUserAudioVersion(newType);
      setActiveType(newType);
      setStreamError(null);

      const targetStream =
        newType === 'dub' ? episodeStreamsRef.current.dub : episodeStreamsRef.current.sub;

      if (STREAM_DEBUG_ENABLED) {
        console.debug('[AniScroll][WatchPageClient] manual audio switch', {
          episodeNumber,
          requestedType: newType,
          hasTargetStream: Boolean(targetStream),
          targetStreamType: targetStream?.type ?? null,
          sanitizedUrl: sanitizeStreamUrlForDiagnostic(targetStream?.hlsProxyUrl),
        });
      }

      if (targetStream && targetStream.type === newType) {
        setStreamData(targetStream);
      } else {
        // Never keep stale opposite-audio streamData active; clear and re-fetch cleanly
        setStreamData(null);
        if (resolvedAnilistId) {
          clientEpisodeStreamCache.deleteEpisode(
            expectedProvider,
            resolvedAnilistId,
            episodeNumber
          );
        }
        setRetryCounter((prev) => prev + 1);
      }
    },
    [episodeNumber, expectedProvider, resolvedAnilistId]
  );

  const handleRetryStream = useCallback(() => {
    if (resolvedAnilistId) {
      clientEpisodeStreamCache.deleteEpisode(expectedProvider, resolvedAnilistId, episodeNumber);
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
    <div className="space-y-3 sm:space-y-5 [@media(orientation:landscape)_and_(max-height:500px)]:space-y-2 pb-20 w-full max-w-full overflow-x-hidden">
      {/* Navigation Breadcrumb */}
      <nav className="flex items-center gap-1.5 sm:gap-2 text-xs text-[#707070] min-w-0">
        <Link href="/" className="hover:text-white transition-colors shrink-0">
          Home
        </Link>
        <ChevronRight size={13} className="shrink-0" />
        <Link
          href={`/anime/${anime.shortId}`}
          className="hover:text-white transition-colors truncate min-w-0 max-w-[140px] sm:max-w-[200px]"
        >
          {title}
        </Link>
        <ChevronRight size={13} className="shrink-0" />
        <span className="text-white shrink-0">Episode {episodeNumber}</span>
      </nav>

      {/* Main Video Section */}
      <div className="space-y-4">
        {isResolvingId ? (
          <div className="aspect-video w-full rounded-xl sm:rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col items-center justify-center gap-2 sm:gap-3 p-4">
            <Loader2 size={32} className="sm:w-10 sm:h-10 animate-spin text-white" />
            <div className="text-center">
              <p className="text-xs sm:text-sm font-semibold text-white">
                Resolving Anime Streaming ID...
              </p>
              <p className="text-[11px] sm:text-xs text-[#707070] mt-1">
                Matching Hoshika metadata with AniList and AniSkip...
              </p>
            </div>
          </div>
        ) : idError ? (
          <div className="aspect-video w-full rounded-xl sm:rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col items-center justify-center p-4 sm:p-6 text-center">
            <AlertCircle size={32} className="sm:w-11 sm:h-11 text-[#A0A0A0] mb-2 sm:mb-3" />
            <h3 className="text-sm sm:text-base font-bold text-white mb-1">
              ID Resolution Error
            </h3>
            <p className="text-[11px] sm:text-xs text-[#A0A0A0] max-w-md mb-3 sm:mb-4">
              {idError}
            </p>
            <Link
              href={`/anime/${anime.shortId}`}
              className="inline-flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors"
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
            animeFormat={effectiveFormat}
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
            subStream={episodeStreams.sub}
            dubStream={episodeStreams.dub}
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
