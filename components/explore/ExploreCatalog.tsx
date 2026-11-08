'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimeGrid } from '@/components/anime/AnimeGrid';
import { HoshikaAnimeItem } from '@/types/anime';
import { Filter, Search, RotateCcw } from 'lucide-react';

interface ExploreCatalogProps {
  initialItems: HoshikaAnimeItem[];
  genres: string[];
}

export function ExploreCatalog({ initialItems, genres }: ExploreCatalogProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [items, setItems] = useState<HoshikaAnimeItem[]>(initialItems);
  const [isLoading, setIsLoading] = useState(false);

  const [selectedGenre, setSelectedGenre] = useState(searchParams.get('genre') || '');
  const [selectedFormat, setSelectedFormat] = useState(searchParams.get('format') || '');
  const [selectedStatus, setSelectedStatus] = useState(searchParams.get('status') || '');
  const [selectedSort, setSelectedSort] = useState(searchParams.get('sort') || 'top');
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');

  const formats = ['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL'];
  const statuses = [
    { label: 'Completed', value: 'FINISHED' },
    { label: 'Currently Airing', value: 'RELEASING' },
    { label: 'Not Yet Aired', value: 'NOT_YET_RELEASED' },
  ];
  const sortOptions = [
    { label: 'Top Rated', value: 'top' },
    { label: 'Trending', value: 'trending' },
    { label: 'Recently Added', value: 'recent' },
  ];

  const fetchFilteredData = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.append('q', searchQuery.trim());
      if (selectedGenre) params.append('genre', selectedGenre);
      if (selectedFormat) params.append('format', selectedFormat);
      if (selectedStatus) params.append('status', selectedStatus);
      if (selectedSort) params.append('sort', selectedSort);

      const res = await fetch(`/api/catalog?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load catalogue');
      const data = await res.json();
      setItems(data.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, selectedGenre, selectedFormat, selectedStatus, selectedSort]);

  useEffect(() => {
    fetchFilteredData();
  }, [fetchFilteredData]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchFilteredData();
  };

  const handleResetFilters = () => {
    setSelectedGenre('');
    setSelectedFormat('');
    setSelectedStatus('');
    setSelectedSort('top');
    setSearchQuery('');
  };

  return (
    <div className="space-y-6">
      {/* Filters Toolbar */}
      <div className="p-4 md:p-6 bg-[#0A0A0A] border border-[#292929] rounded-2xl space-y-4">
        {/* Search bar inside toolbar */}
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#707070]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter titles..."
              className="w-full h-10 pl-10 pr-4 bg-[#141414] text-white placeholder-[#707070] text-sm rounded-xl border border-[#292929] focus:outline-none focus:border-white transition-colors"
            />
          </div>
          <button
            type="submit"
            className="px-5 h-10 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors"
          >
            Apply
          </button>
          {(selectedGenre || selectedFormat || selectedStatus || searchQuery || selectedSort !== 'top') && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="px-3 h-10 rounded-xl border border-[#292929] text-[#A0A0A0] hover:text-white hover:border-[#404040] transition-colors"
              title="Reset all filters"
            >
              <RotateCcw size={16} />
            </button>
          )}
        </form>

        {/* Filter Dropdowns Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {/* Genre */}
          <div>
            <label className="block text-[#707070] font-medium mb-1 uppercase tracking-wider text-[10px]">
              Genre
            </label>
            <select
              value={selectedGenre}
              onChange={(e) => setSelectedGenre(e.target.value)}
              className="w-full h-9 px-3 bg-[#141414] text-white border border-[#292929] rounded-lg focus:outline-none focus:border-white"
            >
              <option value="">All Genres</option>
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          {/* Format */}
          <div>
            <label className="block text-[#707070] font-medium mb-1 uppercase tracking-wider text-[10px]">
              Format
            </label>
            <select
              value={selectedFormat}
              onChange={(e) => setSelectedFormat(e.target.value)}
              className="w-full h-9 px-3 bg-[#141414] text-white border border-[#292929] rounded-lg focus:outline-none focus:border-white"
            >
              <option value="">All Formats</option>
              {formats.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-[#707070] font-medium mb-1 uppercase tracking-wider text-[10px]">
              Status
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full h-9 px-3 bg-[#141414] text-white border border-[#292929] rounded-lg focus:outline-none focus:border-white"
            >
              <option value="">All Statuses</option>
              {statuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Sort */}
          <div>
            <label className="block text-[#707070] font-medium mb-1 uppercase tracking-wider text-[10px]">
              Sort By
            </label>
            <select
              value={selectedSort}
              onChange={(e) => setSelectedSort(e.target.value)}
              className="w-full h-9 px-3 bg-[#141414] text-white border border-[#292929] rounded-lg focus:outline-none focus:border-white"
            >
              {sortOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between text-xs text-[#A0A0A0] px-1">
        <span>Showing {items.length} titles</span>
        {isLoading && <span className="text-white animate-pulse">Updating catalog...</span>}
      </div>

      {/* Anime Grid */}
      <AnimeGrid
        animeList={items}
        isLoading={isLoading}
        emptyMessage="No titles match the selected criteria."
      />
    </div>
  );
}
