'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { PlayCircle, Compass } from 'lucide-react';
import { WatchHistoryEntry } from '@/types/streaming';
import { getContinueWatching, removeHistoryEntry } from '@/lib/storage';
import { enrichWatchHistoryEntries } from '@/lib/episode-store';
import { ContinueWatchingCard } from '@/components/anime/ContinueWatchingCard';

export default function ContinueWatchingPage() {
  const [items, setItems] = useState<WatchHistoryEntry[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const loadAndEnrich = () => {
      const current = getContinueWatching();
      setItems(current);
      if (current.length > 0) {
        enrichWatchHistoryEntries(current);
      }
    };

    loadAndEnrich();

    window.addEventListener('aniscroll_history_updated', loadAndEnrich);
    return () => window.removeEventListener('aniscroll_history_updated', loadAndEnrich);
  }, []);

  const handleRemove = (e: React.MouseEvent, item: WatchHistoryEntry) => {
    e.preventDefault();
    e.stopPropagation();
    removeHistoryEntry(item.hoshikaId, item.episodeNumber);
  };

  if (!mounted) {
    return (
      <div className="space-y-6 pb-16">
        <div className="h-8 w-48 bg-[#141414] rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-video bg-[#141414] rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
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
          {items.map((item) => (
            <ContinueWatchingCard
              key={`${item.hoshikaId}-${item.episodeNumber}`}
              item={item}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
