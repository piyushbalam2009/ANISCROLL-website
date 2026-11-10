'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Save,
  RotateCcw,
  CheckCircle2,
  Loader2,
  ExternalLink,
  History,
  Lock,
  Sparkles,
  Check,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { hasAdminPermission, getAdminAuthHeaders } from '@/lib/admin/admin-auth';
import {
  AnimeArtworkFirestoreDoc,
  ArtworkAuditLogEntry,
  deleteCustomLogoFromStorage,
  getAnimeArtworkOverride,
  listArtworkAuditLogs,
  recordAdminActivity,
  recordArtworkAuditLog,
  saveAnimeArtworkOverride,
} from '@/lib/admin/admin-firestore';
import {
  CustomLogoItem,
  DEFAULT_LOGO_DISPLAY_SETTINGS,
  FanartLogoItem,
  LogoDisplaySettings,
} from '@/types/artwork';
import { resolveAnimeLogoSelection } from '@/lib/artwork/logo-selector';
import { ArtworkPreview } from './ArtworkPreview';
import { LogoSelector } from './LogoSelector';
import { LogoUploader } from './LogoUploader';

interface ArtworkManagerProps {
  hoshikaId: number;
}

export function ArtworkManager({ hoshikaId }: ArtworkManagerProps) {
  const { adminRecord } = useAuth();
  const canEdit = hasAdminPermission(adminRecord, 'manageArtwork');
  const canUpload = hasAdminPermission(adminRecord, 'uploadLogos');
  const canDelete = hasAdminPermission(adminRecord, 'deleteLogos');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [animeMeta, setAnimeMeta] = useState<{
    title: string;
    format: string;
    anilistId: number;
    tvdbId: number;
    tmdbId: number;
    backgroundUrl: string;
    posterUrl: string;
  }>({
    title: `Anime #${hoshikaId}`,
    format: 'TV',
    anilistId: 0,
    tvdbId: 0,
    tmdbId: 0,
    backgroundUrl: '',
    posterUrl: '',
  });

  const [availableLogos, setAvailableLogos] = useState<FanartLogoItem[]>([]);
  const [customLogos, setCustomLogos] = useState<CustomLogoItem[]>([]);
  const [hiddenLogoIds, setHiddenLogoIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<'auto' | 'manual'>('auto');
  const [selectedLogoUrl, setSelectedLogoUrl] = useState<string>('');
  const [selectedLogoSource, setSelectedLogoSource] = useState<
    'fanart_hdtvlogo' | 'fanart_clearlogo' | 'custom_upload' | 'typography_fallback'
  >('typography_fallback');
  const [selectedLogoLanguage, setSelectedLogoLanguage] = useState<string>('en');
  const [logoDisplay, setLogoDisplay] = useState<LogoDisplaySettings>({
    ...DEFAULT_LOGO_DISPLAY_SETTINGS,
  });
  const [reviewed, setReviewed] = useState<boolean>(false);
  const [auditHistory, setAuditHistory] = useState<ArtworkAuditLogEntry[]>([]);
  const [savedLogoUrlSnapshot, setSavedLogoUrlSnapshot] = useState<string>('');
  const [savedSourceSnapshot, setSavedSourceSnapshot] = useState<string>('none');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAdminAuthHeaders();
      const [apiRes, firestoreDoc, allLogs] = await Promise.all([
        fetch(`/api/admin/artwork?hoshikaId=${hoshikaId}&refresh=true`, {
          headers,
        }).then((r) => (r.ok ? r.json() : null)),
        getAnimeArtworkOverride(hoshikaId).catch(() => null),
        listArtworkAuditLogs(60).catch(() => []),
      ]);

      const apiAnime = apiRes?.anime;
      const apiArtwork = apiRes?.artwork;

      const title =
        firestoreDoc?.title || apiAnime?.title || `Anime #${hoshikaId}`;
      const anilistId =
        firestoreDoc?.anilistId ||
        apiArtwork?.anilistId ||
        apiAnime?.anilistId ||
        0;
      const tvdbId = firestoreDoc?.tvdbId || apiArtwork?.tvdbId || 0;
      const tmdbId = firestoreDoc?.tmdbId || apiArtwork?.tmdbId || 0;
      const backgroundUrl =
        firestoreDoc?.backgroundUrl ||
        apiArtwork?.backgroundUrl ||
        apiAnime?.bannerImage ||
        '';
      const posterUrl =
        firestoreDoc?.posterUrl ||
        apiArtwork?.posterUrl ||
        apiAnime?.coverImage ||
        '';

      setAnimeMeta({
        title,
        format: apiAnime?.format || 'TV',
        anilistId,
        tvdbId,
        tmdbId,
        backgroundUrl,
        posterUrl,
      });

      const mergedLogos: FanartLogoItem[] =
        apiArtwork?.availableLogos && apiArtwork.availableLogos.length > 0
          ? apiArtwork.availableLogos
          : firestoreDoc?.availableLogos || [];

      const existingCustom =
        firestoreDoc?.customLogos || apiArtwork?.customLogos || [];
      const existingHidden =
        firestoreDoc?.hiddenLogoIds || apiArtwork?.hiddenLogoIds || [];
      const mode = firestoreDoc?.selectionMode || apiArtwork?.selectionMode || 'auto';

      const resolved = resolveAnimeLogoSelection({
        availableLogos: mergedLogos,
        customLogos: existingCustom,
        hiddenLogoIds: existingHidden,
        selectionMode: mode,
        manualLogoUrl: firestoreDoc?.selectedLogoUrl ?? apiArtwork?.logoUrl ?? '',
        manualLogoSource:
          firestoreDoc?.selectedLogoSource || apiArtwork?.selectedLogoSource,
        manualLogoLanguage:
          firestoreDoc?.selectedLogoLanguage || apiArtwork?.selectedLogoLanguage,
        logoDisplay:
          firestoreDoc?.logoDisplay ||
          apiArtwork?.logoDisplay ||
          DEFAULT_LOGO_DISPLAY_SETTINGS,
        preferEnglish: true,
      });

      setAvailableLogos(mergedLogos);
      setCustomLogos(existingCustom);
      setHiddenLogoIds(existingHidden);
      setSelectionMode(resolved.selectionMode);
      setSelectedLogoUrl(resolved.logoUrl || '');
      setSelectedLogoSource(resolved.selectedLogoSource);
      setSelectedLogoLanguage(resolved.selectedLogoLanguage);
      setLogoDisplay(resolved.logoDisplay);
      setReviewed(Boolean(firestoreDoc?.reviewed));

      setSavedLogoUrlSnapshot(resolved.logoUrl || '');
      setSavedSourceSnapshot(resolved.selectedLogoSource);

      setAuditHistory(
        allLogs.filter((entry) => Number(entry.hoshikaId) === Number(hoshikaId))
      );
    } catch (error) {
      console.error('Failed to load anime artwork studio:', error);
    } finally {
      setLoading(false);
    }
  }, [hoshikaId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const persistArtworkDoc = async (params: {
    nextMode: 'auto' | 'manual';
    nextLogoUrl: string;
    nextSource:
      | 'fanart_hdtvlogo'
      | 'fanart_clearlogo'
      | 'custom_upload'
      | 'typography_fallback';
    nextLang: string;
    nextCustomLogos?: CustomLogoItem[];
    nextHiddenIds?: string[];
    nextDisplay?: LogoDisplaySettings;
    nextReviewed?: boolean;
    auditAction: ArtworkAuditLogEntry['action'];
  }) => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const resolved = resolveAnimeLogoSelection({
        availableLogos,
        customLogos: params.nextCustomLogos ?? customLogos,
        hiddenLogoIds: params.nextHiddenIds ?? hiddenLogoIds,
        selectionMode: params.nextMode,
        manualLogoUrl: params.nextLogoUrl,
        manualLogoSource: params.nextSource,
        manualLogoLanguage: params.nextLang,
        logoDisplay: params.nextDisplay ?? logoDisplay,
        preferEnglish: true,
      });

      const docPayload: Omit<
        AnimeArtworkFirestoreDoc,
        'createdAt' | 'updatedAt' | 'updatedBy' | 'updatedByEmail' | 'lastChecked'
      > = {
        hoshikaId,
        anilistId: animeMeta.anilistId,
        tvdbId: animeMeta.tvdbId,
        tmdbId: animeMeta.tmdbId,
        title: animeMeta.title,
        selectedLogoUrl: resolved.logoUrl || '',
        selectedLogoSource: resolved.selectedLogoSource,
        selectedLogoLanguage: resolved.selectedLogoLanguage,
        selectionMode: resolved.selectionMode,
        availableLogos,
        customLogos: resolved.customLogos,
        hiddenLogoIds: resolved.hiddenLogoIds,
        logoDisplay: resolved.logoDisplay,
        logoStatus: resolved.logoStatus,
        backgroundUrl: animeMeta.backgroundUrl,
        posterUrl: animeMeta.posterUrl,
        hasEnglishLogo: resolved.hasEnglishLogo,
        hasJapaneseLogo: resolved.hasJapaneseLogo,
        reviewed: params.nextReviewed ?? reviewed,
      };

      await saveAnimeArtworkOverride(docPayload);

      await recordArtworkAuditLog({
        hoshikaId,
        animeTitle: animeMeta.title,
        previousLogoUrl: savedLogoUrlSnapshot,
        newLogoUrl: resolved.logoUrl || '',
        previousSource: savedSourceSnapshot,
        newSource: resolved.selectedLogoSource,
        selectionMode: resolved.selectionMode,
        action: params.auditAction,
      });

      await recordAdminActivity({
        category: 'artwork',
        action: `Artwork ${params.auditAction} (${resolved.selectionMode})`,
        targetId: hoshikaId,
        targetName: animeMeta.title,
        details: `Source: ${resolved.selectedLogoSource}, Mode: ${resolved.selectionMode}`,
      });

      setSelectionMode(resolved.selectionMode);
      setSelectedLogoUrl(resolved.logoUrl || '');
      setSelectedLogoSource(resolved.selectedLogoSource);
      setSelectedLogoLanguage(resolved.selectedLogoLanguage);
      setCustomLogos(resolved.customLogos);
      setHiddenLogoIds(resolved.hiddenLogoIds);
      setLogoDisplay(resolved.logoDisplay);
      if (params.nextReviewed !== undefined) setReviewed(params.nextReviewed);

      setSavedLogoUrlSnapshot(resolved.logoUrl || '');
      setSavedSourceSnapshot(resolved.selectedLogoSource);

      const updatedLogs = await listArtworkAuditLogs(60).catch(() => []);
      setAuditHistory(
        updatedLogs.filter((entry) => Number(entry.hoshikaId) === Number(hoshikaId))
      );

      showToast('Saved artwork configuration & purged live hero cache.');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to save artwork changes.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSelectLogo = async (item: {
    url: string;
    source:
      | 'fanart_hdtvlogo'
      | 'fanart_clearlogo'
      | 'custom_upload'
      | 'typography_fallback';
    lang: string;
  }) => {
    await persistArtworkDoc({
      nextMode: 'manual',
      nextLogoUrl: item.url,
      nextSource: item.source,
      nextLang: item.lang,
      nextReviewed: true,
      auditAction: 'select_logo',
    });
  };

  const handleResetToAuto = async () => {
    await persistArtworkDoc({
      nextMode: 'auto',
      nextLogoUrl: '',
      nextSource: 'fanart_hdtvlogo',
      nextLang: 'en',
      auditAction: 'reset_auto',
    });
  };

  const handleToggleHideLogo = async (logoId: string) => {
    const exists = hiddenLogoIds.includes(logoId);
    const nextHidden = exists
      ? hiddenLogoIds.filter((id) => id !== logoId)
      : [...hiddenLogoIds, logoId];

    await persistArtworkDoc({
      nextMode: selectionMode,
      nextLogoUrl: selectedLogoUrl,
      nextSource: selectedLogoSource,
      nextLang: selectedLogoLanguage,
      nextHiddenIds: nextHidden,
      auditAction: 'hide_logo',
    });
  };

  const handleCustomUploaded = async (uploaded: CustomLogoItem) => {
    const nextCustom = [...customLogos, uploaded];
    await persistArtworkDoc({
      nextMode: 'manual',
      nextLogoUrl: uploaded.url,
      nextSource: 'custom_upload',
      nextLang: uploaded.lang || 'en',
      nextCustomLogos: nextCustom,
      nextReviewed: true,
      auditAction: 'upload_logo',
    });
  };

  const handleDeleteCustomLogo = async (target: CustomLogoItem) => {
    if (!canDelete) return;
    await deleteCustomLogoFromStorage(target.storagePath);
    const nextCustom = customLogos.filter((c) => c.id !== target.id);
    const wasSelected =
      selectedLogoUrl === target.url || selectedLogoUrl === target.proxyUrl;

    await persistArtworkDoc({
      nextMode: wasSelected ? 'auto' : selectionMode,
      nextLogoUrl: wasSelected ? '' : selectedLogoUrl,
      nextSource: wasSelected ? 'fanart_hdtvlogo' : selectedLogoSource,
      nextLang: selectedLogoLanguage,
      nextCustomLogos: nextCustom,
      auditAction: 'delete_logo',
    });
  };

  const handleRestorePrevious = async (entry: ArtworkAuditLogEntry) => {
    await persistArtworkDoc({
      nextMode: 'manual',
      nextLogoUrl: entry.previousLogoUrl,
      nextSource: (entry.previousSource as any) || 'fanart_hdtvlogo',
      nextLang: 'en',
      auditAction: 'restore_previous',
    });
  };

  if (loading) {
    return (
      <div className="p-12 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col items-center justify-center space-y-3">
        <Loader2 size={24} className="animate-spin text-white" />
        <div className="text-xs font-mono uppercase tracking-wider text-[#A0A0A0]">
          Resolving Fanart.tv HDTVLogo & ClearLogo Candidates...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-white text-black font-bold text-xs shadow-2xl flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>{toast}</span>
        </div>
      )}

      {/* Top Metadata & Action Bar */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
              {animeMeta.title}
            </h2>
            <span
              className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase ${
                selectionMode === 'manual'
                  ? 'bg-white text-black'
                  : 'bg-[#141414] text-white border border-[#292929]'
              }`}
            >
              {selectionMode === 'manual' ? (
                <span className="inline-flex items-center gap-1">
                  <Lock size={10} /> MANUAL LOCK ACTIVE
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Sparkles size={10} /> AUTO PRIORITY
                </span>
              )}
            </span>
            {reviewed && (
              <span className="px-2 py-0.5 rounded bg-[#141414] border border-white/30 font-mono text-[10px] text-white uppercase inline-flex items-center gap-1">
                <Check size={10} /> Reviewed
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-[#A0A0A0] tabular-nums">
            <span>Hoshika ID: {hoshikaId}</span>
            <span>•</span>
            <span>AniList ID: {animeMeta.anilistId || 'N/A'}</span>
            <span>•</span>
            <span>TVDB ID: {animeMeta.tvdbId || 'N/A'}</span>
            <span>•</span>
            <span>TMDB ID: {animeMeta.tmdbId || 'N/A'}</span>
            <span>•</span>
            <span>Source: {selectedLogoSource}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href={`/anime/${hoshikaId}`}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#141414] border border-[#292929] hover:border-white/40 text-xs font-medium text-white transition-colors"
          >
            <span>Open Public Anime Page</span>
            <ExternalLink size={13} />
          </Link>

          {canEdit && (
            <>
              <button
                type="button"
                onClick={() =>
                  persistArtworkDoc({
                    nextMode: selectionMode,
                    nextLogoUrl: selectedLogoUrl,
                    nextSource: selectedLogoSource,
                    nextLang: selectedLogoLanguage,
                    nextReviewed: !reviewed,
                    auditAction: 'mark_reviewed',
                  })
                }
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-xs font-medium text-white transition-colors cursor-pointer"
              >
                <Check size={14} />
                <span>{reviewed ? 'Reviewed' : 'Mark Reviewed'}</span>
              </button>

              <button
                type="button"
                onClick={handleResetToAuto}
                disabled={saving || selectionMode === 'auto'}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-xs font-medium text-white transition-colors cursor-pointer disabled:opacity-40"
              >
                <RotateCcw size={14} />
                <span>Reset to Auto Selection</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  persistArtworkDoc({
                    nextMode: selectionMode,
                    nextLogoUrl: selectedLogoUrl,
                    nextSource: selectedLogoSource,
                    nextLang: selectedLogoLanguage,
                    nextDisplay: logoDisplay,
                    auditAction: 'update_display',
                  })
                }
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-black hover:bg-neutral-200 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                <span>Save Display Settings</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* 1. Live Hero Preview & Display Controls */}
      <ArtworkPreview
        animeTitle={animeMeta.title}
        backgroundUrl={animeMeta.backgroundUrl}
        posterUrl={animeMeta.posterUrl}
        logoUrl={selectedLogoUrl || null}
        logoDisplay={logoDisplay}
        onChangeDisplay={setLogoDisplay}
      />

      {/* 2. Logo Selector (Fanart.tv hdtvlogo, clearlogo & Custom Uploads) */}
      <LogoSelector
        availableLogos={availableLogos}
        customLogos={customLogos}
        hiddenLogoIds={hiddenLogoIds}
        selectedLogoUrl={selectedLogoUrl || null}
        selectedLogoSource={selectedLogoSource}
        selectionMode={selectionMode}
        canDeleteCustom={canDelete}
        onSelectLogo={handleSelectLogo}
        onToggleHideLogo={handleToggleHideLogo}
        onDeleteCustomLogo={handleDeleteCustomLogo}
      />

      {/* 3. Custom Logo Uploader */}
      {canUpload && (
        <LogoUploader
          hoshikaId={hoshikaId}
          animeTitle={animeMeta.title}
          onUploaded={handleCustomUploaded}
        />
      )}

      {/* 4. Per-Anime Logo Audit Trail & 1-Click Restore */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <History size={15} />
            <span>Artwork Audit History ({auditHistory.length})</span>
          </h3>
          <span className="text-[11px] font-mono text-[#707070]">
            Instant Rollback Available
          </span>
        </div>

        {auditHistory.length === 0 ? (
          <div className="text-xs text-[#707070] py-4 text-center">
            No manual artwork overrides recorded for this anime yet.
          </div>
        ) : (
          <div className="divide-y divide-[#292929]">
            {auditHistory.slice(0, 8).map((entry) => (
              <div
                key={entry.id}
                className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="font-semibold text-white">
                    {entry.action.replace(/_/g, ' ').toUpperCase()} •{' '}
                    <span className="font-mono text-[#A0A0A0]">
                      {entry.previousSource} → {entry.newSource}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-[#707070]">
                    By {entry.changedByEmail} •{' '}
                    {new Date(entry.timestamp).toLocaleString()}
                  </div>
                </div>

                {canEdit && entry.previousLogoUrl && (
                  <button
                    type="button"
                    onClick={() => handleRestorePrevious(entry)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-xs font-medium text-white transition-colors cursor-pointer"
                  >
                    <RotateCcw size={12} />
                    <span>Restore Previous Logo</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
