'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import {
  generatePaginationRange,
  sanitizePageNumber,
} from '@/lib/explore-catalog';

export interface PaginationProps {
  currentPage: number;
  totalPages: number | null;
  hasNextPage: boolean;
  hasPreviousPage?: boolean;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
  totalItems?: number;
  perPage?: number;
  itemCount?: number;
}

export function Pagination({
  currentPage,
  totalPages,
  hasNextPage,
  hasPreviousPage,
  onPageChange,
  isLoading = false,
  totalItems,
  perPage = 30,
  itemCount = 0,
}: PaginationProps) {
  const safePage = sanitizePageNumber(currentPage);
  const canGoPrev =
    typeof hasPreviousPage === 'boolean' ? hasPreviousPage : safePage > 1;
  const canGoNext =
    Boolean(hasNextPage) &&
    (totalPages === null || safePage < totalPages);

  const pageRange = generatePaginationRange(safePage, totalPages, canGoNext);

  if (pageRange.length <= 1 && !canGoPrev && !canGoNext) {
    return null;
  }

  const startItem = itemCount > 0 ? (safePage - 1) * perPage + 1 : 0;
  const endItem = itemCount > 0 ? (safePage - 1) * perPage + itemCount : 0;

  const handleSelectPage = (targetPage: number) => {
    const cleanTarget = sanitizePageNumber(targetPage);
    if (cleanTarget === safePage || isLoading) return;
    if (totalPages !== null && cleanTarget > totalPages) return;
    onPageChange(cleanTarget);
  };

  return (
    <nav
      aria-label="Pagination"
      data-testid="pagination-nav"
      className="pt-6 pb-2 flex flex-col items-center justify-center gap-3 select-none"
    >
      <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
        {/* Previous Button */}
        <button
          type="button"
          data-testid="pagination-prev"
          onClick={() => canGoPrev && handleSelectPage(safePage - 1)}
          disabled={!canGoPrev || isLoading}
          aria-label="Go to previous page"
          className="h-9 px-3 sm:px-3.5 rounded-xl bg-[#141414] border border-[#292929] text-xs font-semibold text-[#A0A0A0] hover:text-white hover:border-white hover:bg-[#1B1B1B] disabled:opacity-40 disabled:pointer-events-none transition-all flex items-center gap-1.5 cursor-pointer"
        >
          <ChevronLeft size={14} />
          <span className="hidden xs:inline sm:inline">Previous</span>
        </button>

        {/* Numbered Page Buttons */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {pageRange.map((entry, idx) => {
            if (entry === 'ellipsis') {
              return (
                <span
                  key={`ellipsis-${idx}`}
                  data-testid="pagination-ellipsis"
                  aria-hidden="true"
                  className="w-8 h-9 flex items-center justify-center text-[#707070]"
                >
                  <MoreHorizontal size={14} />
                </span>
              );
            }

            const isActive = entry === safePage;

            return (
              <button
                key={`page-${entry}`}
                type="button"
                data-testid={`pagination-page-${entry}`}
                onClick={() => handleSelectPage(entry)}
                disabled={isLoading}
                aria-label={`Page ${entry}`}
                aria-current={isActive ? 'page' : undefined}
                className={`min-w-[36px] h-9 px-2.5 rounded-xl border text-xs font-semibold transition-all flex items-center justify-center cursor-pointer ${
                  isActive
                    ? 'bg-white text-black border-white font-bold shadow-sm'
                    : 'bg-[#141414] text-[#A0A0A0] border-[#292929] hover:text-white hover:border-white hover:bg-[#1B1B1B]'
                } disabled:opacity-60`}
              >
                {entry}
              </button>
            );
          })}
        </div>

        {/* Next Button */}
        <button
          type="button"
          data-testid="pagination-next"
          onClick={() => canGoNext && handleSelectPage(safePage + 1)}
          disabled={!canGoNext || isLoading}
          aria-label="Go to next page"
          className="h-9 px-3 sm:px-3.5 rounded-xl bg-[#141414] border border-[#292929] text-xs font-semibold text-[#A0A0A0] hover:text-white hover:border-white hover:bg-[#1B1B1B] disabled:opacity-40 disabled:pointer-events-none transition-all flex items-center gap-1.5 cursor-pointer"
        >
          <span className="hidden xs:inline sm:inline">Next</span>
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Range & Page Summary */}
      <div
        data-testid="pagination-summary"
        className="text-[11px] text-[#707070] flex items-center gap-2"
      >
        <span>
          Page <strong className="text-white font-semibold">{safePage}</strong>
          {totalPages && totalPages > 0 ? (
            <>
              {' '}
              of{' '}
              <strong className="text-white font-semibold">{totalPages}</strong>
            </>
          ) : null}
        </span>
        {itemCount > 0 && (
          <>
            <span>·</span>
            <span>
              Items{' '}
              <strong className="text-[#A0A0A0] font-medium">
                {startItem}–{endItem}
              </strong>
              {typeof totalItems === 'number' && totalItems > endItem ? (
                <>
                  {' '}
                  of{' '}
                  <strong className="text-[#A0A0A0] font-medium">
                    {totalItems >= 1000 ? '1,000+' : totalItems.toLocaleString()}
                  </strong>
                </>
              ) : null}
            </span>
          </>
        )}
      </div>
    </nav>
  );
}
