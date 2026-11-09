'use client';

import React, { useState, useEffect } from 'react';
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
import { getUserPreferences } from '@/lib/storage';
import { cacheEpisodes, getCachedEpisode, fetchEpisodeBatch } from '@/lib/episode-store';
import { ChevronRight, ArrowLeft, AlertCircle, Loader2 } from 'lucide-react';

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

  const [activeType, setActiveType] = useState<'sub' | 'dub'>('sub');
  const [idMapping, setIdMapping] = useState<IdMappingResult | null>(null);
  const [isResolvingId, setIsResolvingId] = useState<boolean>(true);
  const [idError, setIdError] = useState<string | null>(null);

  const [streamData, setStreamData] = useState<AniScrollStreamResponse | null>(null);
  const [isLoadingStream, setIsLoadingStream] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  // Store server-passed episodes into cache on mount
  useEffect(() => {
    if (episodes && episodes.length > 0) {
      cacheEpisodes(anime.shortId, episodes);
    }
  }, [anime.shortId, episodes]);

  const [activeEpisodeItem, setActiveEpisodeItem] = useState<HoshikaEpisodeItem | null>(() => {
    return episodes.find((e) => e.number === episodeNumber) || getCachedEpisode(anime.shortId, episodeNumber) || null;
  });

  useEffect(() => {
    const found = episodes.find((e) => e.number === episodeNumber) || getCachedEpisode(anime.shortId, episodeNumber);
    if (found) {
      setActiveEpisodeItem(found);
    } else {
      const afterParam = episodeNumber > 50 ? Math.floor((episodeNumber - 1) / 50) * 50 : undefined;
      fetchEpisodeBatch(anime.shortId, afterParam, 50).then((items) => {
        const match = items.find((e) => e.number === episodeNumber);
        if (match) {
          setActiveEpisodeItem(match);
        }
      });
    }
  }, [anime.shortId, episodeNumber, episodes]);

  const title =
    anime.titleEnglish ||
    anime.titleRomaji ||
    anime.titleLocalized ||
    'Anime Episode';

  const currentEpItem = episodes.find((e) => e.number === episodeNumber);
  const episodeTitle = activeEpisodeItem?.title || currentEpItem?.title || `Episode ${episodeNumber}`;
  const totalEpisodes = anime.episodes || episodes.length || 1;

  // Initialize preferred audio format (sub/dub)
  useEffect(() => {
    const prefs = getUserPreferences();
    if (prefs.defaultAudio) {
      setActiveType(prefs.defaultAudio);
    }
  }, []);

  // STEP 1-8: Resolve IDs for this anime
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
      } catch (err: any) {
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

  // Fetch AniScroll Stream when anilistId, episodeNumber, or activeType changes
  useEffect(() => {
    if (!idMapping?.anilistId) return;

    let isMounted = true;
    async function fetchStream() {
      setIsLoadingStream(true);
      setStreamError(null);

      try {
        const res = await fetch(
          `/api/stream?anilistId=${idMapping!.anilistId}&episode=${episodeNumber}&type=${activeType}`
        );
        const data = await res.json();

        if (!isMounted) return;

        if (data.ok && data.stream) {
          setStreamData(data.stream);
        } else {
          setStreamError(
            data.error ||
              `Stream unavailable for Episode ${episodeNumber} (${activeType.toUpperCase()}). Try switching to ${
                activeType === 'sub' ? 'DUB' : 'SUB'
              }.`
          );
        }
      } catch (err: any) {
        if (isMounted) {
          setStreamError('Failed to connect to streaming servers. Please try again.');
        }
      } finally {
        if (isMounted) {
          setIsLoadingStream(false);
        }
      }
    }

    fetchStream();
    return () => {
      isMounted = false;
    };
  }, [idMapping, episodeNumber, activeType]);

  const handleNavigateEpisode = (newEpisode: number) => {
    router.push(`/watch/${anime.shortId}/${newEpisode}`);
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Navigation Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-[#707070]">
        <Link href="/" className="hover:text-white transition-colors">
          Home
        </Link>
        <ChevronRight size={13} />
        <Link href={`/anime/${anime.shortId}`} className="hover:text-white transition-colors truncate max-w-[200px]">
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
            animeTitle={title}
            episodeNumber={episodeNumber}
            episodeTitle={episodeTitle}
            totalEpisodes={totalEpisodes}
            malId={idMapping?.malId}
            streamData={streamData}
            isLoadingStream={isLoadingStream}
            streamError={streamError}
            activeType={activeType}
            onChangeType={setActiveType}
            onNavigateEpisode={handleNavigateEpisode}
          />
        )}

        {/* Episode Info Strip */}
        <div className="p-4 md:p-6 bg-[#0A0A0A] rounded-2xl border border-[#292929] flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-[#A0A0A0]">
              <span className="font-semibold text-white uppercase tracking-wider">
                Episode {episodeNumber}
              </span>
              <span aria-hidden="true" className="text-[#707070]">·</span>
              <span className="uppercase text-[11px] font-mono">{activeType}</span>
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
              className="px-4 py-2 rounded-xl border border-[#292929] text-xs font-medium text-white hover:border-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              Previous Episode
            </button>
            <button
              onClick={() => handleNavigateEpisode(episodeNumber + 1)}
              disabled={episodeNumber >= totalEpisodes}
              className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 disabled:opacity-30 disabled:pointer-events-none transition-colors"
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
          onChangeType={setActiveType}
          onEpisodesLoaded={(loaded) => {
            const match = loaded.find((e) => e.number === episodeNumber);
            if (match) setActiveEpisodeItem(match);
          }}
        />
      </div>
    </div>
  );
}
