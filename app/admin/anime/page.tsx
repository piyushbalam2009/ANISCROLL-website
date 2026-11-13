'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Film,
  Search,
  RefreshCw,
  Loader2,
  ExternalLink,
  SlidersHorizontal,
  ListVideo,
  LayoutTemplate,
  X,
  CheckCircle2,
  Radio,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getAdminAuthHeaders, hasAdminPermission } from '@/lib/admin/admin-auth';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { AdminPagination } from '@/components/admin/ui/AdminPagination';
import { AdminStatusBadge } from '@/components/admin/ui/AdminStatusBadge';
import { HoshikaAnimeItem, HoshikaEpisodeItem } from '@/types/anime';

interface AdminCatalogItem extends HoshikaAnimeItem {
  streamProvider: 'megaplay' | 'zokoanime';
  artworkStatus: {
    logoStatus: string;
    selectionMode: string;
    selectedLogoUrl: string;
    reviewed: boolean;
  } | null;
}

interface AnimeDetailPayload {
  anime: HoshikaAnimeItem;
  idMap: Record<string, any> | null;
  provider: 'megaplay' | 'zokoanime';
  episodesTotal: number;
  episodesSample: HoshikaEpisodeItem[];
  artworkOverride: Record<string, any> | null;
}

export default function AdminAnimeCataloguePage() {
  const { adminRecord } = useAuth();
  const canManage = hasAdminPermission(adminRecord, 'manageAnime');

  const [items, setItems] = useState<AdminCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [format, setFormat] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('popularity');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const [selectedDetail, setSelectedDetail] = useState<AnimeDetailPayload | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 320);
    return () => clearTimeout(timer);
  }, [q]);

  const loadCatalog = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAdminAuthHeaders();
      const params = new URLSearchParams();
      if (debouncedQ) params.set('q', debouncedQ);
      if (format) params.set('format', format);
      if (status) params.set('status', status);
      if (sort) params.set('sort', sort);
      params.set('page', String(page));
      if (forceRefresh) params.set('refresh', 'true');

      const res = await fetch(`/api/admin/anime?${params.toString()}`, { headers });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Failed to load catalogue (${res.status})`);
      }
      setItems(data.items || []);
      setTotalPages(data.totalPages || 1);
      setTotalItems(data.totalItems || (data.items || []).length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load anime catalogue.');
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, format, status, sort, page]);

  useEffect(() => {
    loadCatalog(false);
  }, [loadCatalog]);

  const openInspector = async (hoshikaId: number, refresh = false) => {
    setLoadingDetail(true);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch(
        `/api/admin/anime?hoshikaId=${hoshikaId}${refresh ? '&refresh=true' : ''}`,
        { headers }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to inspect anime');
      }
      setSelectedDetail(data as AnimeDetailPayload);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load anime details.');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleRefreshAnimeCache = async (hoshikaId: number) => {
    if (!canManage) return;
    setRefreshingId(hoshikaId);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/anime', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'refresh_anime', hoshikaId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Refresh failed');
      }
      showToast(`Invalidated cache & refreshed metadata for Anime #${hoshikaId}.`);
      await loadCatalog(false);
      if (selectedDetail?.anime?.shortId === hoshikaId) {
        await openInspector(hoshikaId, false);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to refresh anime.');
    } finally {
      setRefreshingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-white text-black font-bold text-xs shadow-2xl flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>{toast}</span>
        </div>
      )}

      {/* Header */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
            <Film size={20} />
            <span>Anime Catalogue Manager</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Search, filter, inspect provider routing (MegaPlay for Series, ZokoAnime for Movies), and refresh metadata cache.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/homepage"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white transition-colors"
          >
            <LayoutTemplate size={14} />
            <span>Homepage Curation</span>
          </Link>
          <button
            type="button"
            onClick={() => loadCatalog(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-black hover:bg-neutral-200 text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh Feed</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="relative lg:col-span-2">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#707070]" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search anime title or keyword..."
            aria-label="Search anime catalogue"
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs text-white placeholder-[#707070] focus:outline-none"
          />
        </div>

        <select
          value={format}
          onChange={(e) => {
            setFormat(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by format"
          className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none"
        >
          <option value="">All Formats</option>
          <option value="TV">TV Series</option>
          <option value="MOVIE">Movie</option>
          <option value="OVA">OVA</option>
          <option value="ONA">ONA</option>
          <option value="SPECIAL">Special</option>
          <option value="TV_SHORT">TV Short</option>
        </select>

        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by airing status"
          className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="RELEASING">Releasing</option>
          <option value="FINISHED">Finished</option>
          <option value="NOT_YET_RELEASED">Upcoming</option>
        </select>

        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
          aria-label="Sort catalogue"
          className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none"
        >
          <option value="popularity">Sort: Popularity</option>
          <option value="trending">Sort: Trending</option>
          <option value="score">Sort: Highest Score</option>
          <option value="updated">Sort: Recently Updated</option>
        </select>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200">
          {error}
        </div>
      )}

      {/* Catalogue Table */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <Loader2 size={24} className="animate-spin text-white" />
            <div className="text-xs font-mono uppercase tracking-wider text-[#A0A0A0]">
              Querying Hoshika Catalogue...
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-xs text-[#A0A0A0]">
            No anime matched the current catalogue filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#292929] bg-[#141414]/60 text-[11px] font-mono uppercase text-[#A0A0A0]">
                  <th className="py-3 px-4">Anime</th>
                  <th className="py-3 px-4">Format & Status</th>
                  <th className="py-3 px-4">Stream Router</th>
                  <th className="py-3 px-4">Artwork Override</th>
                  <th className="py-3 px-4">Score / Eps</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#292929]">
                {items.map((anime) => {
                  const title =
                    anime.titleEnglish ||
                    anime.titleRomaji ||
                    anime.titleLocalized ||
                    `Anime #${anime.shortId}`;
                  return (
                    <tr
                      key={anime.shortId}
                      className="hover:bg-[#141414]/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3 min-w-[220px]">
                          <div className="w-10 h-14 rounded-lg overflow-hidden relative bg-[#141414] border border-[#292929] shrink-0">
                            <ResilientImage
                              src={anime.coverImage}
                              alt={title}
                              fill
                              sizes="44px"
                              className="object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => openInspector(anime.shortId)}
                              className="font-bold text-white hover:underline text-left truncate block max-w-[260px] cursor-pointer"
                            >
                              {title}
                            </button>
                            <div className="text-[11px] font-mono text-[#707070] tabular-nums">
                              Hoshika #{anime.shortId}
                              {anime.anilistId ? ` · AL #${anime.anilistId}` : ''}
                              {anime.seasonYear ? ` · ${anime.seasonYear}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#292929] font-mono text-[10px] text-white uppercase">
                            {anime.format || 'TV'}
                          </span>
                          <span className="text-[11px] font-mono text-[#A0A0A0]">
                            {anime.status || 'UNKNOWN'}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <AdminStatusBadge
                          tone={anime.streamProvider === 'megaplay' ? 'info' : 'operational'}
                          label={anime.streamProvider.toUpperCase()}
                        />
                      </td>

                      <td className="py-3 px-4">
                        {anime.artworkStatus ? (
                          <div className="flex items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded bg-white text-black font-mono text-[10px] font-bold uppercase">
                              {anime.artworkStatus.selectionMode}
                            </span>
                            <span className="text-[11px] font-mono text-[#A0A0A0]">
                              {anime.artworkStatus.logoStatus}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] font-mono text-[#707070]">
                            Auto Fanart
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 font-mono text-[11px] text-white tabular-nums">
                        <div>{anime.averageScore ? `${anime.averageScore}%` : '—'}</div>
                        <div className="text-[#707070]">
                          {anime.episodes ? `${anime.episodes} eps` : 'Ongoing'}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openInspector(anime.shortId)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-xs text-white font-semibold cursor-pointer"
                          >
                            Inspect
                          </button>
                          <Link
                            href={`/admin/episodes?hoshikaId=${anime.shortId}`}
                            className="p-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-[#A0A0A0] hover:text-white"
                            title="Inspect Episodes"
                            aria-label={`Inspect episodes for ${title}`}
                          >
                            <ListVideo size={14} />
                          </Link>
                          <Link
                            href={`/admin/artwork/${anime.shortId}`}
                            className="p-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-[#A0A0A0] hover:text-white"
                            title="Artwork Studio"
                            aria-label={`Manage artwork for ${title}`}
                          >
                            <SlidersHorizontal size={14} />
                          </Link>
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => handleRefreshAnimeCache(anime.shortId)}
                              disabled={refreshingId === anime.shortId}
                              className="p-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-[#A0A0A0] hover:text-white cursor-pointer disabled:opacity-50"
                              title="Refresh Metadata & Cache"
                              aria-label={`Refresh cache for ${title}`}
                            >
                              <RefreshCw
                                size={14}
                                className={
                                  refreshingId === anime.shortId ? 'animate-spin' : ''
                                }
                              />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AdminPagination
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        pageSize={30}
        onPageChange={(next) => setPage(next)}
      />

      {/* Detail Inspection Modal / Drawer */}
      {(loadingDetail || selectedDetail) && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => !loadingDetail && setSelectedDetail(null)}
        >
          <div
            className="w-full max-w-xl h-full overflow-y-auto bg-[#0A0A0A] border-l border-[#292929] p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#292929] pb-4">
              <div>
                <div className="text-[11px] font-mono uppercase text-[#707070]">
                  Catalogue Inspector
                </div>
                <h3 className="text-base font-bold text-white">
                  {selectedDetail?.anime?.titleEnglish ||
                    selectedDetail?.anime?.titleRomaji ||
                    'Loading Anime...'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDetail(null)}
                className="p-2 rounded-lg bg-[#141414] border border-[#292929] text-[#A0A0A0] hover:text-white cursor-pointer"
                aria-label="Close anime inspector"
              >
                <X size={16} />
              </button>
            </div>

            {loadingDetail ? (
              <div className="py-12 flex justify-center">
                <Loader2 size={24} className="animate-spin text-white" />
              </div>
            ) : selectedDetail ? (
              <div className="space-y-5 text-xs">
                <div className="flex gap-4">
                  <div className="relative w-24 h-36 rounded-xl overflow-hidden bg-[#141414] border border-[#292929] shrink-0">
                    <ResilientImage
                      src={selectedDetail.anime.coverImage}
                      alt={selectedDetail.anime.titleEnglish || 'Cover'}
                      fill
                      sizes="96px"
                      className="object-cover"
                    />
                  </div>
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="px-2 py-0.5 rounded bg-white text-black font-mono text-[10px] font-bold uppercase">
                        {selectedDetail.anime.format || 'TV'}
                      </span>
                      <AdminStatusBadge
                        tone="info"
                        label={`STREAM: ${selectedDetail.provider.toUpperCase()}`}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-[#A0A0A0] pt-1">
                      <div>Hoshika: #{selectedDetail.anime.shortId}</div>
                      <div>
                        AniList: #{selectedDetail.idMap?.aniListId || selectedDetail.anime.anilistId || '—'}
                      </div>
                      <div>
                        MAL: #{selectedDetail.idMap?.malId || selectedDetail.anime.malId || '—'}
                      </div>
                      <div>TVDB: #{selectedDetail.idMap?.tvdbId || '—'}</div>
                    </div>
                    <div className="text-[#A0A0A0] line-clamp-3">
                      {selectedDetail.anime.synopsis || 'No synopsis available.'}
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono uppercase text-[11px] text-[#A0A0A0] flex items-center gap-1.5">
                      <Radio size={13} />
                      <span>Provider Routing & Episodes</span>
                    </span>
                    <span className="font-mono text-white font-bold">
                      {selectedDetail.episodesTotal} total episodes
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-[#707070]">
                    Routed to{' '}
                    <span className="text-white font-bold">
                      {selectedDetail.provider}
                    </span>{' '}
                    based on format ({selectedDetail.anime.format || 'UNKNOWN'}).
                  </div>
                </div>

                {selectedDetail.episodesSample.length > 0 && (
                  <div className="space-y-2">
                    <div className="font-mono uppercase text-[11px] text-[#707070]">
                      First {selectedDetail.episodesSample.length} Episodes Sample
                    </div>
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {selectedDetail.episodesSample.map((ep) => (
                        <div
                          key={ep.number}
                          className="p-2.5 rounded-lg bg-[#141414] border border-[#292929] flex items-center justify-between gap-2"
                        >
                          <span className="text-white truncate">
                            Ep {ep.number}: {ep.title || `Episode ${ep.number}`}
                          </span>
                          <span className="font-mono text-[10px] text-[#707070] shrink-0">
                            {ep.filler ? 'FILLER' : ep.recap ? 'RECAP' : 'CANON'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#292929]">
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => handleRefreshAnimeCache(selectedDetail.anime.shortId)}
                      disabled={refreshingId === selectedDetail.anime.shortId}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-black font-bold cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw
                        size={13}
                        className={
                          refreshingId === selectedDetail.anime.shortId
                            ? 'animate-spin'
                            : ''
                        }
                      />
                      <span>Refresh Metadata & Cache</span>
                    </button>
                  )}
                  <Link
                    href={`/admin/episodes?hoshikaId=${selectedDetail.anime.shortId}`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-white font-semibold"
                  >
                    <ListVideo size={13} />
                    <span>Episode Inspector</span>
                  </Link>
                  <Link
                    href={`/admin/artwork/${selectedDetail.anime.shortId}`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-white font-semibold"
                  >
                    <SlidersHorizontal size={13} />
                    <span>Artwork Studio</span>
                  </Link>
                  <Link
                    href={`/anime/${selectedDetail.anime.shortId}`}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-[#A0A0A0] hover:text-white"
                  >
                    <ExternalLink size={13} />
                    <span>Public Page</span>
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
