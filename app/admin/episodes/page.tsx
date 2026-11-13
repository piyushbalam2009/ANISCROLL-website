'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Film,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Code2,
  ChevronDown,
  ChevronUp,
  Tv,
} from 'lucide-react';
import { getAdminAuthHeaders } from '@/lib/admin/admin-auth';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { HoshikaAnimeItem, HoshikaEpisodeItem } from '@/types/anime';
import { AdminStatusBadge } from '@/components/admin/ui/AdminStatusBadge';
import { AdminKpiCard } from '@/components/admin/ui/AdminKpiCard';

interface EpisodeInspectorResponse {
  ok: boolean;
  anime: {
    shortId: number;
    title: string;
    format: string;
    status: string;
    coverImage: string;
    anilistId: number | null;
    malId: number | null;
    provider: 'megaplay' | 'zokoanime';
    sampleStreamEndpoint: string | null;
  };
  stats: {
    totalReported: number;
    loadedCount: number;
    missingThumbnailCount: number;
    fillerCount: number;
    recapCount: number;
  };
  audioAvailability: {
    subCount?: number;
    dubCount?: number;
    hasSub?: boolean;
    hasDub?: boolean;
  } | null;
  episodes: HoshikaEpisodeItem[];
  sanitizedPayloadPreview: unknown;
}

