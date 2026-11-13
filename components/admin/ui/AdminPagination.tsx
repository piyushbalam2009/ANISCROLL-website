'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface AdminPaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (nextPage: number) => void;
}

export function AdminPagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: AdminPaginationProps) {
  if (totalItems === 0 || totalPages <= 1) {
    return (
      <div className="flex items-center justify-between text-xs font-mono text-[#707070] tabular-nums">
        <span>
          Showing {totalItems} {totalItems === 1 ? 'item' : 'items'}
        </span>
      </div>
    );
  }

  const startItem = (page - 1) * pageSize + 1;
  const endItem = Math.min(totalItems, page * pageSize);

  const pages: number[] = [];
  const startP = Math.max(1, page - 2);
  const endP = Math.min(totalPages, page + 2);
  for (let p = startP; p <= endP; p++) {
    pages.push(p);
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
      <div className="text-xs font-mono text-[#707070] tabular-nums">
        Showing <span className="text-white font-semibold">{startItem}</span>–
        <span className="text-white font-semibold">{endItem}</span> of{' '}
        <span className="text-white font-semibold">{totalItems}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white/40 text-xs font-mono text-white disabled:opacity-40 cursor-pointer"
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
          <span>Prev</span>
        </button>

        {startP > 1 && (
          <>
            <button
              type="button"
              onClick={() => onPageChange(1)}
              className="px-2.5 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white/40 text-xs font-mono text-[#A0A0A0] cursor-pointer"
            >
              1
            </button>
            {startP > 2 && <span className="px-1 text-xs text-[#707070]">…</span>}
          </>
        )}

        {pages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono tabular-nums cursor-pointer ${
              p === page
                ? 'bg-white text-black border-white font-bold'
                : 'bg-[#141414] text-[#A0A0A0] border-[#292929] hover:border-white/40 hover:text-white'
            }`}
          >
            {p}
          </button>
        ))}

        {endP < totalPages && (
          <>
            {endP < totalPages - 1 && (
              <span className="px-1 text-xs text-[#707070]">…</span>
            )}
            <button
              type="button"
              onClick={() => onPageChange(totalPages)}
              className="px-2.5 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white/40 text-xs font-mono text-[#A0A0A0] cursor-pointer"
            >
              {totalPages}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white/40 text-xs font-mono text-white disabled:opacity-40 cursor-pointer"
          aria-label="Next page"
        >
          <span>Next</span>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
