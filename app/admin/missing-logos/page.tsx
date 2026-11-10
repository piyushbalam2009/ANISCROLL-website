'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  AlertTriangle,
  RefreshCw,
  Check,
  SlidersHorizontal,
  Upload,
  Search,
  Loader2,
  CheckCircle2,
  Globe,
  Type,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getAdminAuthHeaders, hasAdminPermission } from '@/lib/admin/admin-auth';
import {
  AnimeArtworkFirestoreDoc,
  listAllAnimeArtworkOverrides,
  recordAdminActivity,
  saveAnimeArtworkOverride,
} from '@/lib/admin/admin-firestore';

type ScannerFilter =
  | 'all_issues'
  | 'missing'
  | 'japanese_only'
  | 'no_english'
  | 'typography'
  | 'custom'
  | 'unreviewed'
  | 'all';

export default function AdminMissingLogosScannerPage() {
  const { adminRecord } = useAuth();
  const canEdit = hasAdminPermission(adminRecord, 'manageArtwork');

  const [items, setItems] = useState<AnimeArtworkFirestoreDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [syncingBatch, setSyncingBatch] = useState(false);
  const [filter, setFilter] = useState<ScannerFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadAndScan = useCallback(async (scanLimit = 24) => {
    setLoading(true);
    try {
      const existingOverrides = await listAllAnimeArtworkOverrides().catch(() => []);
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/artwork', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'scan_catalogue', limit: scanLimit }),
      });

      const merged = new Map<number, AnimeArtworkFirestoreDoc>();
      if (res.ok) {
        const data = await res.json();
        for (const item of data.results || []) {
          merged.set(item.hoshikaId, item);
        }
      }
      for (const ov of existingOverrides) {
        merged.set(ov.hoshikaId, ov);
      }

      setItems(Array.from(merged.values()));
    } catch (error) {
      console.error('Failed to run missing logo scanner:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAndScan(24);
  }, [loadAndScan]);

  const handleDeepCatalogueScan = async () => {
    setScanning(true);
    try {
      await loadAndScan(40);
      await recordAdminActivity({
        category: 'scanner',
        action: 'Executed automatic artwork & missing logo scan',
        targetId: 'catalogue',
        targetName: 'Hoshika + Fanart.tv Catalogue',
        details: 'Scanned up to 40 anime series for missing, Japanese-only, or fallback logos',
      });
      showToast('Completed deep Fanart.tv artwork scan across catalogue.');
    } finally {
      setScanning(false);
    }
  };

  const handleSyncScannedToFirestore = async () => {
    if (!canEdit) return;
    setSyncingBatch(true);
    try {
      let synced = 0;
      for (const item of items.slice(0, 15)) {
        await saveAnimeArtworkOverride({
          ...item,
        });
        synced++;
      }
      await recordAdminActivity({
        category: 'scanner',
        action: `Synced ${synced} scanned artwork records to Firestore`,
        targetId: 'animeArtwork',
        targetName: 'Batch Sync',
        details: `Persisted ${synced} anime artwork metadata records`,
      });
      showToast(`Persisted ${synced} artwork records to Firestore /animeArtwork.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Batch sync failed.');
    } finally {
      setSyncingBatch(false);
    }
  };

  const handleToggleReviewed = async (item: AnimeArtworkFirestoreDoc) => {
    if (!canEdit) return;
    const nextReviewed = !item.reviewed;
    try {
      const saved = await saveAnimeArtworkOverride({
        ...item,
        reviewed: nextReviewed,
      });
      setItems((prev) =>
        prev.map((x) => (x.hoshikaId === item.hoshikaId ? saved : x))
      );
      showToast(
        nextReviewed
          ? `Marked ${item.title} as reviewed.`
          : `Unmarked ${item.title}.`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update review state.');
    }
  };

  const filteredItems = items.filter((item) => {
    if (
      searchQuery.trim() &&
      !item.title.toLowerCase().includes(searchQuery.trim().toLowerCase()) &&
      String(item.hoshikaId) !== searchQuery.trim()
    ) {
      return false;
    }

    const isMissing = !item.selectedLogoUrl || item.logoStatus === 'missing';
    const isTypography =
      !item.selectedLogoUrl || item.selectedLogoSource === 'typography_fallback';
    const isJaOnly =
      item.selectedLogoLanguage === 'ja' || item.logoStatus === 'japanese_only';
    const isNoEnglish = !item.hasEnglishLogo;
    const isCustom =
      item.selectedLogoSource === 'custom_upload' ||
      (item.customLogos && item.customLogos.length > 0);

    switch (filter) {
      case 'all_issues':
        return isMissing || isTypography || isJaOnly || isNoEnglish;
      case 'missing':
        return isMissing;
      case 'japanese_only':
        return isJaOnly;
      case 'no_english':
        return isNoEnglish;
      case 'typography':
        return isTypography;
      case 'custom':
        return Boolean(isCustom);
      case 'unreviewed':
        return !item.reviewed;
      default:
        return true;
    }
  });

  const missingCount = items.filter(
    (x) => !x.selectedLogoUrl || x.logoStatus === 'missing'
  ).length;
  const jaOnlyCount = items.filter(
    (x) => x.selectedLogoLanguage === 'ja' || x.logoStatus === 'japanese_only'
  ).length;
  const noEnCount = items.filter((x) => !x.hasEnglishLogo).length;
  const customCount = items.filter(
    (x) =>
      x.selectedLogoSource === 'custom_upload' ||
      (x.customLogos && x.customLogos.length > 0)
  ).length;

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-white text-black font-bold text-xs shadow-2xl flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>{toast}</span>
        </div>
      )}

      {/* Scanner Header & Controls */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-[#707070]">
            Automatic Artwork Diagnostic Engine
          </div>
          <h2 className="text-lg sm:text-xl font-black text-white mt-0.5">
            Missing Logo Detector & Fanart.tv Coverage Scanner
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-1">
            Automatically detects anime missing transparent logos, using Japanese-only logos, or falling back to Hoshika typography.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {canEdit && (
            <button
              type="button"
              onClick={handleSyncScannedToFirestore}
              disabled={syncingBatch || loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white transition-colors cursor-pointer disabled:opacity-50"
            >
              {syncingBatch ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              <span>Persist Index to Firestore</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleDeepCatalogueScan}
            disabled={scanning || loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
            <span>{scanning ? 'Scanning Fanart.tv...' : 'Run Deep Artwork Scan'}</span>
          </button>
        </div>
      </div>

      {/* Summary Diagnostic Pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => setFilter('missing')}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            filter === 'missing'
              ? 'bg-white text-black border-white'
              : 'bg-[#0A0A0A] border-[#292929] hover:border-white/40 text-white'
          }`}
        >
          <div className="flex items-center justify-between text-xs opacity-80">
            <span>Missing / Fallback</span>
            <AlertTriangle size={14} />
          </div>
          <div className="text-2xl font-black font-mono tabular-nums mt-1">
            {missingCount}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilter('japanese_only')}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            filter === 'japanese_only'
              ? 'bg-white text-black border-white'
              : 'bg-[#0A0A0A] border-[#292929] hover:border-white/40 text-white'
          }`}
        >
          <div className="flex items-center justify-between text-xs opacity-80">
            <span>Japanese Logo Only</span>
            <Globe size={14} />
          </div>
          <div className="text-2xl font-black font-mono tabular-nums mt-1">
            {jaOnlyCount}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilter('no_english')}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            filter === 'no_english'
              ? 'bg-white text-black border-white'
              : 'bg-[#0A0A0A] border-[#292929] hover:border-white/40 text-white'
          }`}
        >
          <div className="flex items-center justify-between text-xs opacity-80">
            <span>No English Logo</span>
            <Type size={14} />
          </div>
          <div className="text-2xl font-black font-mono tabular-nums mt-1">
            {noEnCount}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilter('custom')}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            filter === 'custom'
              ? 'bg-white text-black border-white'
              : 'bg-[#0A0A0A] border-[#292929] hover:border-white/40 text-white'
          }`}
        >
          <div className="flex items-center justify-between text-xs opacity-80">
            <span>Custom Uploaded</span>
            <Upload size={14} />
          </div>
          <div className="text-2xl font-black font-mono tabular-nums mt-1">
            {customCount}
          </div>
        </button>
      </div>

      {/* Filter Bar & Search */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(
            [
              { id: 'all', label: `All Scanned (${items.length})` },
              { id: 'all_issues', label: 'Needs Attention' },
              { id: 'missing', label: 'Missing Logo' },
              { id: 'japanese_only', label: 'Japanese Only' },
              { id: 'no_english', label: 'No English Logo' },
              { id: 'typography', label: 'Typography Fallback' },
              { id: 'custom', label: 'Custom Logo Available' },
              { id: 'unreviewed', label: 'Unreviewed' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                filter === f.id
                  ? 'bg-white text-black font-bold'
                  : 'bg-[#141414] text-[#A0A0A0] hover:text-white border border-[#292929]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative w-full lg:w-64">
          <Search size={14} className="absolute left-3 top-2.5 text-[#707070]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by title or ID..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#141414] border border-[#292929] focus:border-white text-xs text-white placeholder-[#707070] focus:outline-none"
          />
        </div>
      </div>

      {/* Scanner Results Table */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <Loader2 size={24} className="animate-spin text-white" />
            <div className="text-xs font-mono uppercase tracking-wider text-[#A0A0A0]">
              Scanning Catalogue Artwork & Fanart.tv Logos...
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <div className="text-sm font-bold text-white">
              No Anime Matched This Filter
            </div>
            <p className="text-xs text-[#A0A0A0]">
              Try switching to &ldquo;All Scanned&rdquo; or running a deep artwork scan.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#292929] bg-[#141414]/60 text-[11px] font-mono uppercase text-[#A0A0A0]">
                  <th className="py-3 px-4">Anime</th>
                  <th className="py-3 px-4">Current Logo Preview</th>
                  <th className="py-3 px-4">External IDs</th>
                  <th className="py-3 px-4">Logo Status & Source</th>
                  <th className="py-3 px-4">Candidates</th>
                  <th className="py-3 px-4 text-right">Quick Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#292929] text-xs">
                {filteredItems.map((item) => (
                  <tr
                    key={item.hoshikaId}
                    className="hover:bg-[#141414]/40 transition-colors"
                  >
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-white max-w-[220px] truncate">
                        {item.title}
                      </div>
                      <div className="text-[11px] font-mono text-[#707070] tabular-nums">
                        Hoshika #{item.hoshikaId}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="w-36 h-12 rounded-lg bg-[#050505] border border-[#292929] relative flex items-center justify-center p-1.5 overflow-hidden">
                        {item.selectedLogoUrl ? (
                          <Image
                            src={item.selectedLogoUrl}
                            alt={item.title}
                            fill
                            sizes="150px"
                            className="object-contain p-1.5"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span className="text-[10px] font-mono text-[#707070] uppercase">
                            Typography Fallback
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-[11px] text-[#A0A0A0] tabular-nums">
                      <div>AniList: {item.anilistId || '—'}</div>
                      <div>TVDB: {item.tvdbId || '—'}</div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase ${
                            item.selectedLogoUrl
                              ? 'bg-white text-black'
                              : 'bg-[#141414] border border-white/30 text-white'
                          }`}
                        >
                          {item.selectedLogoUrl ? item.logoStatus : 'MISSING LOGO'}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#292929] font-mono text-[10px] text-[#A0A0A0] uppercase">
                          {item.selectedLogoSource} ({item.selectedLogoLanguage || 'en'})
                        </span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-[11px] text-white tabular-nums">
                      <div>
                        {(item.availableLogos || []).length} Fanart •{' '}
                        {(item.customLogos || []).length} Custom
                      </div>
                      <div className="text-[#707070]">
                        EN: {item.hasEnglishLogo ? 'Yes' : 'No'} • JA:{' '}
                        {item.hasJapaneseLogo ? 'Yes' : 'No'}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/artwork/${item.hoshikaId}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black hover:bg-neutral-200 font-bold text-xs transition-colors"
                        >
                          <SlidersHorizontal size={12} />
                          <span>Manage / Upload</span>
                        </Link>

                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => handleToggleReviewed(item)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-mono transition-colors cursor-pointer ${
                              item.reviewed
                                ? 'bg-[#141414] border-white text-white'
                                : 'bg-[#0F0F0F] border-[#292929] text-[#A0A0A0] hover:text-white'
                            }`}
                            title="Mark as reviewed"
                          >
                            <Check size={12} />
                            <span>{item.reviewed ? 'Reviewed' : 'Review'}</span>
                          </button>
                        )}
                      </div>
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