function AdminEpisodesContent() {
  const searchParams = useSearchParams();
  const initialId = searchParams.get('hoshikaId') || '';

  const [hoshikaIdInput, setHoshikaIdInput] = useState(initialId);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HoshikaAnimeItem[]>([]);
  const [searching, setSearching] = useState(false);

  const [inspector, setInspector] = useState<EpisodeInspectorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [checkAudio, setCheckAudio] = useState(true);
  const [showRawPreview, setShowRawPreview] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const inspectAnimeEpisodes = useCallback(
    async (targetId: string, forceRefresh = false) => {
      const parsed = parseInt(targetId, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return;

      setLoading(true);
      setErrorMsg(null);
      try {
        const headers = await getAdminAuthHeaders();
        const params = new URLSearchParams({
          hoshikaId: String(parsed),
          checkAudio: String(checkAudio),
        });
        if (forceRefresh) {
          params.set('refresh', 'true');
        }
        const res = await fetch(`/api/admin/episodes?${params.toString()}`, {
          headers,
          cache: 'no-store',
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || `Failed to inspect episodes (${res.status})`);
        }
        setInspector(data as EpisodeInspectorResponse);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Episode inspection failed');
      } finally {
        setLoading(false);
      }
    },
    [checkAudio]
  );

  useEffect(() => {
    if (initialId) {
      inspectAnimeEpisodes(initialId, false);
    }
  }, [initialId, inspectAnimeEpisodes]);

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
            (data.results || []).filter((x: HoshikaAnimeItem) => Boolean(x?.shortId))
          );
        }
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleRefreshEpisodesCache = async () => {
    if (!inspector?.anime?.shortId) return;
    setRefreshing(true);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/episodes', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'refresh_episodes',
          hoshikaId: inspector.anime.shortId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to refresh episode cache');
      }
      await inspectAnimeEpisodes(String(inspector.anime.shortId), false);
      showToast(`Refreshed ${data.loadedCount} episodes for Anime #${inspector.anime.shortId}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Episode refresh failed');
    } finally {
      setRefreshing(false);
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

      {/* Header & Picker */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-[#707070]">
            Episode Metadata, Thumbnail &amp; Audio Diagnostics
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2 mt-0.5">
            <Film size={19} />
            <span>Episodes &amp; Stream Availability Inspector</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Direct Hoshika ID input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              inspectAnimeEpisodes(hoshikaIdInput, false);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="number"
              min={1}
              value={hoshikaIdInput}
              onChange={(e) => setHoshikaIdInput(e.target.value)}
              placeholder="Enter Hoshika ID (e.g. 16498 or 21)..."
              className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs text-white font-mono placeholder-[#707070] focus:outline-none"
            />
            <label className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#A0A0A0] px-2 cursor-pointer">
              <input
                type="checkbox"
                checked={checkAudio}
                onChange={(e) => setCheckAudio(e.target.checked)}
                className="accent-white"
              />
              <span>Sub/Dub</span>
            </label>
            <button
              type="submit"
              disabled={loading || !hoshikaIdInput}
              className="px-4 py-2.5 rounded-xl bg-white text-black hover:bg-neutral-200 text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              Inspect
            </button>
          </form>

          {/* Search Picker */}
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-3 text-[#707070]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Or search anime by title to inspect its episodes..."
              className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs text-white placeholder-[#707070] focus:outline-none"
            />
            {searching && (
              <Loader2 size={14} className="absolute right-3.5 top-3 animate-spin text-white" />
            )}
          </div>
        </div>

        {searchQuery.trim() && searchResults.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2 border-t border-[#292929]">
            {searchResults.slice(0, 6).map((item) => {
              const label =
                item.titleEnglish || item.titleRomaji || `Anime #${item.shortId}`;
              return (
                <button
                  key={item.shortId}
                  type="button"
                  onClick={() => {
                    setHoshikaIdInput(String(item.shortId));
                    setSearchQuery('');
                    inspectAnimeEpisodes(String(item.shortId), false);
                  }}
                  className="p-2.5 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-left flex items-center gap-2.5 cursor-pointer"
                >
                  {item.coverImage && (
                    <div className="w-8 h-11 rounded relative overflow-hidden shrink-0 border border-[#292929]">
                      <ResilientImage
                        src={item.coverImage}
                        alt={label}
                        fill
                        sizes="40px"
                        className="object-cover"
                      />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">{label}</div>
                    <div className="text-[10px] font-mono text-[#707070]">
                      #{item.shortId} · {item.format || 'TV'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="p-12 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin text-white" />
          <div className="text-xs font-mono text-[#A0A0A0]">
            Resolving Hoshika Episodes, External IDs &amp; Audio Availability...
          </div>
        </div>
      ) : !inspector ? (
        <div className="p-12 rounded-2xl bg-[#0A0A0A] border border-[#292929] text-center space-y-2">
          <div className="text-sm font-bold text-white">Select an Anime to Inspect</div>
          <p className="text-xs text-[#A0A0A0]">
            Enter a Hoshika ID or search above to audit episodes, missing thumbnails, filler flags, and Sub/Dub availability.
          </p>
        </div>
      ) : (
        <>
          {/* Anime Header Card */}
          <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              {inspector.anime.coverImage && (
                <div className="w-14 h-20 rounded-lg overflow-hidden relative shrink-0 border border-[#292929]">
                  <ResilientImage
                    src={inspector.anime.coverImage}
                    alt={inspector.anime.title}
                    fill
                    sizes="64px"
                    className="object-cover"
                  />
                </div>
              )}
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold text-white truncate">
                    {inspector.anime.title}
                  </h3>
                  <AdminStatusBadge
                    tone="operational"
                    label={
                      inspector.anime.provider === 'zokoanime'
                        ? 'ZokoAnime (Movie)'
                        : 'MegaPlay (Series)'
                    }
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-[#A0A0A0] tabular-nums">
                  <span>Hoshika #{inspector.anime.shortId}</span>
                  <span>AniList #{inspector.anime.anilistId ?? '—'}</span>
                  <span>MAL #{inspector.anime.malId ?? '—'}</span>
                  <span>Format: {inspector.anime.format}</span>
                  <span>Status: {inspector.anime.status}</span>
                </div>
                {inspector.anime.sampleStreamEndpoint && (
                  <div className="text-[11px] font-mono text-[#707070] truncate">
                    Sample Route: {inspector.anime.sampleStreamEndpoint}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Link
                href={`/watch/${inspector.anime.shortId}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs text-white font-semibold"
              >
                <ExternalLink size={13} />
                <span>Open Watch Page</span>
              </Link>
              <button
                type="button"
                onClick={handleRefreshEpisodesCache}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-black hover:bg-neutral-200 text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
                <span>Refresh Episodes</span>
              </button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <AdminKpiCard
              label="Loaded / Reported"
              value={`${inspector.stats.loadedCount} / ${inspector.stats.totalReported}`}
              sublabel="Episodes indexed"
              icon={Film}
            />
            <AdminKpiCard
              label="Missing Thumbnails"
              value={inspector.stats.missingThumbnailCount}
              sublabel="Episodes without preview image"
              icon={AlertTriangle}
              statusTone={inspector.stats.missingThumbnailCount > 0 ? 'warn' : 'good'}
            />
            <AdminKpiCard
              label="Filler / Recap"
              value={`${inspector.stats.fillerCount} / ${inspector.stats.recapCount}`}
              sublabel="Tagged episodes"
              icon={Tv}
            />
            <AdminKpiCard
              label="Sub / Dub Availability"
              value={
                inspector.audioAvailability
                  ? `Sub ${inspector.audioAvailability.subCount ?? 0} · Dub ${
                      inspector.audioAvailability.dubCount ?? 0
                    }`
                  : 'Not checked'
              }
              sublabel={
                inspector.audioAvailability
                  ? `Has Sub: ${inspector.audioAvailability.hasSub ? 'Yes' : 'No'} · Has Dub: ${
                      inspector.audioAvailability.hasDub ? 'Yes' : 'No'
                    }`
                  : 'Enable Sub/Dub probe above'
              }
              icon={CheckCircle2}
            />
          </div>

          {/* Episodes Table */}
          <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#292929] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                Episode Catalogue ({inspector.episodes.length})
              </h3>
            </div>
            {inspector.episodes.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#707070]">
                No episodes returned by upstream provider.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="sticky top-0 bg-[#141414] z-10">
                    <tr className="border-b border-[#292929] text-[11px] font-mono uppercase text-[#707070]">
                      <th className="py-2.5 px-4">Ep #</th>
                      <th className="py-2.5 px-4">Thumbnail</th>
                      <th className="py-2.5 px-4">Title</th>
                      <th className="py-2.5 px-4">Flags</th>
                      <th className="py-2.5 px-4 text-right">Aired</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#292929]">
                    {inspector.episodes.map((ep) => (
                      <tr key={`${ep.number}-${ep.id || ''}`} className="hover:bg-[#141414]/40">
                        <td className="py-2.5 px-4 font-mono font-bold text-white tabular-nums">
                          #{ep.number}
                        </td>
                        <td className="py-2.5 px-4">
                          {ep.thumbnail ? (
                            <div className="w-20 h-11 rounded-md overflow-hidden relative border border-[#292929]">
                              <ResilientImage
                                src={ep.thumbnail}
                                alt={ep.title || `Episode ${ep.number}`}
                                fill
                                sizes="96px"
                                className="object-cover"
                              />
                            </div>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono text-[10px]">
                              MISSING
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-white font-medium max-w-[320px] truncate">
                          {ep.title || `Episode ${ep.number}`}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-1.5 font-mono text-[10px]">
                            {ep.filler && (
                              <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 uppercase">
                                Filler
                              </span>
                            )}
                            {ep.recap && (
                              <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#292929] text-[#A0A0A0] uppercase">
                                Recap
                              </span>
                            )}
                            {!ep.filler && !ep.recap && (
                              <span className="text-[#707070]">Canon</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-[11px] text-[#707070]">
                          {ep.aired || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Collapsible Sanitized Payload Preview */}
          <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowRawPreview((v) => !v)}
              className="w-full px-5 py-3.5 flex items-center justify-between text-xs font-mono text-white hover:bg-[#141414]/40 cursor-pointer"
            >
              <span className="inline-flex items-center gap-2 font-semibold">
                <Code2 size={14} />
                <span>Redacted Diagnostic Payload Preview</span>
              </span>
              {showRawPreview ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {showRawPreview && (
              <pre className="p-4 border-t border-[#292929] bg-[#050505] text-[11px] font-mono text-[#A0A0A0] overflow-x-auto max-h-80">
                {JSON.stringify(inspector.sanitizedPayloadPreview, null, 2)}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminEpisodesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex justify-center">
          <Loader2 size={24} className="animate-spin text-white" />
        </div>
      }
    >
      <AdminEpisodesContent />
    </Suspense>
  );
}
