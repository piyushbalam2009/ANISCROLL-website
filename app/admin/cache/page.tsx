'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  RefreshCw,
  Trash2,
  Loader2,
  CheckCircle2,
  Zap,
  Layers,
  Image as ImageIcon,
} from 'lucide-react';
import { getAdminAuthHeaders } from '@/lib/admin/admin-auth';
import { AdminKpiCard } from '@/components/admin/ui/AdminKpiCard';
import { AdminConfirmModal } from '@/components/admin/ui/AdminConfirmModal';

interface CacheDiagnosticEvent {
  id: string;
  key: string;
  status: string;
  timestamp: string;
  ageMs?: number;
}

interface CacheResponse {
  ok: boolean;
  stats: {
    size: number;
    hits: number;
    staleHits: number;
    misses: number;
    evictions: number;
    inflightCoalesced?: number;
  };
  hitRatePct: number;
  inFlightCount: number;
  artworkCache: {
    resolvedSize: number;
    overrideSize: number;
  };
  diagnostics: CacheDiagnosticEvent[];
}

export default function AdminCacheControlPage() {
  const [data, setData] = useState<CacheResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [purgingScope, setPurgingScope] = useState<string | null>(null);
  const [hoshikaIdInput, setHoshikaIdInput] = useState('');
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadCacheStats = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/cache', { headers, cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Failed to load cache stats (${res.status})`);
      }
      setData(json as CacheResponse);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load cache stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCacheStats();
  }, [loadCacheStats]);

  const purgeScope = async (scope: 'all' | 'artwork' | 'catalog' | 'anime' | 'episodes') => {
    setPurgingScope(scope);
    setErrorMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      const parsedId = parseInt(hoshikaIdInput, 10);
      const res = await fetch('/api/admin/cache', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          scope,
          ...(Number.isFinite(parsedId) && parsedId > 0 ? { hoshikaId: parsedId } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Cache purge failed (${res.status})`);
      }
      showToast(`Purged ${json.clearedCount ?? 0} entries from ${scope} cache.`);
      setConfirmClearAll(false);
      await loadCacheStats();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Cache purge failed');
    } finally {
      setPurgingScope(null);
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
          <div className="text-[11px] font-mono uppercase tracking-widest text-[#707070]">
            SWR Cache Engine, Artwork Overrides &amp; Route Revalidation
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2 mt-0.5">
            <Database size={19} />
            <span>Cache &amp; Refresh Control Plane</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Inspect live `appCache` hit rates, artwork cache sizes, and trigger scoped cache invalidations + Next.js ISR route revalidations.
          </p>
        </div>

        <button
          type="button"
          onClick={loadCacheStats}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Refresh Stats</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminKpiCard
          label="Cache Hit Rate"
          value={data ? `${data.hitRatePct}%` : 'Data unavailable'}
          sublabel={
            data
              ? `${data.stats.hits} hits · ${data.stats.staleHits} stale · ${data.stats.misses} miss`
              : undefined
          }
          icon={Zap}
        />
        <AdminKpiCard
          label="Active Cache Keys"
          value={data ? data.stats.size : 'Data unavailable'}
          sublabel={data ? `${data.stats.evictions} evictions` : undefined}
          icon={Database}
        />
        <AdminKpiCard
          label="Artwork Cache"
          value={
            data
              ? data.artworkCache.resolvedSize + data.artworkCache.overrideSize
              : 'Data unavailable'
          }
          sublabel={
            data
              ? `${data.artworkCache.resolvedSize} resolved · ${data.artworkCache.overrideSize} overrides`
              : undefined
          }
          icon={ImageIcon}
        />
        <AdminKpiCard
          label="In-Flight Requests"
          value={data ? data.inFlightCount : 'Data unavailable'}
          sublabel="Coalesced concurrent lookups"
          icon={Layers}
        />
      </div>

      {/* Scoped Purge Controls */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white">Scoped Cache Invalidation</h3>
            <p className="text-xs text-[#A0A0A0]">
              Optionally target a specific Hoshika Anime ID, or purge entire cache scopes globally.
            </p>
          </div>
          <input
            type="number"
            min={1}
            value={hoshikaIdInput}
            onChange={(e) => setHoshikaIdInput(e.target.value)}
            placeholder="Optional Hoshika ID (e.g. 16498)"
            className="w-full md:w-64 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs font-mono text-white placeholder-[#707070] focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {(
            [
              {
                scope: 'artwork',
                label: 'Purge Artwork',
                desc: 'Clear Fanart.tv & override cache',
              },
              {
                scope: 'catalog',
                label: 'Purge Catalog',
                desc: 'Refresh Trending / Popular / Recent',
              },
              {
                scope: 'anime',
                label: 'Purge Anime Details',
                desc: 'Invalidate series metadata',
              },
              {
                scope: 'episodes',
                label: 'Purge Episodes',
                desc: 'Force episode re-fetch',
              },
            ] as const
          ).map((item) => (
            <button
              key={item.scope}
              type="button"
              disabled={Boolean(purgingScope)}
              onClick={() => purgeScope(item.scope)}
              className="p-3.5 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-left space-y-1 cursor-pointer disabled:opacity-50"
            >
              <div className="text-xs font-bold text-white flex items-center justify-between">
                <span>{item.label}</span>
                {purgingScope === item.scope && <Loader2 size={12} className="animate-spin" />}
              </div>
              <div className="text-[11px] text-[#707070]">{item.desc}</div>
            </button>
          ))}

          <button
            type="button"
            disabled={Boolean(purgingScope)}
            onClick={() => setConfirmClearAll(true)}
            className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 hover:border-red-400 text-left space-y-1 cursor-pointer disabled:opacity-50"
          >
            <div className="text-xs font-bold text-red-300 flex items-center justify-between">
              <span>Purge All Caches</span>
              <Trash2 size={12} />
            </div>
            <div className="text-[11px] text-red-200/70">Clear every key &amp; ISR route</div>
          </button>
        </div>
      </div>

      {/* Diagnostic Events */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">
            Recent Cache Diagnostic Events ({data?.diagnostics?.length || 0})
          </h3>
          <span className="text-[11px] font-mono text-[#707070]">Last 60 operations</span>
        </div>

        {loading ? (
          <div className="py-8 flex justify-center">
            <Loader2 size={20} className="animate-spin text-white" />
          </div>
        ) : !data?.diagnostics?.length ? (
          <div className="py-8 text-center text-xs font-mono text-[#707070]">
            No recent cache diagnostic events recorded in this process yet.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#292929] text-[11px] font-mono uppercase text-[#707070]">
                  <th className="py-2.5 px-3">Cache Key</th>
                  <th className="py-2.5 px-3">Outcome</th>
                  <th className="py-2.5 px-3 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#292929] font-mono">
                {data.diagnostics.map((ev, idx) => (
                  <tr key={`${ev.id || ev.key}-${idx}`}>
                    <td className="py-2 px-3 text-white truncate max-w-[420px]">{ev.key}</td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#292929] text-[10px] uppercase text-[#D4D4D4]">
                        {ev.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right text-[#707070]">
                      {ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AdminConfirmModal
        open={confirmClearAll}
        title="Purge All Server Caches?"
        description="This clears all in-memory catalog, episode, anime metadata, and artwork override caches and revalidates public Next.js routes. Active users may briefly experience slower cold fetches."
        confirmLabel="Purge All Caches"
        destructive
        loading={purgingScope === 'all'}
        onConfirm={() => purgeScope('all')}
        onCancel={() => setConfirmClearAll(false)}
      />
    </div>
  );
}
