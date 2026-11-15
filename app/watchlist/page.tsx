'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { Bookmark, Film, Trash2, Play, Compass, Link2 } from 'lucide-react';
import { WatchlistEntry, WatchlistStatus } from '@/types/streaming';
import {
  getWatchlist,
  toggleWatchlist,
  setWatchlistStatus,
} from '@/lib/storage';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

const STATUS_LABELS: Record<WatchlistStatus, string> = {
  watching: 'Watching',
  plan_to_watch: 'Plan to Watch',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
};

const STATUS_FILTER_OPTIONS: { id: 'all' | WatchlistStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'watching', label: 'Watching' },
  { id: 'plan_to_watch', label: 'Plan to Watch' },
  { id: 'completed', label: 'Completed' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'dropped', label: 'Dropped' },
];

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | WatchlistStatus>('all');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setItems(getWatchlist());

    const handleUpdate = () => setItems(getWatchlist());
    window.addEventListener('aniscroll_watchlist_updated', handleUpdate);
    return () =>
      window.removeEventListener('aniscroll_watchlist_updated', handleUpdate);
  }, []);

  const counts = useMemo(() => {
    const base: Record<'all' | WatchlistStatus, number> = {
      all: items.length,
      watching: 0,
      plan_to_watch: 0,
      completed: 0,
      on_hold: 0,
      dropped: 0,
    };
    for (const item of items) {
      const s: WatchlistStatus = item.status || 'plan_to_watch';
      if (s in base) {
        base[s] += 1;
      }
    }
    return base;
  }, [items]);

  const filteredItems = useMemo(() => {
    if (statusFilter === 'all') return items;
    return items.filter((item) => (item.status || 'plan_to_watch') === statusFilter);
  }, [items, statusFilter]);

  const handleRemove = (e: React.MouseEvent, item: WatchlistEntry) => {
    e.preventDefault();
    e.stopPropagation();
    toggleWatchlist({
      hoshikaId: item.hoshikaId,
      title: item.title,
      coverImage: item.coverImage,
    });
  };

  const handleStatusChange = (
    item: WatchlistEntry,
    nextStatus: WatchlistStatus
  ) => {
    setWatchlistStatus(
      {
        hoshikaId: item.hoshikaId,
        title: item.title,
        coverImage: item.coverImage,
        format: item.format,
        rating: item.rating,
        seasonYear: item.seasonYear,
        episodeProgress: item.episodeProgress,
      },
      nextStatus
    );
  };

  return (
    <ProtectedRoute>
      {!mounted ? (
        <div className="space-y-6 pb-16">
          <div className="h-8 w-48 bg-[#141414] rounded-lg animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[3/4] bg-[#141414] rounded-xl animate-pulse"
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-6 pb-16">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#292929]">
            <div className="flex items-center gap-2.5">
              <Bookmark size={22} className="text-white" />
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  My Watchlist
                </h1>
                <p
                  data-testid="watchlist-total-count"
                  className="text-xs text-[#707070]"
                >
                  {items.length} {items.length === 1 ? 'anime' : 'anime titles'} saved to your personal cloud library & synced with Discord.
                </p>
              </div>
            </div>

            <Link
              href="/settings?section=account"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-medium text-white transition-colors self-start sm:self-center"
            >
              <Link2 size={13} />
              <span>Discord Bot Sync</span>
            </Link>
          </div>

          {/* Status Filter Tabs */}
          {items.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
              {STATUS_FILTER_OPTIONS.map((opt) => {
                const active = statusFilter === opt.id;
                const count = counts[opt.id];
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`watchlist-filter-${opt.id}`}
                    onClick={() => setStatusFilter(opt.id)}
                    className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer border ${
                      active
                        ? 'bg-white text-black border-white'
                        : 'bg-[#0A0A0A] text-[#A0A0A0] border-[#292929] hover:text-white hover:border-[#404040]'
                    }`}
                  >
                    <span>{opt.label}</span>
                    <span
                      className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                        active
                          ? 'bg-black/15 text-black'
                          : 'bg-[#141414] text-[#707070]'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {items.length === 0 ? (
            <div
              data-testid="watchlist-empty-state"
              className="py-20 text-center bg-[#0A0A0A] rounded-2xl border border-[#292929] p-8 space-y-4"
            >
              <Bookmark size={40} className="mx-auto text-[#707070]" />
              <div>
                <h3 className="text-base font-semibold text-white">
                  Your Watchlist is Empty
                </h3>
                <p className="text-xs text-[#707070] mt-1 max-w-sm mx-auto">
                  Save anime you plan to watch on the website or via /watchlist add in Discord.
                </p>
              </div>
              <Link
                href="/explore"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors"
              >
                <Compass size={15} />
                <span>Explore Anime</span>
              </Link>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="py-14 text-center bg-[#0A0A0A] rounded-2xl border border-[#292929] p-6 space-y-2">
              <div className="text-sm font-semibold text-white">
                No anime with status &ldquo;{STATUS_LABELS[statusFilter as WatchlistStatus]}&rdquo;
              </div>
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className="text-xs text-[#A0A0A0] hover:text-white underline cursor-pointer"
              >
                Show all {items.length} watchlist items
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {filteredItems.map((item) => {
                const itemStatus: WatchlistStatus = item.status || 'plan_to_watch';
                return (
                  <div
                    key={item.hoshikaId}
                    data-testid={`watchlist-card-${item.hoshikaId}`}
                    className="group relative flex flex-col bg-[#141414] rounded-xl overflow-hidden border border-[#292929] hover:border-[#404040] transition-all"
                  >
                    <Link
                      href={`/anime/${item.hoshikaId}`}
                      className="relative aspect-[3/4] overflow-hidden bg-[#0A0A0A]"
                    >
                      <ResilientImage
                        src={item.coverImage}
                        alt={item.title}
                        fill
                        sizes="(max-width: 640px) 50vw, 20vw"
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        fallback={
                          <div className="w-full h-full flex items-center justify-center text-[#707070]">
                            <Film size={28} />
                          </div>
                        }
                      />

                      {/* Status Badge Overlay */}
                      <div
                        data-testid={`watchlist-status-badge-${item.hoshikaId}`}
                        className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/80 border border-white/20 text-[10px] font-mono uppercase tracking-wider text-white"
                      >
                        {STATUS_LABELS[itemStatus]}
                      </div>

                      {/* Hover Play Overlay */}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                          <Play
                            size={18}
                            fill="currentColor"
                            className="ml-0.5"
                          />
                        </div>
                      </div>

                      {/* Remove button */}
                      <button
                        type="button"
                        data-testid={`watchlist-remove-${item.hoshikaId}`}
                        onClick={(e) => handleRemove(e, item)}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 text-[#A0A0A0] hover:text-white hover:bg-black transition-colors cursor-pointer"
                        title="Remove from Watchlist"
                        aria-label="Remove from Watchlist"
                      >
                        <Trash2 size={14} />
                      </button>
                    </Link>

                    <div className="p-3 flex flex-col gap-2 flex-1 justify-between">
                      <div>
                        <Link
                          href={`/anime/${item.hoshikaId}`}
                          className="font-medium text-xs text-white line-clamp-1 hover:underline"
                          title={item.title}
                        >
                          {item.title}
                        </Link>
                        <div className="flex items-center gap-1.5 text-[11px] text-[#A0A0A0] mt-1">
                          <span>{item.format || 'TV'}</span>
                          {item.seasonYear && (
                            <>
                              <span
                                aria-hidden="true"
                                className="text-[#707070]"
                              >
                                ·
                              </span>
                              <span>{item.seasonYear}</span>
                            </>
                          )}
                          {typeof item.episodeProgress === 'number' &&
                            item.episodeProgress > 0 && (
                              <>
                                <span
                                  aria-hidden="true"
                                  className="text-[#707070]"
                                >
                                  ·
                                </span>
                                <span className="font-mono text-white">
                                  EP {item.episodeProgress}
                                </span>
                              </>
                            )}
                        </div>
                      </div>

                      <select
                        data-testid={`watchlist-status-select-${item.hoshikaId}`}
                        aria-label={`Watchlist status for ${item.title}`}
                        value={itemStatus}
                        onChange={(e) =>
                          handleStatusChange(
                            item,
                            e.target.value as WatchlistStatus
                          )
                        }
                        className="w-full h-7 px-2 rounded-lg bg-[#0A0A0A] border border-[#292929] hover:border-white/50 text-[11px] font-medium text-white focus:outline-none cursor-pointer"
                      >
                        {(Object.keys(STATUS_LABELS) as WatchlistStatus[]).map(
                          (st) => (
                            <option
                              key={st}
                              value={st}
                              className="bg-[#0A0A0A] text-white"
                            >
                              {STATUS_LABELS[st]}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </ProtectedRoute>
  );
}
