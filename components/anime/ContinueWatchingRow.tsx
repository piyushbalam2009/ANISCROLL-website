'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { PlayCircle, ArrowRight } from 'lucide-react';
import { WatchHistoryEntry } from '@/types/streaming';
import { getContinueWatching } from '@/lib/storage';
import { enrichWatchHistoryEntries } from '@/lib/episode-store';
import { ContinueWatchingCard } from './ContinueWatchingCard';

export function ContinueWatchingRow() {
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

  if (!mounted || items.length === 0) return null;

  return (
    <section className="space-y-4" aria-label="Continue Watching">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PlayCircle size={20} className="text-white" />
          <h2 className="text-xl font-bold tracking-tight text-white">
            Continue Watching
          </h2>
        </div>
        <Link
          href="/continue-watching"
          className="text-xs font-medium text-[#A0A0A0] hover:text-white flex items-center gap-1 transition-colors"
        >
          <span>View All</span>
          <ArrowRight size={14} />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.slice(0, 4).map((item) => (
          <ContinueWatchingCard
            key={`${item.hoshikaId}-${item.episodeNumber}`}
            item={item}
          />
        ))}
      </div>
    </section>
  );
}
