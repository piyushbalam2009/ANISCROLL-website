'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { AnimeGrid } from '@/components/anime/AnimeGrid';
import { Pagination } from '@/components/ui/Pagination';
import { HoshikaAnimeItem } from '@/types/anime';
import {
  DEFAULT_PER_PAGE,
  StandardPaginatedResponse,
  deduplicateAnimeList,
  parseGenresParam,
  sanitizePageNumber,
} from '@/lib/explore-catalog';
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
  initialData: StandardPaginatedResponse<HoshikaAnimeItem>;
  genres: string[];
}

const FORMATS = ['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'TV_SHORT', 'MUSIC'];

const SEASONS = [
  { label: 'Winter', value: 'WINTER' },
  { label: 'Spring', value: 'SPRING' },
  { label: 'Summer', value: 'SUMMER' },
  { label: 'Fall', value: 'FALL' },
];

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

export function ExploreCatalog({ initialData, genres }: ExploreCatalogProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialize filter and page states from URL search params
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
  const [selectedSeason, setSelectedSeason] = useState<string>(
    () => searchParams.get('season') || ''
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
  const [currentPage, setCurrentPage] = useState<number>(() =>
    sanitizePageNumber(searchParams.get('page') || initialData.currentPage)
  );
  const [showGenreSelector, setShowGenreSelector] = useState<boolean>(false);

  // Catalogue items & pagination state
  const [items, setItems] = useState<HoshikaAnimeItem[]>(
    initialData.results || initialData.items || []
  );
  const [total, setTotal] = useState<number>(initialData.total || 0);
  const [totalPages, setTotalPages] = useState<number | null>(
    initialData.totalPages ?? initialData.pages ?? 1
  );
  const [hasNextPage, setHasNextPage] = useState<boolean>(
    Boolean(initialData.hasNextPage ?? initialData.hasMore)
  );
  const [hasPreviousPage, setHasPreviousPage] = useState<boolean>(
    Boolean(initialData.hasPreviousPage ?? currentPage > 1)
  );

  // Loading & error states
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for aborting stale requests and caching responses
  const abortControllerRef = useRef<AbortController | null>(null);
  const clientCacheRef = useRef<
    Map<string, StandardPaginatedResponse<HoshikaAnimeItem>>
  >(new Map());
  const isFirstMountRef = useRef<boolean>(true);
  const lastFetchedQueryKeyRef = useRef<string>('');
  const lastErroredQueryKeyRef = useRef<string>('');
  const errorRef = useRef<string | null>(null);

  const selectedGenresKey = selectedGenres.join(',');

  // Build canonical query string for both `/api/catalog` and URL query parameters
  const buildQueryParams = useCallback(
    (
      overrides?: Partial<{
        q: string;
        genresKey: string;
        format: string;
        status: string;
        year: string;
        season: string;
        sort: string;
        page: number;
      }>
    ) => {
      const q = overrides?.q !== undefined ? overrides.q : appliedQuery;
      const gKey =
        overrides?.genresKey !== undefined
          ? overrides.genresKey
          : selectedGenresKey;
      const fmt =
        overrides?.format !== undefined ? overrides.format : selectedFormat;
      const st =
        overrides?.status !== undefined ? overrides.status : selectedStatus;
      const yr = overrides?.year !== undefined ? overrides.year : selectedYear;
      const ssn =
        overrides?.season !== undefined ? overrides.season : selectedSeason;
      const srt =
        overrides?.sort !== undefined ? overrides.sort : selectedSort;
      const pg = sanitizePageNumber(
        overrides?.page !== undefined ? overrides.page : currentPage
      );

      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (gKey) params.set('genre', gKey);
      if (fmt) params.set('format', fmt);
      if (st) params.set('status', st);
      if (yr) params.set('year', yr);
      if (ssn) params.set('season', ssn);
      if (srt && srt !== 'top') {
        params.set('sort', srt);
      }
      params.set('page', String(pg));
      return params;
    },
    [
      appliedQuery,
      selectedGenresKey,
      selectedFormat,
      selectedStatus,
      selectedYear,
      selectedSeason,
      selectedSort,
      currentPage,
    ]
  );

  // Sync URL query parameter changes when navigating via browser Back/Forward or external links
  useEffect(() => {
    const urlGenres = parseGenresParam(searchParams.getAll('genre'));
    const urlFormat = searchParams.get('format') || '';
    const urlStatus = searchParams.get('status') || '';
    const urlYear = searchParams.get('year') || '';
    const urlSeason = searchParams.get('season') || '';
    const urlSort = searchParams.get('sort') || 'top';
    const urlQ = searchParams.get('q') || '';
    const urlPage = sanitizePageNumber(searchParams.get('page'));

    setSelectedGenres((prev) =>
      prev.join(',') === urlGenres.join(',') ? prev : urlGenres
    );
    setSelectedFormat((prev) => (prev === urlFormat ? prev : urlFormat));
    setSelectedStatus((prev) => (prev === urlStatus ? prev : urlStatus));
    setSelectedYear((prev) => (prev === urlYear ? prev : urlYear));
    setSelectedSeason((prev) => (prev === urlSeason ? prev : urlSeason));
    setSelectedSort((prev) => (prev === urlSort ? prev : urlSort));
    setSearchInput((prev) => (prev === urlQ ? prev : urlQ));
    setAppliedQuery((prev) => (prev === urlQ ? prev : urlQ));
    setCurrentPage((prev) => (prev === urlPage ? prev : urlPage));
  }, [searchParams]);

  // Debounce live search input so typing updates appliedQuery smoothly and resets to page 1
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === appliedQuery) return;
    const timer = setTimeout(() => {
      setAppliedQuery(trimmed);
      setCurrentPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, appliedQuery]);

  // Push updated filter + page parameters to browser URL without full reload
  const syncUrlParams = useCallback(
    (params: URLSearchParams) => {
      const nextUrlParams = new URLSearchParams(params.toString());
      const queryStr = nextUrlParams.toString();
      const currentStr = searchParams.toString();
      if (queryStr === currentStr) return;

      const targetUrl = queryStr ? `${pathname}?${queryStr}` : pathname;
      router.push(targetUrl, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  // Core paginated fetch function (replaces current page items with the requested 30-item page)
  const fetchCatalogPage = useCallback(
    async (queryParams: URLSearchParams, forceRefresh: boolean = false) => {
      const apiParams = new URLSearchParams(queryParams.toString());
      if (!apiParams.get('sort')) {
        apiParams.set('sort', selectedSort || 'top');
      }
      const queryKey = apiParams.toString();
      const requestedPage = sanitizePageNumber(apiParams.get('page'));

      if (!forceRefresh && lastFetchedQueryKeyRef.current === queryKey && !errorRef.current) {
        return;
      }
      if (!forceRefresh && lastErroredQueryKeyRef.current === queryKey) {
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      if (!forceRefresh && clientCacheRef.current.has(queryKey)) {
        const cached = clientCacheRef.current.get(queryKey)!;
        lastFetchedQueryKeyRef.current = queryKey;
        lastErroredQueryKeyRef.current = '';
        errorRef.current = null;
        setItems(cached.results || cached.items || []);
        setTotal(cached.total);
        setCurrentPage(cached.currentPage);
        setTotalPages(cached.totalPages);
        setHasNextPage(cached.hasNextPage);
        setHasPreviousPage(cached.hasPreviousPage);
        setError(null);
        setIsLoading(false);
        return;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      errorRef.current = null;
      setError(null);

      try {
        const requestUrl = forceRefresh
          ? `/api/catalog?${queryKey}&refresh=true`
          : `/api/catalog?${queryKey}`;
        const res = await fetch(requestUrl, {
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

        const rawList = Array.isArray(json.results)
          ? json.results
          : Array.isArray(json.items)
            ? json.items
            : [];
        const deduped = deduplicateAnimeList([], rawList);

        const pageData: StandardPaginatedResponse<HoshikaAnimeItem> = {
          results: deduped,
          items: deduped,
          currentPage: sanitizePageNumber(
            json.currentPage ?? json.page ?? requestedPage
          ),
          page: sanitizePageNumber(
            json.page ?? json.currentPage ?? requestedPage
          ),
          perPage:
            typeof json.perPage === 'number' ? json.perPage : DEFAULT_PER_PAGE,
          totalPages:
            typeof json.totalPages === 'number'
              ? json.totalPages
              : typeof json.pages === 'number'
                ? json.pages
                : null,
          pages:
            typeof json.pages === 'number'
              ? json.pages
              : typeof json.totalPages === 'number'
                ? json.totalPages
                : 1,
          total: typeof json.total === 'number' ? json.total : deduped.length,
          hasNextPage: Boolean(json.hasNextPage ?? json.hasMore),
          hasMore: Boolean(json.hasMore ?? json.hasNextPage),
          hasPreviousPage:
            typeof json.hasPreviousPage === 'boolean'
              ? json.hasPreviousPage
              : requestedPage > 1,
        };

        clientCacheRef.current.set(queryKey, pageData);
        lastFetchedQueryKeyRef.current = queryKey;
        lastErroredQueryKeyRef.current = '';
        errorRef.current = null;

        setItems(pageData.results);
        setTotal(pageData.total);
        setCurrentPage(pageData.currentPage);
        setTotalPages(pageData.totalPages);
        setHasNextPage(pageData.hasNextPage);
        setHasPreviousPage(pageData.hasPreviousPage);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('[ExploreCatalog] Fetch error:', err);
        const msg =
          err?.message || 'Unable to load anime catalogue. Please try again.';
        lastErroredQueryKeyRef.current = queryKey;
        errorRef.current = msg;
        setError(msg);
      } finally {
        if (abortControllerRef.current === controller) {
          setIsLoading(false);
        }
      }
    },
    [selectedSort]
  );

  // Trigger fetch & URL sync whenever active filters, sort, or page change
  useEffect(() => {
    const queryParams = buildQueryParams();
    const apiParams = new URLSearchParams(queryParams.toString());
    if (!apiParams.get('sort')) {
      apiParams.set('sort', selectedSort || 'top');
    }
    const queryKey = apiParams.toString();

    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      const initialList = initialData.results || initialData.items || [];
      if (initialList.length > 0 && initialData.currentPage === currentPage) {
        clientCacheRef.current.set(queryKey, initialData);
        lastFetchedQueryKeyRef.current = queryKey;
        return;
      }
    }

    syncUrlParams(queryParams);
    fetchCatalogPage(queryParams);
  }, [
    appliedQuery,
    selectedGenresKey,
    selectedFormat,
    selectedStatus,
    selectedYear,
    selectedSeason,
    selectedSort,
    currentPage,
    buildQueryParams,
    syncUrlParams,
    fetchCatalogPage,
    initialData,
  ]);

  const handlePageChange = (nextPage: number) => {
    const safeNext = sanitizePageNumber(nextPage);
    if (safeNext === currentPage && !error) return;
    setCurrentPage(safeNext);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchInput.trim();
    setCurrentPage(1);
    if (trimmed !== appliedQuery) {
      setAppliedQuery(trimmed);
    } else {
      const params = buildQueryParams({ q: trimmed, page: 1 });
      syncUrlParams(params);
      fetchCatalogPage(params, true);
    }
  };

  const toggleGenre = (genre: string) => {
    setCurrentPage(1);
    setSelectedGenres((prev) => {
      const exists = prev.some((g) => g.toLowerCase() === genre.toLowerCase());
      if (exists) {
        return prev.filter((g) => g.toLowerCase() !== genre.toLowerCase());
      }
      return [...prev, genre];
    });
  };

  const handleSingleGenreSelect = (val: string) => {
    setCurrentPage(1);
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
    setSelectedSeason('');
    setSelectedSort('top');
    setSearchInput('');
    setAppliedQuery('');
    setCurrentPage(1);
    setError(null);
  };

  const hasActiveFilters =
    selectedGenres.length > 0 ||
    Boolean(selectedFormat) ||
    Boolean(selectedStatus) ||
    Boolean(selectedYear) ||
    Boolean(selectedSeason) ||
    Boolean(searchInput.trim()) ||
    Boolean(appliedQuery.trim()) ||
    selectedSort !== 'top';

  const displayedItems = error ? [] : items;
  const startItem =
    displayedItems.length > 0
      ? (currentPage - 1) * DEFAULT_PER_PAGE + 1
      : 0;
  const endItem =
    displayedItems.length > 0
      ? (currentPage - 1) * DEFAULT_PER_PAGE + displayedItems.length
      : 0;

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
                  setCurrentPage(1);
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
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
              onChange={(e) => {
                setSelectedFormat(e.target.value);
                setCurrentPage(1);
              }}
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
              onChange={(e) => {
                setSelectedYear(e.target.value);
                setCurrentPage(1);
              }}
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

          {/* Season */}
          <div>
            <label
              htmlFor="explore-season-select"
              className="block text-[#707070] font-medium mb-1 uppercase tracking-wider text-[10px]"
            >
              Season
            </label>
            <select
              id="explore-season-select"
              aria-label="Season"
              value={selectedSeason}
              onChange={(e) => {
                setSelectedSeason(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full h-9 px-3 bg-[#141414] text-white border border-[#292929] rounded-lg focus:outline-none focus:border-white cursor-pointer"
            >
              <option value="">All Seasons</option>
              {SEASONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
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
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setCurrentPage(1);
              }}
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
          <div>
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
              onChange={(e) => {
                setSelectedSort(e.target.value);
                setCurrentPage(1);
              }}
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
                onClick={() => {
                  setSelectedFormat('');
                  setCurrentPage(1);
                }}
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
                onClick={() => {
                  setSelectedYear('');
                  setCurrentPage(1);
                }}
                aria-label={`Remove year ${selectedYear}`}
                className="h-7 px-2.5 rounded-lg bg-[#1B1B1B] border border-[#404040] text-white text-[11px] flex items-center gap-1.5 hover:border-white transition-colors cursor-pointer"
              >
                <span>Year: {selectedYear}</span>
                <X size={11} />
              </button>
            )}

            {selectedSeason && (
              <button
                type="button"
                onClick={() => {
                  setSelectedSeason('');
                  setCurrentPage(1);
                }}
                aria-label={`Remove season ${selectedSeason}`}
                className="h-7 px-2.5 rounded-lg bg-[#1B1B1B] border border-[#404040] text-white text-[11px] flex items-center gap-1.5 hover:border-white transition-colors cursor-pointer"
              >
                <span>
                  Season:{' '}
                  {SEASONS.find((s) => s.value === selectedSeason)?.label ||
                    selectedSeason}
                </span>
                <X size={11} />
              </button>
            )}

            {selectedStatus && (
              <button
                type="button"
                onClick={() => {
                  setSelectedStatus('');
                  setCurrentPage(1);
                }}
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
          {displayedItems.length > 0 ? (
            <span>
              Showing{' '}
              <strong className="text-white font-semibold">
                {startItem}–{endItem}
              </strong>
              {total > endItem ? (
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
          ) : (
            <span>
              Showing <strong className="text-white font-semibold">0</strong> titles
            </span>
          )}
          {totalPages && totalPages > 1 && (
            <span className="text-[#707070]">
              · Page {currentPage} of {totalPages}
            </span>
          )}
        </div>
        {isLoading && (
          <span className="text-white flex items-center gap-1.5">
            <Loader2 size={13} className="animate-spin" />
            <span>Loading page {currentPage}...</span>
          </span>
        )}
      </div>

      {/* API Error State */}
      {error ? (
        <div
          role="alert"
          data-testid="explore-error-state"
          className="p-6 bg-[#0A0A0A] border border-[#292929] rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 text-left">
            <AlertCircle size={20} className="text-white shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-white">
                Failed to Load Catalogue Page {currentPage}
              </h3>
              <p className="text-xs text-[#A0A0A0] mt-0.5">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchCatalogPage(buildQueryParams(), true)}
            className="px-4 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors shrink-0 cursor-pointer"
          >
            Retry Page {currentPage}
          </button>
        </div>
      ) : (
        <AnimeGrid
          animeList={displayedItems}
          isLoading={isLoading}
          count={DEFAULT_PER_PAGE}
          emptyMessage="No anime in the catalogue match the selected filters."
        />
      )}

      {/* Numbered Pagination Controls */}
      {(!error || currentPage > 1) && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          hasNextPage={hasNextPage}
          hasPreviousPage={hasPreviousPage}
          onPageChange={handlePageChange}
          isLoading={isLoading}
          totalItems={total}
          perPage={DEFAULT_PER_PAGE}
          itemCount={displayedItems.length}
        />
      )}
    </div>
  );
}
