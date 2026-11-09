'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { HoshikaEpisodeItem } from '@/types/anime';
import { WatchHistoryEntry } from '@/types/streaming';
import { getWatchHistory, getUserPreferences } from '@/lib/storage';
import {
  generateEpisodeRanges,
  findRangeForEpisode,
  sliceEpisodesForRange,
  EpisodeRange,
} from '@/lib/episode-pagination';
import {
  cacheEpisodes,
  getCachedEpisodes,
  fetchEpisodeBatch,
  isRangeCached,
} from '@/lib/episode-store';
import { EpisodeRangeSelector } from './EpisodeRangeSelector';
import { EpisodeList } from './EpisodeList';

interface EpisodeSectionProps {
  animeId: string | number;
  episodes: HoshikaEpisodeItem[];
  totalEpisodes?: number;
  currentEpisode?: number;
  activeType?: 'sub' | 'dub';
  onChangeType?: (type: 'sub' | 'dub') => void;
  showSubDubToggle?: boolean;
  className?: string;
  onEpisodesLoaded?: (episodes: HoshikaEpisodeItem[]) => void;
}

export function EpisodeSection({
  animeId,
  episodes: initialEpisodes,
  totalEpisodes,
  currentEpisode,
  activeType: externalActiveType,
  onChangeType: externalOnChangeType,
  showSubDubToggle = true,
  className = '',
  onEpisodesLoaded,
}: EpisodeSectionProps) {
  // Local sub/dub state if not controlled externally
  const [localActiveType, setLocalActiveType] = useState<'sub' | 'dub'>('sub');
  const activeType = externalActiveType ?? localActiveType;
  const onChangeType = externalOnChangeType ?? setLocalActiveType;

  // Search filter
  const [filterQuery, setFilterQuery] = useState('');

  // Watch history map: { [episodeNumber]: WatchHistoryEntry }
  const [historyMap, setHistoryMap] = useState<Record<number, WatchHistoryEntry>>({});

  // Loading state for fetching a paginated episode batch
  const [isLoadingBatch, setIsLoadingBatch] = useState(false);

  // Loaded real episodes map: Map<episodeNumber, HoshikaEpisodeItem>
  const [episodesMap, setEpisodesMap] = useState<Map<number, HoshikaEpisodeItem>>(() => {
    const map = new Map<number, HoshikaEpisodeItem>();
    // First seed with client module-level cache
    const cached = getCachedEpisodes(animeId);
    for (const ep of cached) {
      if (ep && typeof ep.number === 'number') {
        map.set(ep.number, ep);
      }
    }
    // Then seed with initial props episodes
    if (initialEpisodes && initialEpisodes.length > 0) {
      cacheEpisodes(animeId, initialEpisodes);
      for (const ep of initialEpisodes) {
        if (ep && typeof ep.number === 'number') {
          map.set(ep.number, ep);
        }
      }
    }
    return map;
  });

  // Sync initialEpisodes into episodesMap whenever initialEpisodes prop updates
  useEffect(() => {
    if (initialEpisodes && initialEpisodes.length > 0) {
      cacheEpisodes(animeId, initialEpisodes);
      setEpisodesMap((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const ep of initialEpisodes) {
          if (ep && typeof ep.number === 'number' && !next.has(ep.number)) {
            next.set(ep.number, ep);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [animeId, initialEpisodes]);

  // Compute total episode count: prioritize explicit totalEpisodes, then max episode number found, fallback to 12
  const computedTotalEpisodes = useMemo(() => {
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
  }, [totalEpisodes, episodesMap, initialEpisodes]);

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

  // Fetch episode batch dynamically if current range is missing from episodesMap
  const loadRangeEpisodes = useCallback(
    async (range: EpisodeRange) => {
      if (!range) return;

      // Check if range is already populated in episodesMap
      let missingCount = 0;
      for (let n = range.start; n <= range.end; n++) {
        if (!episodesMap.has(n)) {
          missingCount++;
        }
      }

      if (missingCount === 0) {
        return; // Fully cached in state
      }

      // Check if already in module-level cache
      if (isRangeCached(animeId, range.start, range.end)) {
        const cached = getCachedEpisodes(animeId);
        setEpisodesMap((prev) => {
          const next = new Map(prev);
          for (const ep of cached) {
            if (ep && typeof ep.number === 'number') {
              next.set(ep.number, ep);
            }
          }
          return next;
        });
        return;
      }

      // Determine 'after' parameter for Hoshika API:
      // For range index 0 (001-050): after = undefined
      // For range index > 0: find the last episode number of previous batch or range.start - 1
      const afterParam = range.start > 1 ? range.start - 1 : undefined;

      setIsLoadingBatch(true);
      try {
        const fetchedItems = await fetchEpisodeBatch(animeId, afterParam, 50);
        if (fetchedItems && fetchedItems.length > 0) {
          setEpisodesMap((prev) => {
            const next = new Map(prev);
            for (const ep of fetchedItems) {
              if (ep && typeof ep.number === 'number') {
                next.set(ep.number, ep);
              }
            }
            return next;
          });
          if (onEpisodesLoaded) {
            onEpisodesLoaded(fetchedItems);
          }
        }
      } catch (err) {
        console.error('Failed to load episode range:', err);
      } finally {
        setIsLoadingBatch(false);
      }
    },
    [animeId, episodesMap, onEpisodesLoaded]
  );

  // Trigger episode fetch when selectedRangeIndex changes
  useEffect(() => {
    const range = ranges[selectedRangeIndex];
    if (range) {
      loadRangeEpisodes(range);
    }
  }, [selectedRangeIndex, ranges, loadRangeEpisodes]);

  // Load user watch history and default audio preferences
  useEffect(() => {
    const prefs = getUserPreferences();
    if (prefs.defaultAudio && !externalActiveType) {
      setLocalActiveType(prefs.defaultAudio);
    }

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

      // On details page (no currentEpisode specified), auto-select range containing last watched episode
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
  }, [animeId, currentEpisode, ranges, externalActiveType]);

  const currentRange = ranges[selectedRangeIndex] || ranges[0];

  // All sorted loaded episodes array
  const allLoadedEpisodes = useMemo<HoshikaEpisodeItem[]>(() => {
    return Array.from(episodesMap.values()).sort((a, b) => a.number - b.number);
  }, [episodesMap]);

  // Episodes to display:
  // If search query is active, filter all loaded episodes
  // Otherwise, display episodes belonging to currentRange
  const displayEpisodes = useMemo(() => {
    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      return allLoadedEpisodes.filter(
        (ep) =>
          ep.number.toString().includes(q) ||
          (ep.title && ep.title.toLowerCase().includes(q))
      );
    }

    if (!currentRange) return allLoadedEpisodes;

    // Filter loaded episodes that fall within currentRange
    const rangeItems: HoshikaEpisodeItem[] = [];
    for (let n = currentRange.start; n <= currentRange.end; n++) {
      const item = episodesMap.get(n);
      if (item) {
        rangeItems.push(item);
      }
    }
    return rangeItems;
  }, [allLoadedEpisodes, episodesMap, filterQuery, currentRange]);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Episodes Header Strip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#292929]">
        <div className="flex items-center gap-3">
          <h2 className="text-lg md:text-xl font-bold text-white tracking-wide">
            Episodes
          </h2>
          <span className="text-xs text-[#A0A0A0] font-mono bg-[#141414] px-2.5 py-0.5 rounded-lg border border-[#292929]">
            {computedTotalEpisodes} Episodes
          </span>
          {isLoadingBatch && (
            <div className="flex items-center gap-1.5 text-xs text-[#A0A0A0] font-mono animate-pulse">
              <Loader2 size={13} className="animate-spin text-white" />
              <span>Loading batch...</span>
            </div>
          )}
        </div>

        {/* Controls: Sub/Dub, Range Selector and Search Filter */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {/* Sub / Dub Selector */}
          {showSubDubToggle && (
            <div className="flex items-center bg-[#0A0A0A] p-0.5 rounded-xl border border-[#303030]">
              <button
                type="button"
                onClick={() => onChangeType('sub')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                  activeType === 'sub'
                    ? 'bg-white text-black shadow-sm'
                    : 'text-[#A0A0A0] hover:text-white'
                }`}
              >
                SUB
              </button>
              <button
                type="button"
                onClick={() => onChangeType('dub')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                  activeType === 'dub'
                    ? 'bg-white text-black shadow-sm'
                    : 'text-[#A0A0A0] hover:text-white'
                }`}
              >
                DUB
              </button>
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
                  loadRangeEpisodes(targetRange);
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
