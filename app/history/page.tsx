'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { History, Trash2, Play } from 'lucide-react';
import { WatchHistoryEntry } from '@/types/streaming';
import { getWatchHistory, clearWatchHistory, removeHistoryEntry } from '@/lib/storage';
import { enrichWatchHistoryEntries } from '@/lib/episode-store';
import {
  calculateWatchProgress,
  getContinueWatchingThumbnailCandidates,
  resolveDisplayAnimeTitle,
  resolveDisplayEpisodeTitle,
} from '@/lib/continue-watching';

export default function HistoryPage() {
  const [history, setHistory] = useState<WatchHistoryEntry[]>([]);
  const [mounted, setMounted] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    setMounted(true);
    const loadAndEnrich = () => {
      const current = getWatchHistory();
      setHistory(current);
      if (current.length > 0) {
        enrichWatchHistoryEntries(current.slice(0, 12));
      }
    };

    loadAndEnrich();

    window.addEventListener('aniscroll_history_updated', loadAndEnrich);
    return () => window.removeEventListener('aniscroll_history_updated', loadAndEnrich);
  }, []);

  const handleClear = () => {
    clearWatchHistory();
    setConfirmClear(false);
  };

  const handleRemove = (hoshikaId: number, episodeNumber: number) => {
    removeHistoryEntry(hoshikaId, episodeNumber);
  };

  if (!mounted) {
    return (
      <div className="space-y-6 pb-16">
        <div className="h-8 w-48 bg-[#141414] rounded-lg animate-pulse" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-[#141414] rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
          <div className="flex items-center justify-between pb-2 border-b border-[#292929]">
            <div className="flex items-center gap-2.5">
              <History size={22} className="text-white" />
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  Watch History
                </h1>
                <p className="text-xs text-[#707070]">
                  {history.length} {history.length === 1 ? 'entry' : 'entries'} synced with your account.
                </p>
              </div>
            </div>

            {history.length > 0 && (
              <div>
                {confirmClear ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#A0A0A0]">Clear all?</span>
                    <button
                      onClick={handleClear}
                      className="px-3 py-1 bg-white text-black text-xs font-semibold rounded hover:bg-neutral-200 transition-colors"
                    >
                      Yes, Clear
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="px-2 py-1 text-xs text-[#707070] hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClear(true)}
                    className="px-3 py-1.5 rounded-lg border border-[#292929] text-xs text-[#A0A0A0] hover:text-white hover:border-[#404040] transition-colors flex items-center gap-1.5"
                  >
                    <Trash2 size={13} />
                    <span>Clear History</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {history.length === 0 ? (
            <div className="py-20 text-center bg-[#0A0A0A] rounded-2xl border border-[#292929] p-8 space-y-3">
              <History size={40} className="mx-auto text-[#707070]" />
              <h3 className="text-base font-semibold text-white">
                No Watch History Found
              </h3>
              <p className="text-xs text-[#707070] max-w-sm mx-auto">
                Anime episodes you watch will be automatically recorded here so you can easily track and resume your viewing.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((item) => {
                const watchedDate = new Date(item.timestamp).toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const thumbCandidates = getContinueWatchingThumbnailCandidates(item);
                const thumbUrl = thumbCandidates[0] || null;
                const animeTitle = resolveDisplayAnimeTitle(item);
                const epTitle = resolveDisplayEpisodeTitle(item);
                const progressPercent = calculateWatchProgress(
                  item.currentTime,
                  item.duration,
                  item.progress
                );
                const resumeSeconds = Math.max(0, Math.floor(item.currentTime || 0));
                const audioParam =
                  item.audioType === 'dub' || item.audioType === 'sub'
                    ? `&type=${item.audioType}`
                    : '';

                return (
                  <div
                    key={`${item.hoshikaId}-${item.episodeNumber}-${item.timestamp}`}
                    className="group flex items-center justify-between p-3 rounded-xl bg-[#141414] border border-[#292929] hover:border-[#404040] hover:bg-[#1B1B1B] transition-all"
                  >
                    <Link
                      href={`/watch/${item.hoshikaId}/${item.episodeNumber}?resume=1&t=${resumeSeconds}${audioParam}`}
                      className="flex items-center gap-4 flex-1 min-w-0"
                    >
                      <div className="relative w-28 sm:w-32 aspect-video bg-[#0A0A0A] rounded-lg overflow-hidden shrink-0 border border-[#292929]">
                        <ResilientImage
                          src={thumbUrl}
                          fallbackSrcs={thumbCandidates.slice(1)}
                          alt={`${animeTitle} - ${epTitle}`}
                          fill
                          sizes="128px"
                          className="object-cover"
                          fallback={
                            <div className="w-full h-full flex items-center justify-center bg-[#141414] text-[10px] font-mono text-[#707070]">
                              EP {item.episodeNumber}
                            </div>
                          }
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Play size={15} fill="white" className="text-white" />
                        </div>
                        {progressPercent > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#292929]">
                            <div
                              className="h-full bg-white"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-white truncate group-hover:underline">
                          {animeTitle}
                        </h3>
                        <p className="text-xs text-[#CCCCCC] truncate mt-0.5">
                          {epTitle}
                        </p>
                        <div className="flex items-center gap-2 text-[11px] text-[#707070] mt-1 font-mono tabular-nums">
                          <span>Episode {item.episodeNumber}</span>
                          <span aria-hidden="true">·</span>
                          <span>{progressPercent}% watched</span>
                          <span aria-hidden="true">·</span>
                          <span>{watchedDate}</span>
                        </div>
                      </div>
                    </Link>

                    <button
                      type="button"
                      onClick={() => handleRemove(item.hoshikaId, item.episodeNumber)}
                      className="p-2 text-[#707070] hover:text-white rounded-lg hover:bg-[#141414] transition-colors ml-3"
                      title="Remove from history"
                      aria-label="Remove from history"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
  );
}
