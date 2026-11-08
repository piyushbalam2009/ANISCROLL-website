'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Play, Film, Search } from 'lucide-react';
import { HoshikaEpisodeItem } from '@/types/anime';

interface EpisodeListProps {
  animeId: string | number;
  episodes: HoshikaEpisodeItem[];
  currentEpisode?: number;
  totalEpisodes?: number;
}

export function EpisodeList({
  animeId,
  episodes,
  currentEpisode,
  totalEpisodes,
}: EpisodeListProps) {
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedRange, setSelectedRange] = useState<number>(0);

  // If there are many episodes (e.g. One Piece with 1000 or Bleach with 300), paginate by blocks of 50
  const rangeSize = 50;
  const count = episodes.length > 0 ? episodes.length : (totalEpisodes || 0);
  const numRanges = Math.ceil(count / rangeSize);

  // If no episodes are returned yet (e.g. newly announced or external source), synthesize episode items
  const displayEpisodes: HoshikaEpisodeItem[] =
    episodes.length > 0
      ? episodes
      : Array.from({ length: totalEpisodes || 12 }, (_, i) => ({
          id: `ep-${i + 1}`,
          number: i + 1,
          title: `Episode ${i + 1}`,
          synopsis: '',
          thumbnail: null,
          aired: null,
          filler: false,
        }));

  const filtered = displayEpisodes.filter((ep) => {
    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    return (
      ep.number.toString().includes(q) ||
      (ep.title && ep.title.toLowerCase().includes(q))
    );
  });

  const rangeEpisodes =
    numRanges > 1 && !filterQuery.trim()
      ? filtered.slice(selectedRange * rangeSize, (selectedRange + 1) * rangeSize)
      : filtered;

  return (
    <div className="space-y-4">
      {/* Header & Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#292929]">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-white tracking-wide">
            Episodes
          </h2>
          <span className="text-xs text-[#707070] font-mono">
            ({displayEpisodes.length})
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Episode Range Tabs if > 50 */}
          {numRanges > 1 && (
            <div className="flex items-center gap-1 bg-[#141414] p-1 rounded-lg border border-[#292929] overflow-x-auto no-scrollbar max-w-xs">
              {Array.from({ length: numRanges }).map((_, rIdx) => {
                const start = rIdx * rangeSize + 1;
                const end = Math.min((rIdx + 1) * rangeSize, count);
                const isActive = selectedRange === rIdx;
                return (
                  <button
                    key={rIdx}
                    onClick={() => setSelectedRange(rIdx)}
                    className={`px-2.5 py-1 text-xs rounded font-medium whitespace-nowrap transition-colors ${
                      isActive
                        ? 'bg-white text-black font-semibold'
                        : 'text-[#A0A0A0] hover:text-white'
                    }`}
                  >
                    {start}-{end}
                  </button>
                );
              })}
            </div>
          )}

          {/* Search Episode Filter */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#707070]" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter episode..."
              className="h-8 pl-8 pr-3 text-xs bg-[#141414] text-white placeholder-[#707070] rounded-lg border border-[#292929] focus:outline-none focus:border-white transition-colors w-36 sm:w-44"
            />
          </div>
        </div>
      </div>

      {/* Episode Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {rangeEpisodes.map((ep) => {
          const isCurrent = currentEpisode === ep.number;
          return (
            <Link
              key={ep.number}
              href={`/watch/${animeId}/${ep.number}`}
              className={`group flex items-start gap-3 p-2.5 rounded-xl border transition-all ${
                isCurrent
                  ? 'bg-white/10 border-white text-white'
                  : 'bg-[#141414] border-[#292929] hover:border-[#404040] hover:bg-[#1B1B1B]'
              }`}
            >
              {/* Thumbnail Container */}
              <div className="relative w-28 aspect-video bg-[#0A0A0A] rounded-lg overflow-hidden shrink-0 border border-[#292929]">
                {ep.thumbnail ? (
                  <Image
                    src={ep.thumbnail}
                    alt={ep.title || `Episode ${ep.number}`}
                    fill
                    sizes="120px"
                    className="object-cover group-hover:scale-105 transition-transform duration-200"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#707070]">
                    <Film size={20} />
                  </div>
                )}

                {/* Play Overlay */}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Play size={18} fill="white" className="text-white ml-0.5" />
                </div>

                {/* Episode Badge */}
                <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/80 backdrop-blur-sm text-[10px] font-mono text-white rounded">
                  EP {ep.number}
                </div>
              </div>

              {/* Title & Info */}
              <div className="flex-1 min-w-0 py-0.5">
                <div className="flex items-center gap-1.5 text-xs text-[#A0A0A0]">
                  <span className="font-semibold text-white">Episode {ep.number}</span>
                  {ep.filler && (
                    <span className="text-[10px] text-[#707070] border border-[#292929] px-1 rounded">
                      Filler
                    </span>
                  )}
                </div>
                <h4
                  className="text-xs font-medium text-white truncate mt-1 group-hover:underline"
                  title={ep.title || `Episode ${ep.number}`}
                >
                  {ep.title || `Episode ${ep.number}`}
                </h4>
                {ep.synopsis && (
                  <p className="text-[11px] text-[#707070] line-clamp-2 mt-1 leading-snug">
                    {ep.synopsis}
                  </p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
