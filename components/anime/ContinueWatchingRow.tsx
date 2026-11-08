'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { PlayCircle, Play, Film, ArrowRight } from 'lucide-react';
import { WatchHistoryEntry } from '@/types/streaming';
import { getContinueWatching } from '@/lib/storage';

export function ContinueWatchingRow() {
  const [items, setItems] = useState<WatchHistoryEntry[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setItems(getContinueWatching());

    const handleUpdate = () => setItems(getContinueWatching());
    window.addEventListener('aniscroll_history_updated', handleUpdate);
    return () => window.removeEventListener('aniscroll_history_updated', handleUpdate);
  }, []);

  if (!mounted || items.length === 0) return null;

  return (
    <section className="space-y-4">
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
        {items.slice(0, 4).map((item) => {
          const progressPercent = Math.min(
            100,
            Math.round((item.currentTime / (item.duration || 1)) * 100)
          );

          return (
            <Link
              key={`${item.hoshikaId}-${item.episodeNumber}`}
              href={`/watch/${item.hoshikaId}/${item.episodeNumber}`}
              className="group flex flex-col bg-[#141414] rounded-xl overflow-hidden border border-[#292929] hover:border-[#404040] transition-all"
            >
              {/* Thumbnail with progress bar */}
              <div className="relative aspect-video bg-[#0A0A0A] overflow-hidden">
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

                {/* Play Hover Overlay */}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                    <Play size={18} fill="currentColor" className="ml-0.5" />
                  </div>
                </div>

                {/* Episode indicator */}
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-mono bg-black/80 text-white backdrop-blur-sm border border-[#292929]">
                  EP {item.episodeNumber}
                </div>

                {/* Progress bar */}
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-[#292929]">
                  <div
                    className="h-full bg-white transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Info */}
              <div className="p-3">
                <h4 className="text-sm font-semibold text-white truncate" title={item.title}>
                  {item.title}
                </h4>
                <div className="flex items-center justify-between text-xs text-[#A0A0A0] mt-1">
                  <span>Episode {item.episodeNumber}</span>
                  <span className="font-mono text-[11px] text-[#707070]">
                    {progressPercent}% watched
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
