'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Search, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { HoshikaEpisodeItem } from '@/types/anime';
import { WatchHistoryEntry } from '@/types/streaming';
import { getWatchHistory, getUserPreferences } from '@/lib/storage';
import {
  generateEpisodeRanges,
  findRangeForEpisode,
  EpisodeRange,
} from '@/lib/episode-pagination';
import {
  AudioLanguage,
  EpisodeAvailabilityResult,
  cacheEpisodes,
  getCachedEpisodes,
  fetchEpisodeBatchWithMeta,
  isRangeCached,
  invalidateAnimeEpisodeCache,
  selectDefaultLanguage,
} from '@/lib/episode-store';
import { useEpisodeAvailability } from '@/hooks/useEpisodeAvailability';
import { EpisodeRangeSelector } from './EpisodeRangeSelector';
import { EpisodeList } from './EpisodeList';

interface EpisodeSectionProps {
  animeId: string | number;
  episodes: HoshikaEpisodeItem[];
  totalEpisodes?: number;
  currentEpisode?: number;
  activeType?: AudioLanguage;
  onChangeType?: (type: AudioLanguage) => void;
  showSubDubToggle?: boolean;
  initialAvailability?: EpisodeAvailabilityResult | null;
  className?: string;
  onEpisodesLoaded?: (episodes: HoshikaEpisodeItem[]) => void;
  onAvailabilityResolved?: (availability: EpisodeAvailabilityResult) => void;
}

