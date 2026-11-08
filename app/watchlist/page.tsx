'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Bookmark, Film, Trash2, Play, Compass } from 'lucide-react';
import { WatchlistEntry } from '@/types/streaming';
import { getWatchlist, toggleWatchlist } from '@/lib/storage';

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistEntry[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setItems(getWatchlist());

    const handleUpdate = () => setItems(getWatchlist());
    window.addEventListener('aniscroll_watchlist_updated', handleUpdate);
    return () => window.removeEventListener('aniscroll_watchlist_updated', handleUpdate);
  }, []);

  const handleRemove = (e: React.MouseEvent, item: WatchlistEntry) => {
    e.preventDefault();
    e.stopPropagation();
    toggleWatchlist({
      hoshikaId: item.hoshikaId,
      title: item.title,
      coverImage: item.coverImage,
    });
  };

  if (!mounted) {
    return (
      <div className="space-y-6 pb-16">
        <div className="h-8 w-48 bg-[#141414] rounded-lg animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] bg-[#141414] rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center justify-between pb-2 border-b border-[#292929]">
        <div className="flex items-center gap-2.5">
          <Bookmark size={22} className="text-white" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              My Watchlist
            </h1>
            <p className="text-xs text-[#707070]">
              {items.length} {items.length === 1 ? 'anime' : 'anime titles'} saved to your personal library.
            </p>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="py-20 text-center bg-[#0A0A0A] rounded-2xl border border-[#292929] p-8 space-y-4">
          <Bookmark size={40} className="mx-auto text-[#707070]" />
          <div>
            <h3 className="text-base font-semibold text-white">
              Your Watchlist is Empty
            </h3>
            <p className="text-xs text-[#707070] mt-1 max-w-sm mx-auto">
              Save anime you plan to watch by clicking the bookmark icon on any card or details page.
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
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {items.map((item) => (
            <div
              key={item.hoshikaId}
              className="group relative flex flex-col bg-[#141414] rounded-xl overflow-hidden border border-[#292929] hover:border-[#404040] transition-all"
            >
              <Link
                href={`/anime/${item.hoshikaId}`}
                className="relative aspect-[3/4] overflow-hidden bg-[#0A0A0A]"
              >
                {item.coverImage ? (
                  <Image
                    src={item.coverImage}
                    alt={item.title}
                    fill
                    sizes="(max-width: 640px) 50vw, 20vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#707070]">
                    <Film size={28} />
                  </div>
                )}

                {/* Hover Play Overlay */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                    <Play size={18} fill="currentColor" className="ml-0.5" />
                  </div>
                </div>

                {/* Remove button */}
                <button
                  type="button"
                  onClick={(e) => handleRemove(e, item)}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 text-[#A0A0A0] hover:text-white hover:bg-black transition-colors"
                  title="Remove from Watchlist"
                  aria-label="Remove from Watchlist"
                >
                  <Trash2 size={14} />
                </button>
              </Link>

              <div className="p-3">
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
                      <span aria-hidden="true" className="text-[#707070]">·</span>
                      <span>{item.seasonYear}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
