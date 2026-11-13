'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { AnimeGrid } from '@/components/anime/AnimeGrid';
import { Pagination } from '@/components/ui/Pagination';
import { HoshikaAnimeItem } from '@/types/anime';
import {
  DEFAULT_PER_PAGE,
  StandardPaginatedResponse,
  sanitizePageNumber,
} from '@/lib/explore-catalog';
import { AlertCircle, Loader2 } from 'lucide-react';

interface PaginatedBrowseSectionProps {
  category: 'trending' | 'popular' | 'recent';
  initialData: StandardPaginatedResponse<HoshikaAnimeItem>;
  emptyMessage?: string;
}

export function PaginatedBrowseSection({
  category,
  initialData,
  emptyMessage = 'No anime found on this page.',
}: PaginatedBrowseSectionProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlPage = sanitizePageNumber(searchParams.get('page'));

  const [pageData, setPageData] =
    useState<StandardPaginatedResponse<HoshikaAnimeItem>>(initialData);
  const [currentPage, setCurrentPage] = useState<number>(
    initialData.currentPage || urlPage
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const sectionTopRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pageCacheRef = useRef<
    Map<number, StandardPaginatedResponse<HoshikaAnimeItem>>
  >(new Map([[initialData.currentPage || 1, initialData]]));

  // Keep initial server data seeded in cache and sync visible page when server revalidates
  useEffect(() => {
    if (initialData && Array.isArray(initialData.results) && initialData.results.length > 0) {
      const initPage = initialData.currentPage || 1;
      pageCacheRef.current.set(initPage, initialData);
      if (initPage === urlPage) {
        setPageData(initialData);
      }
    }
  }, [initialData, urlPage]);

  const fetchBrowsePage = useCallback(
    async (targetPage: number, forceRefresh: boolean = false) => {
      const safeTarget = sanitizePageNumber(targetPage);

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      if (!forceRefresh && pageCacheRef.current.has(safeTarget)) {
        const cached = pageCacheRef.current.get(safeTarget)!;
        setPageData(cached);
        setCurrentPage(safeTarget);
        setError(null);
        setIsLoading(false);
        return;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError(null);
      setCurrentPage(safeTarget);

      try {
        const refreshParam = forceRefresh ? '&refresh=true' : '';
        const res = await fetch(
          `/api/browse?category=${encodeURIComponent(category)}&page=${safeTarget}${refreshParam}`,
          { signal: controller.signal }
        );

        if (!res.ok) {
          throw new Error(`Failed to load ${category} page ${safeTarget} (${res.status})`);
        }

        const json = await res.json();
        if (controller.signal.aborted) return;

        if (!json || json.ok === false) {
          throw new Error(json?.error || `Failed to load ${category} anime`);
        }

        const results = Array.isArray(json.results)
          ? json.results
          : Array.isArray(json.items)
            ? json.items
            : [];

        const normalizedResponse: StandardPaginatedResponse<HoshikaAnimeItem> = {
          results,
          items: results,
          currentPage: sanitizePageNumber(json.currentPage ?? json.page ?? safeTarget),
          page: sanitizePageNumber(json.page ?? json.currentPage ?? safeTarget),
          perPage: typeof json.perPage === 'number' ? json.perPage : DEFAULT_PER_PAGE,
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
                : safeTarget,
          total: typeof json.total === 'number' ? json.total : results.length,
          hasNextPage: Boolean(json.hasNextPage ?? json.hasMore),
          hasMore: Boolean(json.hasMore ?? json.hasNextPage),
          hasPreviousPage:
            typeof json.hasPreviousPage === 'boolean'
              ? json.hasPreviousPage
              : safeTarget > 1,
        };

        pageCacheRef.current.set(safeTarget, normalizedResponse);
        setPageData(normalizedResponse);
        setCurrentPage(normalizedResponse.currentPage);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error(`[PaginatedBrowseSection:${category}] Error:`, err);
        setError(
          err?.message ||
            `Unable to load page ${safeTarget}. Please try again.`
        );
      } finally {
        if (abortControllerRef.current === controller) {
          setIsLoading(false);
        }
      }
    },
    [category]
  );

  // Sync with URL searchParams (handles Back/Forward buttons and direct URL changes)
  useEffect(() => {
    if (urlPage !== currentPage || (!pageCacheRef.current.has(urlPage) && !isLoading && !error)) {
      fetchBrowsePage(urlPage);
    }
  }, [urlPage, currentPage, isLoading, error, fetchBrowsePage]);

  const handlePageChange = (nextPage: number) => {
    const safeNext = sanitizePageNumber(nextPage);
    if (safeNext === currentPage && !error) return;

    const params = new URLSearchParams(searchParams.toString());
    if (safeNext <= 1) {
      params.delete('page');
    } else {
      params.set('page', String(safeNext));
    }

    const queryStr = params.toString();
    const targetUrl = queryStr ? `${pathname}?${queryStr}` : pathname;
    router.push(targetUrl, { scroll: false });

    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    fetchBrowsePage(safeNext);
  };

  const displayedItems = error ? [] : pageData.results || pageData.items || [];
  const startItem =
    displayedItems.length > 0
      ? (currentPage - 1) * (pageData.perPage || DEFAULT_PER_PAGE) + 1
      : 0;
  const endItem =
    displayedItems.length > 0
      ? (currentPage - 1) * (pageData.perPage || DEFAULT_PER_PAGE) +
        displayedItems.length
      : 0;

  return (
    <div ref={sectionTopRef} className="space-y-6">
      {/* Top Status & Page Indicator Bar */}
      <div
        data-testid={`${category}-results-summary`}
        className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#A0A0A0] px-1"
      >
        <div className="flex items-center gap-2">
          {displayedItems.length > 0 ? (
            <span>
              Showing{' '}
              <strong className="text-white font-semibold">
                {startItem}–{endItem}
              </strong>
              {pageData.total > endItem ? (
                <>
                  {' '}
                  of{' '}
                  <strong className="text-white font-semibold">
                    {pageData.total >= 1000
                      ? '1,000+'
                      : pageData.total.toLocaleString()}
                  </strong>
                </>
              ) : null}{' '}
              titles
            </span>
          ) : (
            <span>Page {currentPage}</span>
          )}
          {pageData.totalPages && pageData.totalPages > 1 && (
            <span className="text-[#707070]">
              · Page {currentPage} of {pageData.totalPages}
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

      {/* Error State (Never silently displays Page 1 when another page fails) */}
      {error ? (
        <div
          role="alert"
          data-testid={`${category}-error-state`}
          className="p-6 bg-[#0A0A0A] border border-[#292929] rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 text-left">
            <AlertCircle size={20} className="text-white shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-white">
                Failed to Load Page {currentPage}
              </h3>
              <p className="text-xs text-[#A0A0A0] mt-0.5">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fetchBrowsePage(currentPage, true)}
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
          emptyMessage={emptyMessage}
        />
      )}

      {/* Numbered Pagination Controls */}
      <Pagination
        currentPage={currentPage}
        totalPages={pageData.totalPages}
        hasNextPage={pageData.hasNextPage}
        hasPreviousPage={pageData.hasPreviousPage}
        onPageChange={handlePageChange}
        isLoading={isLoading}
        totalItems={pageData.total}
        perPage={pageData.perPage || DEFAULT_PER_PAGE}
        itemCount={displayedItems.length}
      />
    </div>
  );
}
