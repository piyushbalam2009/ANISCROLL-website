'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { PlayCircle, Play, Film, Trash2, Compass } from 'lucide-react';
import { WatchHistoryEntry } from '@/types/streaming';
import { getContinueWatching, removeHistoryEntry } from '@/lib/storage';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default function ContinueWatchingPage() {
  const [items, setItems] = useState<WatchHistoryEntry[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setItems(getContinueWatching());

    const handleUpdate = () => setItems(getContinueWatching());
    window.addEventListener('aniscroll_history_updated', handleUpdate);
    return () => window.removeEventListener('aniscroll_history_updated', handleUpdate);
  }, []);

  const handleRemove = (e: React.MouseEvent, item: WatchHistoryEntry) => {
    e.preventDefault();
    e.stopPropagation();
    removeHistoryEntry(item.hoshikaId, item.episodeNumber);
  };

  return (
    <ProtectedRoute>
      {!mounted ? (
        <div className="space-y-6 pb-16">
          <div className="h-8 w-48 bg-[#141414] rounded-lg animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-video bg-[#141414] rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-6 pb-16">
          <div className="flex items-center justify-between pb-2 border-b border-[#292929]">
            <div className="flex items-center gap-2.5">
              <PlayCircle size={22} className="text-white" />
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  Continue Watching
                </h1>
                <p className="text-xs text-[#707070]">
                  Pick up where you left off across all your active anime series.
                </p>
              </div>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="py-20 text-center bg-[#0A0A0A] rounded-2xl border border-[#292929] p-8 space-y-4">
              <PlayCircle size={40} className="mx-auto text-[#707070]" />
              <div>
                <h3 className="text-base font-semibold text-white">
                  No Episodes In Progress
                </h3>
                <p className="text-xs text-[#707070] mt-1 max-w-sm mx-auto">
                  When you begin streaming an episode, your playback progress will automatically save and appear here.
                </p>
              </div>
              <Link
                href="/trending"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors"
              >
                <Compass size={15} />
                <span>Discover Trending Anime</span>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {items.map((item) => {
                const progressPercent = Math.min(
                  100,
                  Math.round((item.currentTime / (item.duration || 1)) * 100)
                );

                return (
                  <div
                    key={`${item.hoshikaId}-${item.episodeNumber}`}
                    className="group relative flex flex-col bg-[#141414] rounded-xl overflow-hidden border border-[#292929] hover:border-[#404040] transition-all"
                  >
                    <Link
                      href={`/watch/${item.hoshikaId}/${item.episodeNumber}`}
                      className="relative aspect-video bg-[#0A0A0A] overflow-hidden"
                    >
                      {item.bannerImage || item.coverImage ? (
                        <Image
                          src={item.bannerImage || item.coverImage!}
                          alt={item.title}
                          fill
                          sizes="(max-width: 640px) 100vw, 300px"
                          className="object-cover group-hover:scale-105 transition-transform duration-200"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#707070]">
                          <Film size={24} />
                        </div>
                      )}

                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                          <Play size={18} fill="currentColor" className="ml-0.5" />
                        </div>
                      </div>

                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-mono bg-black/80 text-white backdrop-blur-sm border border-[#292929]">
                        EP {item.episodeNumber}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => handleRemove(e, item)}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 text-[#A0A0A0] hover:text-white hover:bg-black transition-colors"
                        title="Remove from history"
                        aria-label="Remove from history"
                      >
                        <Trash2 size={13} />
                      </button>

                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#292929]">
                        <div
                          className="h-full bg-white transition-all"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    </Link>

                    <div className="p-3">
                      <h4 className="text-sm font-semibold text-white truncate" title={item.title}>
                        {item.title}
                      </h4>
                      <div className="flex items-center justify-between text-xs text-[#A0A0A0] mt-1">
                        <span>Episode {item.episodeNumber}</span>
                        <span className="font-mono text-[11px] text-[#707070]">
                          {progressPercent}% completed
                        </span>
                      </div>
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
