'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { History, Film, Trash2, Play } from 'lucide-react';
import { WatchHistoryEntry } from '@/types/streaming';
import { getWatchHistory, clearWatchHistory, removeHistoryEntry } from '@/lib/storage';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function HistoryPage() {
  const [history, setHistory] = useState<WatchHistoryEntry[]>([]);
  const [mounted, setMounted] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    setMounted(true);
    setHistory(getWatchHistory());

    const handleUpdate = () => setHistory(getWatchHistory());
    window.addEventListener('aniscroll_history_updated', handleUpdate);
    return () => window.removeEventListener('aniscroll_history_updated', handleUpdate);
  }, []);

  const handleClear = () => {
    clearWatchHistory();
    setConfirmClear(false);
  };

  const handleRemove = (hoshikaId: number, episodeNumber: number) => {
    removeHistoryEntry(hoshikaId, episodeNumber);
  };

  return (
    <ProtectedRoute>
      {!mounted ? (
        <div className="space-y-6 pb-16">
          <div className="h-8 w-48 bg-[#141414] rounded-lg animate-pulse" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 bg-[#141414] rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      ) : (
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

                return (
                  <div
                    key={`${item.hoshikaId}-${item.episodeNumber}-${item.timestamp}`}
                    className="group flex items-center justify-between p-3 rounded-xl bg-[#141414] border border-[#292929] hover:border-[#404040] hover:bg-[#1B1B1B] transition-all"
                  >
                    <Link
                      href={`/watch/${item.hoshikaId}/${item.episodeNumber}`}
                      className="flex items-center gap-4 flex-1 min-w-0"
                    >
                      <div className="relative w-24 aspect-video bg-[#0A0A0A] rounded-lg overflow-hidden shrink-0 border border-[#292929]">
                        {item.bannerImage || item.coverImage ? (
                          <Image
                            src={item.bannerImage || item.coverImage!}
                            alt={item.title}
                            fill
                            sizes="96px"
                            className="object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[#707070]">
                            <Film size={18} />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Play size={15} fill="white" className="text-white" />
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-white truncate group-hover:underline">
                          {item.title}
                        </h3>
                        <div className="flex items-center gap-2 text-xs text-[#A0A0A0] mt-0.5">
                          <span className="font-medium text-white">
                            Episode {item.episodeNumber}
                          </span>
                          {item.episodeTitle && item.episodeTitle !== `Episode ${item.episodeNumber}` && (
                            <>
                              <span aria-hidden="true" className="text-[#707070]">·</span>
                              <span className="truncate max-w-xs">{item.episodeTitle}</span>
                            </>
                          )}
                        </div>
                        <div className="text-[11px] text-[#707070] mt-1">
                          Watched on {watchedDate}
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
      )}
    </ProtectedRoute>
  );
}
