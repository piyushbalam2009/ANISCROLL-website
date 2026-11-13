'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  FileClock,
  RotateCcw,
  RefreshCw,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Search,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getAdminAuthHeaders, hasAdminPermission } from '@/lib/admin/admin-auth';
import {
  AdminActivityLogEntry,
  ArtworkAuditLogEntry,
  getAnimeArtworkOverride,
  recordArtworkAuditLog,
  saveAnimeArtworkOverride,
} from '@/lib/admin/admin-firestore';
import { DEFAULT_LOGO_DISPLAY_SETTINGS } from '@/types/artwork';

const ADMIN_CATEGORIES = [
  'all',
  'moderation',
  'users',
  'artwork',
  'scanner',
  'anime',
  'episodes',
  'homepage',
  'announcements',
  'admins',
  'settings',
  'cache',
  'monitoring',
  'errors',
] as const;

const MOD_CATEGORIES = ['all', 'moderation', 'users'] as const;

export default function AdminActivityAndAuditLogsPage() {
  const { adminRecord, effectiveRole } = useAuth();
  const isMod = effectiveRole === 'mod';
  const canRestoreArtwork =
    !isMod && hasAdminPermission(adminRecord, 'manageArtwork');

  const [tab, setTab] = useState<'artwork' | 'system'>(isMod ? 'system' : 'artwork');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [restrictedArtworkLogs, setRestrictedArtworkLogs] = useState(isMod);
  const [artworkLogs, setArtworkLogs] = useState<ArtworkAuditLogEntry[]>([]);
  const [activityLogs, setActivityLogs] = useState<AdminActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    if (isMod && tab === 'artwork') {
      setTab('system');
    }
  }, [isMod, tab]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      const params = new URLSearchParams();
      params.set('category', categoryFilter);
      if (searchQuery.trim()) {
        params.set('q', searchQuery.trim());
      }
      const res = await fetch(`/api/admin/activity?${params.toString()}`, {
        headers,
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Failed to load activity logs (${res.status})`);
      }

      const restricted = Boolean(data.restrictedArtworkLogs);
      setRestrictedArtworkLogs(restricted);
      if (restricted) {
        setTab('system');
      }
      setActivityLogs(Array.isArray(data.activityLogs) ? data.activityLogs : []);
      setArtworkLogs(Array.isArray(data.artworkLogs) ? data.artworkLogs : []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadLogs();
    }, 200);
    return () => clearTimeout(timer);
  }, [loadLogs]);

  const handleRestoreFromAudit = async (entry: ArtworkAuditLogEntry) => {
    if (!canRestoreArtwork) return;
    setRestoringId(entry.id);
    try {
      const existing = await getAnimeArtworkOverride(entry.hoshikaId);
      await saveAnimeArtworkOverride({
        hoshikaId: entry.hoshikaId,
        tvdbId: existing?.tvdbId || 0,
        tmdbId: existing?.tmdbId || 0,
        title: entry.animeTitle,
        selectedLogoUrl: entry.previousLogoUrl || '',
        selectedLogoSource: (entry.previousSource as any) || 'fanart_hdtvlogo',
        selectedLogoLanguage: existing?.selectedLogoLanguage || 'en',
        selectionMode: 'manual',
        availableLogos: existing?.availableLogos || [],
        customLogos: existing?.customLogos || [],
        hiddenLogoIds: existing?.hiddenLogoIds || [],
        logoDisplay: existing?.logoDisplay || DEFAULT_LOGO_DISPLAY_SETTINGS,
        logoStatus: entry.previousLogoUrl ? 'valid' : 'typography_fallback',
        backgroundUrl: existing?.backgroundUrl || '',
        posterUrl: existing?.posterUrl || '',
        hasEnglishLogo: existing?.hasEnglishLogo ?? true,
        hasJapaneseLogo: existing?.hasJapaneseLogo ?? false,
        reviewed: true,
      });

      await recordArtworkAuditLog({
        hoshikaId: entry.hoshikaId,
        animeTitle: entry.animeTitle,
        previousLogoUrl: entry.newLogoUrl,
        newLogoUrl: entry.previousLogoUrl,
        previousSource: entry.newSource,
        newSource: entry.previousSource,
        selectionMode: 'manual',
        action: 'restore_previous',
      });

      await loadLogs();
      showToast(`Restored previous logo for ${entry.animeTitle}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Rollback failed.');
    } finally {
      setRestoringId(null);
    }
  };

  const categories = restrictedArtworkLogs || isMod ? MOD_CATEGORIES : ADMIN_CATEGORIES;

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
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <FileClock size={19} />
            <span>
              {restrictedArtworkLogs
                ? 'Moderation & User Activity Logs'
                : 'Artwork Audit Trail & Staff Activity Logs'}
            </span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            {restrictedArtworkLogs
              ? 'Scoped moderator audit history for user actions and moderation report resolutions.'
              : 'Server-verified audit history of logo overrides, moderation actions, and administrative changes.'}
          </p>
        </div>

        <button
          type="button"
          onClick={loadLogs}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Refresh Logs</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Search + Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-[#0A0A0A] border border-[#292929] p-1 text-xs self-start">
          {!restrictedArtworkLogs && (
            <button
              type="button"
              onClick={() => setTab('artwork')}
              className={`px-4 py-2 rounded-lg font-bold transition-colors cursor-pointer ${
                tab === 'artwork' ? 'bg-white text-black' : 'text-[#A0A0A0] hover:text-white'
              }`}
            >
              Artwork Change Audit ({artworkLogs.length})
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab('system')}
            className={`px-4 py-2 rounded-lg font-bold transition-colors cursor-pointer ${
              tab === 'system' ? 'bg-white text-black' : 'text-[#A0A0A0] hover:text-white'
            }`}
          >
            System Staff Activity ({activityLogs.length})
          </button>
        </div>

        <div className="relative w-full lg:w-72">
          <Search size={14} className="absolute left-3 top-2.5 text-[#707070]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search action, target, or staff email..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#0A0A0A] border border-[#292929] focus:border-white text-xs text-white placeholder-[#707070] focus:outline-none"
          />
        </div>
      </div>

      {tab === 'system' && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-2.5 py-1 rounded-lg font-mono uppercase transition-colors cursor-pointer ${
                categoryFilter === cat
                  ? 'bg-white text-black font-bold'
                  : 'bg-[#0A0A0A] border border-[#292929] text-[#A0A0A0] hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Log Content */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center">
            <Loader2 size={22} className="animate-spin text-white" />
          </div>
        ) : tab === 'artwork' && !restrictedArtworkLogs ? (
          artworkLogs.length === 0 ? (
            <div className="p-10 text-center text-xs text-[#A0A0A0]">
              No artwork changes logged matching this filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#292929] bg-[#141414]/60 text-[11px] font-mono uppercase text-[#A0A0A0]">
                    <th className="py-3 px-4">Anime</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Source Transition</th>
                    <th className="py-3 px-4">Administrator</th>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4 text-right">Rollback / Studio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#292929]">
                  {artworkLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-[#141414]/40">
                      <td className="py-3.5 px-4 font-bold text-white">
                        {log.animeTitle}
                        <div className="text-[10px] font-mono text-[#707070]">
                          ID #{log.hoshikaId}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-white text-black font-mono text-[10px] font-bold uppercase">
                          {String(log.action || '').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-[#A0A0A0]">
                        {log.previousSource} →{' '}
                        <span className="text-white font-bold">{log.newSource}</span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-[#A0A0A0]">
                        {log.changedByEmail}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-[#707070]">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          {canRestoreArtwork && log.previousLogoUrl && (
                            <button
                              type="button"
                              disabled={restoringId === log.id}
                              onClick={() => handleRestoreFromAudit(log)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-xs text-white cursor-pointer"
                            >
                              <RotateCcw size={12} />
                              <span>Restore Previous</span>
                            </button>
                          )}
                          <Link
                            href={`/admin/artwork/${log.hoshikaId}`}
                            className="p-1.5 rounded-lg bg-[#141414] border border-[#292929] text-[#A0A0A0] hover:text-white"
                            title="Open Artwork Studio"
                          >
                            <ExternalLink size={13} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : activityLogs.length === 0 ? (
          <div className="p-10 text-center text-xs text-[#A0A0A0]">
            No staff activity logs found for this filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#292929] bg-[#141414]/60 text-[11px] font-mono uppercase text-[#A0A0A0]">
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Target</th>
                  <th className="py-3 px-4">Details</th>
                  <th className="py-3 px-4">Staff</th>
                  <th className="py-3 px-4 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#292929]">
                {activityLogs.map((act) => (
                  <tr key={act.id} className="hover:bg-[#141414]/40">
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#292929] font-mono text-[10px] text-white uppercase">
                        {act.category}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-white">{act.action}</td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-white">
                      {act.targetName}
                    </td>
                    <td className="py-3.5 px-4 text-[#A0A0A0] max-w-[280px] truncate">
                      {act.details}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-[#A0A0A0]">
                      {act.adminEmail}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-[11px] text-[#707070]">
                      {act.timestamp ? new Date(act.timestamp).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
