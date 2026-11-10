'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Search,
  SlidersHorizontal,
  Loader2,
  Lock,
  Sparkles,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { HoshikaAnimeItem } from '@/types/anime';
import {
  AnimeArtworkFirestoreDoc,
  listAllAnimeArtworkOverrides,
} from '@/lib/admin/admin-firestore';
import { getAdminAuthHeaders } from '@/lib/admin/admin-auth';

export default function AdminArtworkCataloguePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HoshikaAnimeItem[]>([]);
  const [searching, setSearching] = useState(false);

  const [overrides, setOverrides] = useState<AnimeArtworkFirestoreDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<'all' | 'manual' | 'custom' | 'auto'>(
    'all'
  );

  const loadCatalogue = useCallback(async () => {
    setLoading(true);
    try {
      const saved = await listAllAnimeArtworkOverrides().catch(() => []);
      const headers = await getAdminAuthHeaders();
      const scanRes = await fetch('/api/admin/artwork', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'scan_catalogue', limit: 24 }),
      });

      const merged = new Map<number, AnimeArtworkFirestoreDoc>();
      if (scanRes.ok) {
        const data = await scanRes.json();
        for (const item of data.results || []) {
          merged.set(item.hoshikaId, item);
        }
      }
      for (const ov of saved) {
        merged.set(ov.hoshikaId, ov);
      }
      setOverrides(Array.from(merged.values()));
    } catch (error) {
      console.error('Failed to load artwork catalogue:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalogue();
  }, [loadCatalogue]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(
            (data.results || []).filter((item: HoshikaAnimeItem) =>
              Boolean(item?.shortId)
            )
          );
        }
      } catch {
        // Ignore search error
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredOverrides = overrides.filter((item) => {
    if (filterMode === 'manual') return item.selectionMode === 'manual';
    if (filterMode === 'custom')
      return (
        item.selectedLogoSource === 'custom_upload' ||
        (item.customLogos && item.customLogos.length > 0)
      );
    if (filterMode === 'auto') return item.selectionMode === 'auto';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header & Search Bar */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-black text-white">
              Anime Artwork & Transparent Logo Manager
            </h2>
            <p className="text-xs text-[#A0A0A0] mt-0.5">
              Inspect Fanart.tv HDTVLogo & ClearLogo candidates, upload custom transparent PNG/WebP logos to Firebase Storage, and lock manual overrides.
            </p>
          </div>

          <button
            type="button"
            onClick={loadCatalogue}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh Catalogue</span>
          </button>
        </div>

        {/* Search Input + Filter Tabs */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-3 text-[#707070]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search any anime by title to manage its Fanart.tv or custom logo..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs sm:text-sm text-white placeholder-[#707070] focus:outline-none"
            />
            {searching && (
              <Loader2
                size={15}
                className="absolute right-3.5 top-3 animate-spin text-white"
              />
            )}
          </div>

          <div className="inline-flex rounded-xl bg-[#141414] border border-[#292929] p-1 text-xs">
            {(
              [
                { id: 'all', label: 'All Anime' },
                { id: 'manual', label: 'Manual Locks' },
                { id: 'custom', label: 'Custom Uploads' },
                { id: 'auto', label: 'Auto Priority' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterMode(tab.id)}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                  filterMode === tab.id
                    ? 'bg-white text-black font-bold'
                    : 'text-[#A0A0A0] hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Live Search Results Dropdown/Grid */}
        {searchQuery.trim() && (
          <div className="pt-2 border-t border-[#292929] space-y-2.5">
            <div className="text-xs font-mono uppercase text-[#A0A0A0]">
              Hoshika Search Results ({searchResults.length})
            </div>
            {searchResults.length === 0 && !searching ? (
              <div className="text-xs text-[#707070] py-2">
                No anime series matched &ldquo;{searchQuery}&rdquo;.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {searchResults.slice(0, 9).map((anime) => {
                  const title =
                    anime.titleEnglish ||
                    anime.titleRomaji ||
                    anime.titleLocalized ||
                    `Anime #${anime.shortId}`;
                  return (
                    <Link
                      key={anime.shortId}
                      href={`/admin/artwork/${anime.shortId}`}
                      className="p-3 rounded-xl bg-[#141414] border border-[#292929] hover:border-white flex items-center justify-between gap-3 transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {anime.coverImage && (
                          <div className="w-10 h-14 rounded-lg overflow-hidden relative shrink-0 border border-[#292929]">
                            <Image
                              src={anime.coverImage}
                              alt={title}
                              fill
                              sizes="48px"
                              className="object-cover"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">
                            {title}
                          </div>
                          <div className="text-[11px] font-mono text-[#707070]">
                            ID: {anime.shortId} • {anime.format || 'TV'}
                          </div>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-white text-black font-bold text-xs shrink-0">
                        Manage
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Catalogue Artwork Grid */}
      {loading ? (
        <div className="p-12 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col items-center justify-center space-y-3">
          <Loader2 size={24} className="animate-spin text-white" />
          <div className="text-xs font-mono uppercase tracking-wider text-[#A0A0A0]">
            Loading Anime Artwork Overrides & Fanart.tv Candidates...
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredOverrides.map((item) => (
            <div
              key={item.hoshikaId}
              className="bg-[#0A0A0A] border border-[#292929] hover:border-white/50 rounded-xl p-4 flex flex-col justify-between gap-4 transition-all"
            >
              <div className="space-y-3">
                {/* Card Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-white truncate">
                      {item.title}
                    </h3>
                    <div className="text-[11px] font-mono text-[#707070] tabular-nums">
                      Hoshika #{item.hoshikaId} • TVDB #{item.tvdbId || 'N/A'} •{' '}
                      {(item.availableLogos || []).length} Fanart Logos
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase shrink-0 inline-flex items-center gap-1 ${
                      item.selectionMode === 'manual'
                        ? 'bg-white text-black'
                        : 'bg-[#141414] text-white border border-[#292929]'
                    }`}
                  >
                    {item.selectionMode === 'manual' ? (
                      <>
                        <Lock size={10} /> MANUAL
                      </>
                    ) : (
                      <>
                        <Sparkles size={10} /> AUTO
                      </>
                    )}
                  </span>
                </div>

                {/* Transparent Logo Canvas */}
                <div className="relative h-28 w-full rounded-xl bg-[#050505] border border-[#292929] flex items-center justify-center p-4 overflow-hidden">
                  {item.selectedLogoUrl ? (
                    <Image
                      src={item.selectedLogoUrl}
                      alt={item.title}
                      fill
                      sizes="320px"
                      className="object-contain p-3"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="text-center">
                      <div className="text-base font-black text-white/90 truncate px-2">
                        {item.title}
                      </div>
                      <div className="text-[10px] font-mono text-[#707070] uppercase mt-0.5">
                        Typography Fallback
                      </div>
                    </div>
                  )}
                </div>

                {/* Metadata Badges */}
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                  <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#292929] text-white uppercase">
                    {item.selectedLogoSource}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#292929] text-[#A0A0A0] uppercase">
                    LANG: {item.selectedLogoLanguage || 'EN'}
                  </span>
                  {item.customLogos && item.customLogos.length > 0 && (
                    <span className="px-2 py-0.5 rounded bg-white text-black font-bold uppercase">
                      {item.customLogos.length} Custom Upload
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-[#292929]">
                <Link
                  href={`/admin/artwork/${item.hoshikaId}`}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-white text-black hover:bg-neutral-200 text-xs font-bold transition-colors"
                >
                  <SlidersHorizontal size={13} />
                  <span>Manage Logos & Preview</span>
                </Link>
                <Link
                  href={`/anime/${item.hoshikaId}`}
                  className="p-2 rounded-lg bg-[#141414] border border-[#292929] text-[#A0A0A0] hover:text-white hover:border-white transition-colors"
                  title="View live anime details page"
                >
                  <ExternalLink size={14} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
