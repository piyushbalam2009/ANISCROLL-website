'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { AnimeGrid } from '@/components/anime/AnimeGrid';
import { HoshikaAnimeItem } from '@/types/anime';
import { deduplicateAnimeList, parseGenresParam } from '@/lib/explore-catalog';
import {
  Search,
  RotateCcw,
  ChevronDown,
  X,
  AlertCircle,
  Loader2,
  Check,
  SlidersHorizontal,
} from 'lucide-react';

interface ExploreCatalogProps {
  initialItems: HoshikaAnimeItem[];
  initialTotal?: number;
  initialHasMore?: boolean;
  initialPages?: number;
  genres: string[];
}

interface CachedCatalogPage {
  items: HoshikaAnimeItem[];
  total: number;
  page: number;
  pages: number;
  hasMore: boolean;
}

const FORMATS = ['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'TV_SHORT', 'MUSIC'];

const STATUSES = [
  { label: 'Completed', value: 'FINISHED' },
  { label: 'Currently Airing', value: 'RELEASING' },
  { label: 'Not Yet Aired', value: 'NOT_YET_RELEASED' },
];

const SORT_OPTIONS = [
  { label: 'Top Rated (Score)', value: 'top' },
  { label: 'Popularity', value: 'popular' },
  { label: 'Trending', value: 'trending' },
  { label: 'Recently Updated', value: 'recent' },
  { label: 'Newest Releases', value: 'newest' },
  { label: 'Title (A–Z)', value: 'title' },
];

const YEARS = Array.from({ length: 47 }, (_, i) => String(2026 - i)); // 2026 down to 1980

export function ExploreCatalog({
  initialItems,
  initialTotal = initialItems.length,
  initialHasMore = true,
  initialPages = Math.max(1, Math.ceil((initialTotal || initialItems.length) / 24)),
  genres,
}: ExploreCatalogProps) {
  const searchParams = useSearchParams();

  // Initialize filter states from URL search params
  const [selectedGenres, setSelectedGenres] = useState<string[]>(() =>
    parseGenresParam(searchParams.getAll('genre'))
  );
  const [selectedFormat, setSelectedFormat] = useState<string>(
    () => searchParams.get('format') || ''
  );
  const [selectedStatus, setSelectedStatus] = useState<string>(
    () => searchParams.get('status') || ''
  );
  const [selectedYear, setSelectedYear] = useState<string>(
    () => searchParams.get('year') || ''
  );
  const [selectedSort, setSelectedSort] = useState<string>(
    () => searchParams.get('sort') || 'top'
  );
  const [searchInput, setSearchInput] = useState<string>(
    () => searchParams.get('q') || ''
  );
  const [appliedQuery, setAppliedQuery] = useState<string>(
    () => searchParams.get('q') || ''
  );
  const [showGenreSelector, setShowGenreSelector] = useState<boolean>(false);

  // Catalogue items & pagination state
  const [items, setItems] = useState<HoshikaAnimeItem[]>(initialItems);
  const [total, setTotal] = useState<number>(initialTotal);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(initialPages);
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore);

  // Loading & error states
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for aborting stale requests, preventing duplicate page loads, and caching responses
  const abortControllerRef = useRef<AbortController | null>(null);
  const loadedPagesRef = useRef<Set<number>>(new Set([1]));
  const isFetchingPageRef = useRef<boolean>(false);
  const clientCacheRef = useRef<Map<string, CachedCatalogPage>>(new Map());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const isFirstMountRef = useRef<boolean>(true);

  const selectedGenresKey = selectedGenres.join(',');

  // Sync URL query parameter changes when navigating from external links (e.g. /genres/[genre] -> Filter in Explore)
  useEffect(() => {
    const urlGenres = parseGenresParam(searchParams.getAll('genre'));
    const urlFormat = searchParams.get('format') || '';
    const urlStatus = searchParams.get('status') || '';
    const urlYear = searchParams.get('year') || '';
    const urlSort = searchParams.get('sort') || 'top';
    const urlQ = searchParams.get('q') || '';

    setSelectedGenres((prev) =>
      prev.join(',') === urlGenres.join(',') ? prev : urlGenres
    );
    setSelectedFormat((prev) => (prev === urlFormat ? prev : urlFormat));
    setSelectedStatus((prev) => (prev === urlStatus ? prev : urlStatus));
    setSelectedYear((prev) => (prev === urlYear ? prev : urlYear));
    setSelectedSort((prev) => (prev === urlSort ? prev : urlSort));
    setSearchInput((prev) => (prev === urlQ ? prev : urlQ));
    setAppliedQuery((prev) => (prev === urlQ ? prev : urlQ));
  }, [searchParams]);

  // Debounce live search input so typing updates appliedQuery smoothly
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedQuery(searchInput.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const buildFilterQueryString = useCallback(
    (targetPage: number) => {
      const params = new URLSearchParams();
      if (appliedQuery.trim()) params.set('q', appliedQuery.trim());
      if (selectedGenresKey) params.set('genre', selectedGenresKey);
      if (selectedFormat) params.set('format', selectedFormat);
      if (selectedStatus) params.set('status', selectedStatus);
      if (selectedYear) params.set('year', selectedYear);
      if (selectedSort) params.set('sort', selectedSort);
      if (targetPage > 1) params.set('page', String(targetPage));
      return params.toString();
    },
    [
      appliedQuery,
      selectedGenresKey,
      selectedFormat,
      selectedStatus,
      selectedYear,
      selectedSort,
    ]
  );

  // Core paginated fetch function
  const fetchCatalogPage = useCallback(
    async (targetPage: number, mode: 'reset' | 'append') => {
      // Avoid loading the same page multiple times when appending
      if (mode === 'append') {
        if (isFetchingPageRef.current || loadedPagesRef.current.has(targetPage)) {
          return;
        }
      }

      // Cancel any in-flight request when filters reset
      if (mode === 'reset' && abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      isFetchingPageRef.current = true;

      if (mode === 'reset') {
        setIsLoading(true);
        setIsLoadingMore(false);
        setError(null);
      } else {
        setIsLoadingMore(true);
        setError(null);
      }

      const queryString = buildFilterQueryString(targetPage);

      try {
        // Check client-side cache first
        let pageData = clientCacheRef.current.get(queryString);

        if (!pageData) {
          const res = await fetch(`/api/catalog?${queryString}`, {
            signal: controller.signal,
          });
          if (!res.ok) {
            throw new Error(`Catalogue request failed (${res.status})`);
          }
          const json = await res.json();
          if (controller.signal.aborted) return;

          if (!json || json.ok === false) {
            throw new Error(json?.error || 'Failed to load anime catalogue');
          }

          pageData = {
            items: Array.isArray(json.items) ? json.items : [],
            total: typeof json.total === 'number' ? json.total : 0,
            page: typeof json.page === 'number' ? json.page : targetPage,
            pages: typeof json.pages === 'number' ? json.pages : 1,
            hasMore: Boolean(json.hasMore),
          };
          clientCacheRef.current.set(queryString, pageData);
        }

        if (controller.signal.aborted) return;

        const resolvedPage = pageData.page || targetPage;

        if (mode === 'reset') {
          loadedPagesRef.current = new Set([1, resolvedPage]);
          const deduped = deduplicateAnimeList([], pageData.items);
          setItems(deduped);
        } else {
          loadedPagesRef.current.add(targetPage);
          loadedPagesRef.current.add(resolvedPage);
          setItems((prev) => deduplicateAnimeList(prev, pageData!.items));
        }

        setTotal(pageData.total);
        setPage(resolvedPage);
        setTotalPages(pageData.pages);
        setHasMore(pageData.hasMore && pageData.items.length > 0);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('[ExploreCatalog] Fetch error:', err);
        setError(err?.message || 'Unable to load anime catalogue. Please try again.');
      } finally {
        if (abortControllerRef.current === controller) {
          setIsLoading(false);
          setIsLoadingMore(false);
          isFetchingPageRef.current = false;
        }
      }
    },
    [buildFilterQueryString]
  );

  // Trigger page-1 fetch whenever any filter or sort changes
  useEffect(() => {
    const isDefaultUnfiltered =
      !appliedQuery &&
      !selectedGenresKey &&
      !selectedFormat &&
      !selectedStatus &&
      !selectedYear &&
      selectedSort === 'top';

    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      if (isDefaultUnfiltered && initialItems.length > 0) {
        // Seed client cache with initial SSR page 1
        clientCacheRef.current.set('sort=top', {
          items: initialItems,
          total: initialTotal,
          page: 1,
          pages: initialPages,
          hasMore: initialHasMore,
        });
        return;
      }
    }

    fetchCatalogPage(1, 'reset');
  }, [
    appliedQuery,
    selectedGenresKey,
    selectedFormat,
    selectedStatus,
    selectedYear,
    selectedSort,
    fetchCatalogPage,
    initialItems,
    initialTotal,
    initialPages,
    initialHasMore,
  ]);

  // Handler to load next page
  const handleLoadMore = useCallback(() => {
    if (isLoading || isLoadingMore || !hasMore || isFetchingPageRef.current) {
      return;
    }
    const nextPage = page + 1;
    fetchCatalogPage(nextPage, 'append');
  }, [isLoading, isLoadingMore, hasMore, page, fetchCatalogPage]);

  // IntersectionObserver for smooth automatic infinite scrolling as user nears the bottom
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || isLoading || isLoadingMore || error) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        // Only auto-trigger infinite scroll after the user has scrolled down into the grid
        if (
          first?.isIntersecting &&
          !isFetchingPageRef.current &&
          typeof window !== 'undefined' &&
          window.scrollY > 150
        ) {
          handleLoadMore();
        }
      },
      { rootMargin: '250px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isLoading, isLoadingMore, error, handleLoadMore]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchInput.trim();
    if (trimmed !== appliedQuery) {
      setAppliedQuery(trimmed);
    } else {
      fetchCatalogPage(1, 'reset');
    }
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) => {
      const exists = prev.some((g) => g.toLowerCase() === genre.toLowerCase());
      if (exists) {
        return prev.filter((g) => g.toLowerCase() !== genre.toLowerCase());
      }
      return [...prev, genre];
    });
  };

  const handleSingleGenreSelect = (val: string) => {
    if (!val) {
      setSelectedGenres([]);
    } else {
      setSelectedGenres((prev) => {
        const exists = prev.some((g) => g.toLowerCase() === val.toLowerCase());
        if (exists && prev.length === 1) return prev;
        if (exists) return prev;
        return [...prev, val];
      });
    }
  };

  const handleResetFilters = () => {
    setSelectedGenres([]);
    setSelectedFormat('');
    setSelectedStatus('');
    setSelectedYear('');
    setSelectedSort('top');
    setSearchInput('');
    setAppliedQuery('');
    setError(null);
  };

  const hasActiveFilters =
    selectedGenres.length > 0 ||
    Boolean(selectedFormat) ||
    Boolean(selectedStatus) ||
    Boolean(selectedYear) ||
    Boolean(searchInput.trim()) ||
    Boolean(appliedQuery.trim()) ||
    selectedSort !== 'top';

  return (
    <div className="space-y-6">
      {/* Filters Toolbar */}
      <div className="p-4 md:p-6 bg-[#0A0A0A] border border-[#292929] rounded-2xl space-y-4">
        {/* Search bar inside toolbar */}
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#707070]"
            />
            <input
              type="text"
              aria-label="Filter anime titles"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search across full anime catalogue..."
              className="w-full h-10 pl-10 pr-9 bg-[#141414] text-white placeholder-[#707070] text-sm rounded-xl border border-[#292929] focus:outline-none focus:border-white transition-colors"
            />
            {searchInput && (
              <button
                type="button"
                aria-label="Clear search query"
                onClick={() => {
                  setSearchInput('');
                  setAppliedQuery('');
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#707070] hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-5 h-10 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors cursor-pointer"
          >
            Apply
          </button>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              aria-label="Reset all filters"
              className="px-3 h-10 rounded-xl border border-[#292929] text-[#A0A0A0] hover:text-white hover:border-[#404040] transition-colors flex items-center gap-1.5 text-xs cursor-pointer"
              title="Reset all filters"
            >
              <RotateCcw size={15} />
              <span className="hidden sm:inline">Reset</span>
            </button>
          )}
        </form>

        {/* Filter Dropdowns Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
          {/* Genre Dropdown (Quick Add / Select) */}
          <div>
            <label
              htmlFor="explore-genre-select"
              className="block text-[#707070] font-medium mb-1 uppercase tracking-wider text-[10px]"
            >
              Genre {selectedGenres.length > 0 ? `(${selectedGenres.length})` : ''}
            </label>
            <select
              id="explore-genre-select"
              aria-label="Genre"
              value={selectedGenres.length === 1 ? selectedGenres[0] : ''}
              onChange={(e) => handleSingleGenreSelect(e.target.value)}
              className="w-full h-9 px-3 bg-[#141414] text-white border border-[#292929] rounded-lg focus:outline-none focus:border-white cursor-pointer"
            >
              <option value="">
                {selectedGenres.length > 1
                  ? `${selectedGenres.length} Genres Selected`
                  : 'All Genres'}
              </option>
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          {/* Format */}
          <div>
            <label
              htmlFor="explore-format-select"
              className="block text-[#707070] font-medium mb-1 uppercase tracking-wider text-[10px]"
            >
              Format
            </label>
            <select
              id="explore-format-select"
              aria-label="Format"
              value={selectedFormat}
              onChange={(e) => setSelectedFormat(e.target.value)}
              className="w-full h-9 px-3 bg-[#141414] text-white border border-[#292929] rounded-lg focus:outline-none focus:border-white cursor-pointer"
            >
              <option value="">All Formats</option>
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Year */}
          <div>
            <label
              htmlFor="explore-year-select"
              className="block text-[#707070] font-medium mb-1 uppercase tracking-wider text-[10px]"
            >
              Year
            </label>
            <select
              id="explore-year-select"
              aria-label="Year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="w-full h-9 px-3 bg-[#141414] text-white border border-[#292929] rounded-lg focus:outline-none focus:border-white cursor-pointer"
            >
              <option value="">All Years</option>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label
              htmlFor="explore-status-select"
              className="block text-[#707070] font-medium mb-1 uppercase tracking-wider text-[10px]"
            >
              Status
            </label>
            <select
              id="explore-status-select"
              aria-label="Status"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full h-9 px-3 bg-[#141414] text-white border border-[#292929] rounded-lg focus:outline-none focus:border-white cursor-pointer"
            >
              <option value="">All Statuses</option>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Sort */}
          <div className="col-span-2 sm:col-span-1">
            <label
              htmlFor="explore-sort-select"
              className="block text-[#707070] font-medium mb-1 uppercase tracking-wider text-[10px]"
            >
              Sort By
            </label>
            <select
              id="explore-sort-select"
              aria-label="Sort By"
              value={selectedSort}
              onChange={(e) => setSelectedSort(e.target.value)}
              className="w-full h-9 px-3 bg-[#141414] text-white border border-[#292929] rounded-lg focus:outline-none focus:border-white cursor-pointer"
            >
              {SORT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Multi-Genre Toggle & Active Filter Bar */}
        <div className="pt-2 border-t border-[#292929]/70 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowGenreSelector((prev) => !prev)}
              aria-expanded={showGenreSelector}
              className={`h-7 px-2.5 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                showGenreSelector || selectedGenres.length > 0
                  ? 'bg-[#1B1B1B] border-white/60 text-white'
                  : 'bg-[#141414] border-[#292929] text-[#A0A0A0] hover:text-white'
              }`}
            >
              <SlidersHorizontal size={12} />
              <span>Multi-Genre Filter</span>
              <ChevronDown
                size={12}
                className={`transition-transform ${showGenreSelector ? 'rotate-180' : ''}`}
              />
            </button>

            {/* Active Genre Chips */}
            {selectedGenres.map((genre) => (
              <button
                key={genre}
                type="button"
                onClick={() => toggleGenre(genre)}
                aria-label={`Remove genre ${genre}`}
                className="h-7 px-2.5 rounded-lg bg-white text-black text-[11px] font-semibold flex items-center gap-1.5 hover:bg-neutral-200 transition-colors cursor-pointer"
              >
                <span>{genre}</span>
                <X size={11} />
              </button>
            ))}

            {selectedFormat && (
              <button
                type="button"
                onClick={() => setSelectedFormat('')}
                aria-label={`Remove format ${selectedFormat}`}
                className="h-7 px-2.5 rounded-lg bg-[#1B1B1B] border border-[#404040] text-white text-[11px] flex items-center gap-1.5 hover:border-white transition-colors cursor-pointer"
              >
                <span>Format: {selectedFormat.replace('_', ' ')}</span>
                <X size={11} />
              </button>
            )}

            {selectedYear && (
              <button
                type="button"
                onClick={() => setSelectedYear('')}
                aria-label={`Remove year ${selectedYear}`}
                className="h-7 px-2.5 rounded-lg bg-[#1B1B1B] border border-[#404040] text-white text-[11px] flex items-center gap-1.5 hover:border-white transition-colors cursor-pointer"
              >
                <span>Year: {selectedYear}</span>
                <X size={11} />
              </button>
            )}

            {selectedStatus && (
              <button
                type="button"
                onClick={() => setSelectedStatus('')}
                aria-label={`Remove status ${selectedStatus}`}
                className="h-7 px-2.5 rounded-lg bg-[#1B1B1B] border border-[#404040] text-white text-[11px] flex items-center gap-1.5 hover:border-white transition-colors cursor-pointer"
              >
                <span>
                  Status:{' '}
                  {STATUSES.find((s) => s.value === selectedStatus)?.label ||
                    selectedStatus}
                </span>
                <X size={11} />
              </button>
            )}
          </div>

          {selectedGenres.length > 1 && (
            <span className="text-[11px] text-[#707070]">
              Matching all {selectedGenres.length} selected genres
            </span>
          )}
        </div>

        {/* Expandable Multi-Genre Selection Grid */}
        {showGenreSelector && (
          <div
            data-testid="multi-genre-grid"
            className="pt-3 border-t border-[#292929]/70 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-1.5"
          >
            {genres.map((genre) => {
              const isSelected = selectedGenres.some(
                (g) => g.toLowerCase() === genre.toLowerCase()
              );
              return (
                <button
                  key={genre}
                  type="button"
                  onClick={() => toggleGenre(genre)}
                  aria-pressed={isSelected}
                  className={`h-8 px-2.5 rounded-lg border text-left text-[11px] font-medium flex items-center justify-between transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-white text-black border-white font-semibold'
                      : 'bg-[#141414] text-[#A0A0A0] border-[#292929] hover:text-white hover:border-[#404040]'
                  }`}
                >
                  <span className="truncate">{genre}</span>
                  {isSelected && <Check size={12} className="shrink-0 ml-1" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Results Header */}
      <div
        data-testid="explore-results-summary"
        className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#A0A0A0] px-1"
      >
        <div className="flex items-center gap-2">
          <span>
            Showing <strong className="text-white font-semibold">{items.length}</strong>
            {total > items.length ? (
              <>
                {' '}
                of{' '}
                <strong className="text-white font-semibold">
                  {total >= 1000 ? '1,000+' : total.toLocaleString()}
                </strong>
              </>
            ) : null}{' '}
            titles
          </span>
          {totalPages > 1 && (
            <span className="text-[#707070]">
              · Page {page} of {totalPages}
            </span>
          )}
        </div>
        {(isLoading || isLoadingMore) && (
          <span className="text-white flex items-center gap-1.5">
            <Loader2 size={13} className="animate-spin" />
            <span>{isLoading ? 'Searching catalogue...' : 'Loading more titles...'}</span>
          </span>
        )}
      </div>

      {/* API Error State */}
      {error && (
        <div
          role="alert"
          className="p-6 bg-[#0A0A0A] border border-[#292929] rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 text-left">
            <AlertCircle size={20} className="text-white shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-white">
                Failed to Load Catalogue Results
              </h3>
              <p className="text-xs text-[#A0A0A0] mt-0.5">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              fetchCatalogPage(items.length === 0 ? 1 : page + 1, items.length === 0 ? 'reset' : 'append')
            }
            className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors shrink-0 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Anime Grid */}
      <AnimeGrid
        animeList={items}
        isLoading={isLoading}
        count={24}
        emptyMessage="No anime in the catalogue match the selected filters."
      />

      {/* Pagination & Infinite Scroll Footer */}
      {!isLoading && items.length > 0 && (
        <div className="pt-4 flex flex-col items-center justify-center gap-3">
          {/* Invisible sentinel for automatic infinite scrolling */}
          <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />

          {hasMore ? (
            <button
              type="button"
              data-testid="explore-load-more"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              className="px-6 py-2.5 rounded-xl bg-[#141414] hover:bg-[#1B1B1B] text-white border border-[#292929] hover:border-white text-xs font-semibold transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {isLoadingMore ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Loading Page {page + 1}...</span>
                </>
              ) : (
                <span>
                  Load More Anime ({items.length} /{' '}
                  {total >= 1000 ? '1,000+' : total})
                </span>
              )}
            </button>
          ) : (
            <div
              data-testid="explore-end-of-results"
              className="text-xs text-[#707070] py-2"
            >
              End of catalogue results · Showing all {items.length} matching titles
            </div>
          )}
        </div>
      )}
    </div>
  );
}