export function EpisodeSection({
  animeId,
  episodes: initialEpisodes,
  totalEpisodes,
  currentEpisode,
  activeType: externalActiveType,
  onChangeType: externalOnChangeType,
  showSubDubToggle = true,
  initialAvailability = null,
  className = '',
  onEpisodesLoaded,
  onAvailabilityResolved,
}: EpisodeSectionProps) {
  const normalizedAnimeId = String(animeId).trim();

  // Preferred language from user preferences if not externally controlled
  const [preferredType, setPreferredType] = useState<AudioLanguage>(() => {
    if (externalActiveType) return externalActiveType;
    if (typeof window !== 'undefined') {
      const prefs = getUserPreferences();
      if (prefs.defaultAudio === 'dub' || prefs.defaultAudio === 'sub') {
        return prefs.defaultAudio;
      }
    }
    return 'sub';
  });

  const [localActiveType, setLocalActiveType] = useState<AudioLanguage>(preferredType);
  const activeType: AudioLanguage = externalActiveType ?? localActiveType;

  // Stabilize callbacks in refs to prevent useEffect request loops
  const onEpisodesLoadedRef = useRef(onEpisodesLoaded);
  const onAvailabilityResolvedRef = useRef(onAvailabilityResolved);
  const externalOnChangeTypeRef = useRef(externalOnChangeType);

  useEffect(() => {
    onEpisodesLoadedRef.current = onEpisodesLoaded;
    onAvailabilityResolvedRef.current = onAvailabilityResolved;
    externalOnChangeTypeRef.current = externalOnChangeType;
  }, [onEpisodesLoaded, onAvailabilityResolved, externalOnChangeType]);

  const handleSelectLanguage = useCallback((type: AudioLanguage) => {
    setPreferredType(type);
    setLocalActiveType(type);
    if (externalOnChangeTypeRef.current) {
      externalOnChangeTypeRef.current(type);
    }
  }, []);

  // Resolve dynamic Sub/Dub availability for this anime
  const {
    availability,
    isLoadingAvailability,
    hasSub,
    hasDub,
    hasAny,
    refreshAvailability,
  } = useEpisodeAvailability(normalizedAnimeId, {
    preferredLanguage: activeType,
    initialAvailability,
  });

  // Notify parent when availability resolves and auto-correct activeType if unavailable
  useEffect(() => {
    if (isLoadingAvailability) return;

    if (onAvailabilityResolvedRef.current) {
      onAvailabilityResolvedRef.current(availability);
    }

    const recommended = selectDefaultLanguage(availability, activeType);
    if (recommended && recommended !== activeType) {
      setLocalActiveType(recommended);
      if (externalOnChangeTypeRef.current) {
        externalOnChangeTypeRef.current(recommended);
      }
    }
  }, [availability, isLoadingAvailability, activeType]);

  // Search filter
  const [filterQuery, setFilterQuery] = useState('');

  // Watch history map: { [episodeNumber]: WatchHistoryEntry }
  const [historyMap, setHistoryMap] = useState<Record<number, WatchHistoryEntry>>({});

  // Loading & retry states for episode batches
  const [isLoadingBatch, setIsLoadingBatch] = useState(false);
  const [retryStatusText, setRetryStatusText] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  // Loaded real episodes map: Map<episodeNumber, HoshikaEpisodeItem>
  const [episodesMap, setEpisodesMap] = useState<Map<number, HoshikaEpisodeItem>>(() => {
    const map = new Map<number, HoshikaEpisodeItem>();
    const cached = getCachedEpisodes(normalizedAnimeId);
    for (const ep of cached) {
      if (ep && typeof ep.number === 'number') {
        map.set(ep.number, ep);
      }
    }
    if (initialEpisodes && initialEpisodes.length > 0) {
      cacheEpisodes(normalizedAnimeId, initialEpisodes, {
        language: 'sub',
        limit: Math.max(50, initialEpisodes.length),
        total: totalEpisodes || initialEpisodes.length,
        nextAfter:
          initialEpisodes.length < 50 ||
          (totalEpisodes && initialEpisodes.length >= totalEpisodes)
            ? null
            : undefined,
        availability: initialAvailability || undefined,
      });
      for (const ep of initialEpisodes) {
        if (ep && typeof ep.number === 'number') {
          map.set(ep.number, ep);
        }
      }
    }
    return map;
  });

  const episodesMapRef = useRef(episodesMap);
  useEffect(() => {
    episodesMapRef.current = episodesMap;
  }, [episodesMap]);

  // Track which batch keys have already been attempted in this component mount
  const attemptedBatchesRef = useRef<Set<string>>(new Set());

  // Reset state cleanly when navigating to a different animeId
  const prevAnimeIdRef = useRef(normalizedAnimeId);
  useEffect(() => {
    if (prevAnimeIdRef.current !== normalizedAnimeId) {
      prevAnimeIdRef.current = normalizedAnimeId;
      attemptedBatchesRef.current.clear();
      setBatchError(null);
      setRetryStatusText(null);

      const nextMap = new Map<number, HoshikaEpisodeItem>();
      const cached = getCachedEpisodes(normalizedAnimeId);
      for (const ep of cached) {
        if (ep && typeof ep.number === 'number') {
          nextMap.set(ep.number, ep);
        }
      }
      if (initialEpisodes && initialEpisodes.length > 0) {
        cacheEpisodes(normalizedAnimeId, initialEpisodes, {
          language: 'sub',
          limit: Math.max(50, initialEpisodes.length),
          total: totalEpisodes || initialEpisodes.length,
          nextAfter:
            initialEpisodes.length < 50 ||
            (totalEpisodes && initialEpisodes.length >= totalEpisodes)
              ? null
              : undefined,
        });
        for (const ep of initialEpisodes) {
          if (ep && typeof ep.number === 'number') {
            nextMap.set(ep.number, ep);
          }
        }
      }
      setEpisodesMap(nextMap);
    }
  }, [normalizedAnimeId, initialEpisodes, totalEpisodes]);

  // Sync initialEpisodes into episodesMap when server props update without triggering extra renders
  useEffect(() => {
    if (initialEpisodes && initialEpisodes.length > 0) {
      cacheEpisodes(normalizedAnimeId, initialEpisodes, {
        language: 'sub',
        limit: Math.max(50, initialEpisodes.length),
        total: totalEpisodes || initialEpisodes.length,
        nextAfter:
          initialEpisodes.length < 50 ||
          (totalEpisodes && initialEpisodes.length >= totalEpisodes)
            ? null
            : undefined,
      });
      setEpisodesMap((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const ep of initialEpisodes) {
          if (ep && typeof ep.number === 'number' && !next.has(ep.number)) {
            next.set(ep.number, ep);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [normalizedAnimeId, initialEpisodes, totalEpisodes]);

  // Compute total episode count using language-specific count if available
  const computedTotalEpisodes = useMemo(() => {
    const langCount =
      activeType === 'dub'
        ? availability.dub.episodeCount
        : availability.sub.episodeCount;

    if (!isLoadingAvailability && langCount > 0) {
      return langCount;
    }
    if (totalEpisodes && totalEpisodes > 0) return totalEpisodes;
    if (episodesMap.size > 0) {
      let maxNum = 0;
      episodesMap.forEach((_, num) => {
        if (num > maxNum) maxNum = num;
      });
      if (maxNum > 0) return maxNum;
    }
    if (initialEpisodes && initialEpisodes.length > 0) return initialEpisodes.length;
    return 12;
  }, [
    activeType,
    availability.dub.episodeCount,
    availability.sub.episodeCount,
    isLoadingAvailability,
    totalEpisodes,
    episodesMap,
    initialEpisodes,
  ]);

  // Generate dynamic 50-episode ranges
  const ranges = useMemo(() => {
    return generateEpisodeRanges(computedTotalEpisodes, 50);
  }, [computedTotalEpisodes]);

  // Selected range index
  const [selectedRangeIndex, setSelectedRangeIndex] = useState<number>(() => {
    if (currentEpisode && currentEpisode > 0) {
      const match = findRangeForEpisode(currentEpisode, ranges);
      return match ? match.index : 0;
    }
    return 0;
  });

  const lastCurrentEpisodeRef = useRef(currentEpisode);
  const lastRangesLengthRef = useRef(ranges.length);

  // Sync selected range when currentEpisode changes or ranges expand
  useEffect(() => {
    if (currentEpisode && currentEpisode > 0 && ranges.length > 0) {
      const episodeChanged = lastCurrentEpisodeRef.current !== currentEpisode;
      const rangesNewlyPopulated = ranges.length > 1 && lastRangesLengthRef.current <= 1;

      if (episodeChanged || rangesNewlyPopulated) {
        lastCurrentEpisodeRef.current = currentEpisode;
        lastRangesLengthRef.current = ranges.length;
        const match = findRangeForEpisode(currentEpisode, ranges);
        if (match) {
          setSelectedRangeIndex(match.index);
        }
      }
    }
    lastRangesLengthRef.current = ranges.length;
  }, [currentEpisode, ranges]);

  // Stable batch loader that never recreates on episodesMap or parent callback changes
  const loadRangeEpisodes = useCallback(
    async (
      range: EpisodeRange,
      lang: AudioLanguage,
      options?: { forceRefresh?: boolean; signal?: AbortSignal }
    ) => {
      if (!range) return;

      const afterParam = range.start > 1 ? range.start - 1 : undefined;
      const attemptKey = `${normalizedAnimeId}:${lang}:after=${afterParam ?? 0}`;

      if (!options?.forceRefresh) {
        // 1. Check if range is already fully present in component state
        const currentMap = episodesMapRef.current;
        let allPresent = true;
        for (let n = range.start; n <= range.end; n++) {
          if (!currentMap.has(n)) {
            allPresent = false;
            break;
          }
        }
        if (allPresent && currentMap.size > 0) {
          return;
        }

        // 2. Check if range/batch was already cached in module store
        if (isRangeCached(normalizedAnimeId, range.start, range.end, lang)) {
          const cached = getCachedEpisodes(normalizedAnimeId);
          if (cached.length > 0) {
            setEpisodesMap((prev) => {
              let changed = false;
              const next = new Map(prev);
              for (const ep of cached) {
                if (ep && typeof ep.number === 'number' && !next.has(ep.number)) {
                  next.set(ep.number, ep);
                  changed = true;
                }
              }
              return changed ? next : prev;
            });
            return;
          }
        }

        // 3. Avoid repeating an already attempted batch in the same view session
        if (attemptedBatchesRef.current.has(attemptKey)) {
          return;
        }
      }

      attemptedBatchesRef.current.add(attemptKey);
      setIsLoadingBatch(true);
      setBatchError(null);
      setRetryStatusText(null);

      try {
        const response = await fetchEpisodeBatchWithMeta(
          normalizedAnimeId,
          afterParam,
          50,
          {
            language: lang,
            forceRefresh: options?.forceRefresh,
            signal: options?.signal,
            onRetryAttempt: (attempt, delayMs) => {
              const sec = Math.max(1, Math.round(delayMs / 1000));
              setRetryStatusText(`Retrying episode fetch (attempt ${attempt}/5 in ${sec}s)...`);
            },
          }
        );

        if (options?.signal?.aborted) return;

        setRetryStatusText(null);

        if (response.items && response.items.length > 0) {
          setEpisodesMap((prev) => {
            let changed = false;
            const next = new Map(prev);
            for (const ep of response.items) {
              if (ep && typeof ep.number === 'number') {
                const existing = next.get(ep.number);
                if (!existing || existing.title !== ep.title || existing.thumbnail !== ep.thumbnail) {
                  next.set(ep.number, ep);
                  changed = true;
                }
              }
            }
            return changed ? next : prev;
          });
          if (onEpisodesLoadedRef.current) {
            onEpisodesLoadedRef.current(response.items);
          }
        } else if (!response.ok) {
          setBatchError(response.error || 'Episodes are not available yet.');
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          attemptedBatchesRef.current.delete(attemptKey);
          return;
        }
        setBatchError('Failed to load episode data. Please try again.');
      } finally {
        if (!options?.signal?.aborted) {
          setIsLoadingBatch(false);
          setRetryStatusText(null);
        }
      }
    },
    [normalizedAnimeId]
  );

  // Trigger episode batch check only when animeId, selectedRangeIndex, or activeType changes
  useEffect(() => {
    const range = ranges[selectedRangeIndex] || ranges[0];
    if (!range) return;

    const controller = new AbortController();
    loadRangeEpisodes(range, activeType, { signal: controller.signal });

    return () => {
      controller.abort();
    };
  }, [normalizedAnimeId, selectedRangeIndex, activeType, ranges, loadRangeEpisodes]);

  // Manual retry handler when episodes are unavailable
  const handleManualRetry = useCallback(async () => {
    const range = ranges[selectedRangeIndex] || ranges[0];
    if (!range) return;
    invalidateAnimeEpisodeCache(normalizedAnimeId);
    attemptedBatchesRef.current.clear();
    await Promise.all([
      refreshAvailability(),
      loadRangeEpisodes(range, activeType, { forceRefresh: true }),
    ]);
  }, [normalizedAnimeId, ranges, selectedRangeIndex, activeType, refreshAvailability, loadRangeEpisodes]);

  // Load user watch history
  useEffect(() => {
    const loadHistory = () => {
      const numericId = typeof animeId === 'string' ? parseInt(animeId, 10) : animeId;
      const history = getWatchHistory();
      const animeHistory = history.filter((h) => h.hoshikaId === numericId);

      const map: Record<number, WatchHistoryEntry> = {};
      let lastWatchedEp = 0;
      let lastWatchedTime = 0;

      animeHistory.forEach((h) => {
        map[h.episodeNumber] = h;
        if (h.timestamp > lastWatchedTime) {
          lastWatchedTime = h.timestamp;
          lastWatchedEp = h.episodeNumber;
        }
      });

      setHistoryMap(map);

      if (!currentEpisode && lastWatchedEp > 0 && ranges.length > 1) {
        const lastRange = findRangeForEpisode(lastWatchedEp, ranges);
        if (lastRange) {
          setSelectedRangeIndex(lastRange.index);
        }
      }
    };

    loadHistory();

    const handleHistoryUpdate = () => loadHistory();
    window.addEventListener('aniscroll_history_updated', handleHistoryUpdate);
    return () => window.removeEventListener('aniscroll_history_updated', handleHistoryUpdate);
  }, [animeId, currentEpisode, ranges]);

  const currentRange = ranges[selectedRangeIndex] || ranges[0];

  // All sorted loaded episodes array (filtered by active language episode count if applicable)
  const allLoadedEpisodes = useMemo<HoshikaEpisodeItem[]>(() => {
    const maxAllowed =
      !isLoadingAvailability &&
      activeType === 'dub' &&
      availability.dub.available &&
      availability.dub.episodeCount > 0
        ? availability.dub.episodeCount
        : Infinity;

    return Array.from(episodesMap.values())
      .filter((ep) => ep.number <= maxAllowed)
      .sort((a, b) => a.number - b.number);
  }, [episodesMap, isLoadingAvailability, activeType, availability.dub]);

  const displayEpisodes = useMemo(() => {
    if (!isLoadingAvailability && !hasAny && episodesMap.size === 0) {
      return [];
    }

    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      return allLoadedEpisodes.filter(
        (ep) =>
          ep.number.toString().includes(q) ||
          (ep.title && ep.title.toLowerCase().includes(q))
      );
    }

    if (!currentRange) return allLoadedEpisodes;

    const maxAllowed =
      !isLoadingAvailability &&
      activeType === 'dub' &&
      availability.dub.available &&
      availability.dub.episodeCount > 0
        ? availability.dub.episodeCount
        : currentRange.end;

    const endBound = Math.min(currentRange.end, maxAllowed);
    const rangeItems: HoshikaEpisodeItem[] = [];
    for (let n = currentRange.start; n <= endBound; n++) {
      const item = episodesMap.get(n);
      if (item) {
        rangeItems.push(item);
      }
    }
    return rangeItems;
  }, [
    allLoadedEpisodes,
    episodesMap,
    filterQuery,
    currentRange,
    isLoadingAvailability,
    hasAny,
    activeType,
    availability.dub,
  ]);

  return (
    <div className={`space-y-4 ${className}`} data-testid="episode-section">
      {/* Episodes Header Strip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#292929]">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg md:text-xl font-bold text-white tracking-wide">
            Episodes
          </h2>
          <span className="text-xs text-[#A0A0A0] font-mono bg-[#141414] px-2.5 py-0.5 rounded-lg border border-[#292929]">
            {computedTotalEpisodes} Episodes
          </span>
          {(isLoadingBatch || retryStatusText) && (
            <div className="flex items-center gap-1.5 text-xs text-[#A0A0A0] font-mono animate-pulse">
              <Loader2 size={13} className="animate-spin text-white" />
              <span>{retryStatusText || 'Loading batch...'}</span>
            </div>
          )}
        </div>

        {/* Controls: Dynamic Sub/Dub, Range Selector and Search Filter */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {/* Dynamic Sub / Dub Selector based on actual availability */}
          {showSubDubToggle && (
            <div
              data-testid="sub-dub-controls"
              data-availability-status={
                isLoadingAvailability
                  ? 'loading'
                  : hasSub && hasDub
                  ? 'both'
                  : hasSub
                  ? 'sub-only'
                  : hasDub
                  ? 'dub-only'
                  : 'unavailable'
              }
              className="flex items-center bg-[#0A0A0A] p-0.5 rounded-xl border border-[#303030]"
            >
              {isLoadingAvailability ? (
                <div
                  data-testid="sub-dub-loading"
                  className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-mono text-[#A0A0A0]"
                >
                  <Loader2 size={12} className="animate-spin text-white" />
                  <span>Audio...</span>
                </div>
              ) : (
                <>
                  {hasSub && (
                    <button
                      type="button"
                      data-testid="lang-btn-sub"
                      onClick={() => handleSelectLanguage('sub')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                        activeType === 'sub'
                          ? 'bg-white text-black shadow-sm'
                          : 'text-[#A0A0A0] hover:text-white'
                      }`}
                    >
                      SUB
                    </button>
                  )}
                  {hasDub && (
                    <button
                      type="button"
                      data-testid="lang-btn-dub"
                      onClick={() => handleSelectLanguage('dub')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                        activeType === 'dub'
                          ? 'bg-white text-black shadow-sm'
                          : 'text-[#A0A0A0] hover:text-white'
                      }`}
                    >
                      DUB
                    </button>
                  )}
                  {!hasSub && !hasDub && (
                    <span
                      data-testid="sub-dub-unavailable"
                      className="px-3 py-1 text-[11px] font-mono text-[#707070] uppercase"
                    >
                      Unavailable
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {/* Episode Range Dropdown Selector (visible if > 50 episodes) */}
          {ranges.length > 1 && !filterQuery.trim() && (
            <EpisodeRangeSelector
              ranges={ranges}
              selectedRangeIndex={selectedRangeIndex}
              onSelectRange={(idx) => {
                setSelectedRangeIndex(idx);
                const targetRange = ranges[idx];
                if (targetRange) {
                  loadRangeEpisodes(targetRange, activeType);
                }
              }}
            />
          )}

          {/* Search / Filter Input */}
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#707070]"
            />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter episode..."
              className="h-9 pl-8 pr-3 text-xs bg-[#0A0A0A] text-white placeholder-[#707070] rounded-xl border border-[#303030] focus:outline-none focus:border-white transition-colors w-32 sm:w-44 font-sans"
            />
          </div>
        </div>
      </div>

      {/* Pagination Status Indicator */}
      <div className="flex items-center justify-between text-xs text-[#707070] px-0.5">
        <span>
          {filterQuery.trim() ? (
            <>
              Showing {displayEpisodes.length} matching episode
              {displayEpisodes.length === 1 ? '' : 's'}
            </>
          ) : currentRange ? (
            <>
              Showing episodes {currentRange.start}–{currentRange.end} of{' '}
              {computedTotalEpisodes}
            </>
          ) : (
            `Showing ${displayEpisodes.length} episodes`
          )}
        </span>

        {ranges.length > 1 && !filterQuery.trim() && (
          <span className="font-mono text-[11px] text-[#A0A0A0]">
            Batch {selectedRangeIndex + 1} of {ranges.length}
          </span>
        )}
      </div>

      {/* Loading Skeleton during batch fetch if range has no episodes yet */}
      {isLoadingBatch && displayEpisodes.length === 0 ? (
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[#292929] bg-[#141414] animate-pulse"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-24 sm:w-28 aspect-video bg-[#202020] rounded-lg shrink-0" />
                <div className="space-y-2 flex-1 min-w-0">
                  <div className="h-3 w-16 bg-[#262626] rounded" />
                  <div className="h-3.5 w-48 bg-[#262626] rounded" />
                  <div className="h-2.5 w-64 bg-[#202020] rounded" />
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-[#202020] shrink-0" />
            </div>
          ))}
        </div>
      ) : batchError && displayEpisodes.length === 0 ? (
        <div
          data-testid="episode-retry-state"
          className="py-12 px-6 text-center rounded-xl border border-[#292929] bg-[#0F0F0F] space-y-3"
        >
          <AlertCircle size={28} className="mx-auto text-[#A0A0A0]" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-white">
              Episodes Temporarily Unavailable
            </p>
            <p className="text-xs text-[#707070] max-w-md mx-auto">
              {batchError}
            </p>
          </div>
          <button
            type="button"
            data-testid="episode-manual-retry-btn"
            onClick={handleManualRetry}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors cursor-pointer"
          >
            <RefreshCw size={13} />
            <span>Retry Loading Episodes</span>
          </button>
        </div>
      ) : (
        /* Vertical Episode List */
        <EpisodeList
          animeId={animeId}
          episodes={displayEpisodes}
          currentEpisode={currentEpisode}
          historyMap={historyMap}
        />
      )}
    </div>
  );
}
