'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Check,
  RotateCcw,
  EyeOff,
  Eye,
  Trash2,
  Sliders,
  Sparkles,
  Lock,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Type,
  Search,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import {
  FanartLogoItem,
  CustomLogoItem,
  LogoDisplaySettings,
  DEFAULT_LOGO_DISPLAY_SETTINGS,
  AnimeLogoStatus,
} from '@/types/artwork';
import { AniListCandidateSummary } from '@/types/anime';
import {
  AnimeArtworkFirestoreDoc,
  getAnimeArtworkOverride,
  saveAnimeArtworkOverride,
  uploadCustomAnimeLogoFile,
  deleteCustomLogoFromStorage,
  recordArtworkAuditLog,
  recordAdminActivity,
} from '@/lib/admin/admin-firestore';
import { resolveAnimeLogoSelection } from '@/lib/artwork/logo-selector';
import { LogoUploader } from './LogoUploader';
import { ArtworkPreview } from './ArtworkPreview';
import { useAuth } from '@/hooks/useAuth';
import { hasAdminPermission } from '@/lib/admin/admin-auth';
import { auth } from '@/lib/firebase';

interface ArtworkManagerProps {
  hoshikaId: number;
}

export function ArtworkManager({ hoshikaId }: ArtworkManagerProps) {
  const { adminRecord } = useAuth();
  const canManageArtwork = hasAdminPermission(adminRecord, 'manageArtwork');
  const canUploadLogos = hasAdminPermission(adminRecord, 'uploadLogos');
  const canDeleteLogos = hasAdminPermission(adminRecord, 'deleteLogos');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  const [animeMeta, setAnimeMeta] = useState<{
    title: string;
    anilistId: number;
    tvdbId: number;
    tmdbId: number;
    posterUrl: string;
    backgroundUrl: string;
    synopsis: string;
    format: string;
    seasonYear: number | null;
    rating: number;
  }>({
    title: `Anime #${hoshikaId}`,
    anilistId: 0,
    tvdbId: 0,
    tmdbId: 0,
    posterUrl: '',
    backgroundUrl: '',
    synopsis: '',
    format: 'TV',
    seasonYear: null,
    rating: 85,
  });

  const [selectionMode, setSelectionMode] = useState<'auto' | 'manual'>('auto');
  const [selectedLogoUrl, setSelectedLogoUrl] = useState<string>('');
  const [selectedLogoSource, setSelectedLogoSource] = useState<
    'fanart_hdtvlogo' | 'fanart_clearlogo' | 'custom_upload' | 'typography_fallback'
  >('typography_fallback');
  const [selectedLogoLanguage, setSelectedLogoLanguage] = useState<string>('en');
  const [availableLogos, setAvailableLogos] = useState<FanartLogoItem[]>([]);
  const [customLogos, setCustomLogos] = useState<CustomLogoItem[]>([]);
  const [hiddenLogoIds, setHiddenLogoIds] = useState<string[]>([]);
  const [logoDisplay, setLogoDisplay] = useState<LogoDisplaySettings>(
    DEFAULT_LOGO_DISPLAY_SETTINGS
  );
  const [reviewed, setReviewed] = useState(false);
  const [overrideDoc, setOverrideDoc] = useState<AnimeArtworkFirestoreDoc | null>(
    null
  );

  // In-memory AniList ID Resolution & Verification Tool state (NEVER persisted to Firebase)
  const [idResolutionInfo, setIdResolutionInfo] = useState<{
    aniListId: number | null;
    confidence: number;
    status: string;
    matchType: string;
    matchedTitle: string | null;
    explanation: string;
  } | null>(null);
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupYear, setLookupYear] = useState<string>('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupCandidates, setLookupCandidates] = useState<AniListCandidateSummary[]>([]);
  const [lookupCollectedTitles, setLookupCollectedTitles] = useState<string[]>([]);
  const [previewingCandidateId, setPreviewingCandidateId] = useState<number | null>(null);

  const showToast = (msg: string) => {
    setStatusToast(msg);
    setTimeout(() => setStatusToast(null), 3500);
  };

  const loadArtworkData = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      try {
        const [apiRes, firestoreDoc] = await Promise.all([
          fetch(
            `/api/admin/artwork?hoshikaId=${hoshikaId}${
              forceRefresh ? '&refresh=true' : ''
            }`
          ).then((r) => r.json()),
          getAnimeArtworkOverride(hoshikaId).catch(() => null),
        ]);

        const apiAnime = apiRes?.anime;
        const apiArtwork = apiRes?.artwork;
        const apiIdRes = apiRes?.idResolution;

        const title =
          firestoreDoc?.title ||
          apiAnime?.titleEnglish ||
          apiAnime?.titleRomaji ||
          apiArtwork?.title ||
          `Anime #${hoshikaId}`;

        // AniList ID comes strictly from live in-memory resolution (never from Firestore)
        const resolvedAnilistId =
          apiIdRes?.aniListId ||
          apiIdRes?.anilistId ||
          apiArtwork?.anilistId ||
          apiAnime?.anilistId ||
          0;

        const tvdbId =
          firestoreDoc?.tvdbId ||
          apiArtwork?.tvdbId ||
          Number(apiAnime?.thetvdbId) ||
          0;
        const tmdbId =
          firestoreDoc?.tmdbId ||
          apiArtwork?.tmdbId ||
          Number(apiAnime?.themoviedbId) ||
          0;
        const posterUrl =
          firestoreDoc?.posterUrl ||
          apiArtwork?.posterUrl ||
          apiAnime?.coverImage ||
          '';
        const backgroundUrl =
          firestoreDoc?.backgroundUrl ||
          apiArtwork?.backgroundUrl ||
          apiAnime?.bannerImage ||
          '';

        setAnimeMeta({
          title,
          anilistId: resolvedAnilistId,
          tvdbId,
          tmdbId,
          posterUrl,
          backgroundUrl,
          synopsis: apiAnime?.synopsis || apiAnime?.description || '',
          format: apiAnime?.format || 'TV',
          seasonYear: apiAnime?.seasonYear || null,
          rating: apiAnime?.averageScore || 88,
        });

        setLookupQuery(title);
        setLookupYear(apiAnime?.seasonYear ? String(apiAnime.seasonYear) : '');

        if (apiIdRes) {
          setIdResolutionInfo({
            aniListId: apiIdRes.aniListId ?? apiIdRes.anilistId ?? null,
            confidence: apiIdRes.confidence ?? 0,
            status: apiIdRes.status || apiIdRes.mappingStatus || 'failed',
            matchType: apiIdRes.matchType || 'none',
            matchedTitle: apiIdRes.matchedTitle || null,
            explanation: apiIdRes.explanation || '',
          });
          if (Array.isArray(apiIdRes.candidates)) {
            setLookupCandidates(apiIdRes.candidates);
          }
        }

        const mergedFanartLogos: FanartLogoItem[] =
          apiArtwork?.availableLogos && apiArtwork.availableLogos.length > 0
            ? apiArtwork.availableLogos
            : firestoreDoc?.availableLogos || [];

        const docCustomLogos = firestoreDoc?.customLogos || [];
        const docHiddenIds = firestoreDoc?.hiddenLogoIds || [];
        const docMode = firestoreDoc?.selectionMode || 'auto';
        const docDisplay =
          firestoreDoc?.logoDisplay || DEFAULT_LOGO_DISPLAY_SETTINGS;

        const resolved = resolveAnimeLogoSelection({
          availableLogos: mergedFanartLogos,
          customLogos: docCustomLogos,
          hiddenLogoIds: docHiddenIds,
          selectionMode: docMode,
          manualLogoUrl: firestoreDoc?.selectedLogoUrl || null,
          manualLogoSource: firestoreDoc?.selectedLogoSource,
          manualLogoLanguage: firestoreDoc?.selectedLogoLanguage,
          logoDisplay: docDisplay,
          preferEnglish: true,
        });

        setAvailableLogos(mergedFanartLogos);
        setCustomLogos(docCustomLogos);
        setHiddenLogoIds(docHiddenIds);
        setSelectionMode(resolved.selectionMode);
        setSelectedLogoUrl(resolved.logoUrl || '');
        setSelectedLogoSource(resolved.selectedLogoSource);
        setSelectedLogoLanguage(resolved.selectedLogoLanguage);
        setLogoDisplay(resolved.logoDisplay);
        setReviewed(firestoreDoc?.reviewed ?? false);
        setOverrideDoc(firestoreDoc);
      } catch (err) {
        console.error('Error loading artwork manager data:', err);
      } finally {
        setLoading(false);
      }
    },
    [hoshikaId]
  );

  useEffect(() => {
    loadArtworkData(false);
  }, [loadArtworkData]);

  const handleSearchAniList = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = lookupQuery.trim();
    if (!q) return;

    setLookupLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const params = new URLSearchParams({
        action: 'search_anilist',
        q,
      });
      if (lookupYear.trim()) {
        params.set('year', lookupYear.trim());
      }
      if (animeMeta.format) {
        params.set('format', animeMeta.format);
      }

      const res = await fetch(`/api/admin/artwork?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (data?.ok) {
        setLookupCandidates(data.candidates || []);
        setLookupCollectedTitles(data.collectedTitles || []);
      } else {
        showToast(data?.error || 'AniList search failed');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'AniList lookup failed');
    } finally {
      setLookupLoading(false);
    }
  };

  const handlePreviewCandidateInSession = async (candidate: AniListCandidateSummary) => {
    setPreviewingCandidateId(candidate.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Authentication required');

      const res = await fetch('/api/admin/artwork', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'preview_anilist_candidate',
          hoshikaId,
          anilistId: candidate.id,
          title: candidate.englishTitle || candidate.romajiTitle || animeMeta.title,
          format: candidate.format || animeMeta.format,
        }),
      });
      const data = await res.json();
      if (!data?.ok) {
        throw new Error(data?.error || 'Failed to preview candidate');
      }

      const previewArtwork = data.artwork;
      setAnimeMeta((prev) => ({
        ...prev,
        anilistId: candidate.id,
        tvdbId: previewArtwork?.tvdbId || prev.tvdbId,
        tmdbId: previewArtwork?.tmdbId || prev.tmdbId,
        backgroundUrl: previewArtwork?.backgroundUrl || prev.backgroundUrl,
        posterUrl: previewArtwork?.posterUrl || prev.posterUrl,
      }));

      if (
        Array.isArray(previewArtwork?.availableLogos) &&
        previewArtwork.availableLogos.length > 0
      ) {
        setAvailableLogos(previewArtwork.availableLogos);
      }

      setIdResolutionInfo({
        aniListId: candidate.id,
        confidence: candidate.confidence,
        status: candidate.confidence >= 0.75 ? 'verified' : 'provisional',
        matchType: candidate.matchType,
        matchedTitle:
          candidate.englishTitle || candidate.romajiTitle || candidate.nativeTitle,
        explanation: `Verified in session (#${candidate.id}) — ${candidate.explanation}`,
      });

      showToast(
        `Verified AniList #${candidate.id} in session (TVDB: ${
          previewArtwork?.tvdbId || 'N/A'
        }). No AniList ID stored in Firebase.`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to preview candidate');
    } finally {
      setPreviewingCandidateId(null);
    }
  };

  const persistArtworkState = async (params: {
    nextMode: 'auto' | 'manual';
    nextLogoUrl: string;
    nextSource:
      | 'fanart_hdtvlogo'
      | 'fanart_clearlogo'
      | 'custom_upload'
      | 'typography_fallback';
    nextLang: string;
    nextCustomLogos: CustomLogoItem[];
    nextHiddenIds: string[];
    nextDisplay: LogoDisplaySettings;
    nextReviewed: boolean;
    auditAction:
      | 'select_logo'
      | 'upload_logo'
      | 'delete_logo'
      | 'reset_auto'
      | 'restore_previous'
      | 'update_display'
      | 'hide_logo'
      | 'mark_reviewed';
    activityDescription: string;
  }) => {
    if (!canManageArtwork) return;
    setSaving(true);

    const prevLogoUrl = selectedLogoUrl;
    const prevSource = selectedLogoSource;

    const resolved = resolveAnimeLogoSelection({
      availableLogos,
      customLogos: params.nextCustomLogos,
      hiddenLogoIds: params.nextHiddenIds,
      selectionMode: params.nextMode,
      manualLogoUrl: params.nextLogoUrl || null,
      manualLogoSource: params.nextSource,
      manualLogoLanguage: params.nextLang,
      logoDisplay: params.nextDisplay,
      preferEnglish: true,
    });

    // Notice: anilistId is NEVER written to Firestore
    const savedDoc = await saveAnimeArtworkOverride({
      hoshikaId,
      tvdbId: animeMeta.tvdbId,
      tmdbId: animeMeta.tmdbId,
      title: animeMeta.title,
      selectedLogoUrl: resolved.logoUrl || '',
      selectedLogoSource: resolved.selectedLogoSource,
      selectedLogoLanguage: resolved.selectedLogoLanguage,
      selectionMode: resolved.selectionMode,
      availableLogos,
      customLogos: params.nextCustomLogos,
      hiddenLogoIds: params.nextHiddenIds,
      logoDisplay: params.nextDisplay,
      logoStatus: resolved.logoStatus as AnimeLogoStatus,
      backgroundUrl: animeMeta.backgroundUrl,
      posterUrl: animeMeta.posterUrl,
      hasEnglishLogo: resolved.hasEnglishLogo,
      hasJapaneseLogo: resolved.hasJapaneseLogo,
      reviewed: params.nextReviewed,
    });

    await Promise.all([
      recordArtworkAuditLog({
        hoshikaId,
        animeTitle: animeMeta.title,
        previousLogoUrl: prevLogoUrl,
        newLogoUrl: resolved.logoUrl || '',
        previousSource: prevSource,
        newSource: resolved.selectedLogoSource,
        selectionMode: resolved.selectionMode,
        action: params.auditAction,
      }),
      recordAdminActivity({
        category: 'artwork',
        action: params.activityDescription,
        targetId: hoshikaId,
        targetName: animeMeta.title,
        details: `Mode: ${resolved.selectionMode}, Source: ${resolved.selectedLogoSource}`,
      }),
    ]);

    setSelectionMode(resolved.selectionMode);
    setSelectedLogoUrl(resolved.logoUrl || '');
    setSelectedLogoSource(resolved.selectedLogoSource);
    setSelectedLogoLanguage(resolved.selectedLogoLanguage);
    setCustomLogos(params.nextCustomLogos);
    setHiddenLogoIds(params.nextHiddenIds);
    setLogoDisplay(params.nextDisplay);
    setReviewed(params.nextReviewed);
    setOverrideDoc(savedDoc);
  };

  const handleSelectFanartLogo = async (logo: FanartLogoItem) => {
    try {
      await persistArtworkState({
        nextMode: 'manual',
        nextLogoUrl: logo.proxyUrl || logo.url,
        nextSource: logo.source,
        nextLang: logo.lang,
        nextCustomLogos: customLogos,
        nextHiddenIds: hiddenLogoIds,
        nextDisplay: logoDisplay,
        nextReviewed: true,
        auditAction: 'select_logo',
        activityDescription: `Manually locked ${logo.category.toUpperCase()} (${logo.lang.toUpperCase()})`,
      });
      showToast('Artwork configuration saved & synced to live hero banner.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save logo');
    } finally {
      setSaving(false);
    }
  };

  const handleSelectCustomLogo = async (logo: CustomLogoItem) => {
    try {
      await persistArtworkState({
        nextMode: 'manual',
        nextLogoUrl: logo.url,
        nextSource: 'custom_upload',
        nextLang: logo.lang || 'en',
        nextCustomLogos: customLogos,
        nextHiddenIds: hiddenLogoIds,
        nextDisplay: logoDisplay,
        nextReviewed: true,
        auditAction: 'select_logo',
        activityDescription: `Activated custom uploaded logo (${logo.fileName})`,
      });
      showToast('Custom logo activated.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to activate custom logo');
    } finally {
      setSaving(false);
    }
  };

  const handleCustomUpload = async (payload: {
    blob: Blob;
    fileName: string;
    mimeType: 'image/png' | 'image/webp';
    width: number;
    height: number;
  }) => {
    if (!canUploadLogos) {
      throw new Error('You do not have permission to upload custom logos');
    }

    // Step 1: Upload to Firebase Storage
    const uploaded = await uploadCustomAnimeLogoFile({
      hoshikaId,
      file: payload.blob,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      width: payload.width,
      height: payload.height,
    });

    const nextCustomList = [uploaded, ...customLogos];

    // Step 2: Persist metadata in Firestore; if Firestore fails, roll back the Storage file!
    try {
      await persistArtworkState({
        nextMode: 'manual',
        nextLogoUrl: uploaded.url,
        nextSource: 'custom_upload',
        nextLang: 'en',
        nextCustomLogos: nextCustomList,
        nextHiddenIds: hiddenLogoIds,
        nextDisplay: logoDisplay,
        nextReviewed: true,
        auditAction: 'upload_logo',
        activityDescription: `Uploaded & locked custom transparent logo (${uploaded.fileName})`,
      });
      showToast('Custom logo uploaded and synced to live hero banner.');
    } catch (firestoreErr) {
      // Automatic transactional rollback of orphaned Firebase Storage object
      await deleteCustomLogoFromStorage(uploaded.storagePath);
      throw firestoreErr;
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCustomLogo = async (logo: CustomLogoItem) => {
    if (!canDeleteLogos) return;
    setSaving(true);
    try {
      await deleteCustomLogoFromStorage(logo.storagePath);
      const nextCustomList = customLogos.filter((c) => c.id !== logo.id);
      const wasActive = selectedLogoUrl === logo.url;

      await persistArtworkState({
        nextMode: wasActive ? 'auto' : selectionMode,
        nextLogoUrl: wasActive ? '' : selectedLogoUrl,
        nextSource: wasActive ? 'typography_fallback' : selectedLogoSource,
        nextLang: selectedLogoLanguage,
        nextCustomLogos: nextCustomList,
        nextHiddenIds: hiddenLogoIds,
        nextDisplay: logoDisplay,
        nextReviewed: reviewed,
        auditAction: 'delete_logo',
        activityDescription: `Deleted custom logo (${logo.fileName})`,
      });
      showToast('Custom logo deleted.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete custom logo');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleHideLogo = async (logoId: string) => {
    const isHidden = hiddenLogoIds.includes(logoId);
    const nextHidden = isHidden
      ? hiddenLogoIds.filter((id) => id !== logoId)
      : [...hiddenLogoIds, logoId];

    try {
      await persistArtworkState({
        nextMode: selectionMode,
        nextLogoUrl: selectedLogoUrl,
        nextSource: selectedLogoSource,
        nextLang: selectedLogoLanguage,
        nextCustomLogos: customLogos,
        nextHiddenIds: nextHidden,
        nextDisplay: logoDisplay,
        nextReviewed: reviewed,
        auditAction: 'hide_logo',
        activityDescription: isHidden
          ? `Unhid Fanart logo (${logoId})`
          : `Hid broken/undesired Fanart logo (${logoId})`,
      });
      showToast('Logo visibility updated.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update logo visibility');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToAuto = async () => {
    try {
      await persistArtworkState({
        nextMode: 'auto',
        nextLogoUrl: '',
        nextSource: 'typography_fallback',
        nextLang: 'en',
        nextCustomLogos: customLogos,
        nextHiddenIds: hiddenLogoIds,
        nextDisplay: DEFAULT_LOGO_DISPLAY_SETTINGS,
        nextReviewed: true,
        auditAction: 'reset_auto',
        activityDescription: 'Reset logo selection to Automatic English HDTV priority',
      });
      showToast('Reset to automatic English HDTV logo selection.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to reset to auto');
    } finally {
      setSaving(false);
    }
  };

  const handleForceTypographyFallback = async () => {
    try {
      await persistArtworkState({
        nextMode: 'manual',
        nextLogoUrl: '',
        nextSource: 'typography_fallback',
        nextLang: 'en',
        nextCustomLogos: customLogos,
        nextHiddenIds: hiddenLogoIds,
        nextDisplay: logoDisplay,
        nextReviewed: true,
        auditAction: 'select_logo',
        activityDescription: 'Forced clean Hoshika typography fallback',
      });
      showToast('Typography fallback locked.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to lock typography');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDisplaySettings = async () => {
    try {
      await persistArtworkState({
        nextMode: selectionMode,
        nextLogoUrl: selectedLogoUrl,
        nextSource: selectedLogoSource,
        nextLang: selectedLogoLanguage,
        nextCustomLogos: customLogos,
        nextHiddenIds: hiddenLogoIds,
        nextDisplay: logoDisplay,
        nextReviewed: true,
        auditAction: 'update_display',
        activityDescription: `Updated logo display sizing (${logoDisplay.width}px, ${logoDisplay.scale}% scale)`,
      });
      showToast('Display settings saved.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save display settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-12 flex flex-col items-center justify-center gap-3">
        <Loader2 size={26} className="text-white animate-spin" />
        <p className="text-xs font-mono text-[#A0A0A0]">
          Loading Fanart.tv logos, AniList ID resolution, & Firestore overrides...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Toast */}
      {statusToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-white text-black font-bold text-xs shadow-2xl border border-white/20">
          <CheckCircle2 size={16} />
          <span>{statusToast}</span>
        </div>
      )}

      {/* Top Header Bar */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black text-white">{animeMeta.title}</h2>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-[#141414] border border-[#292929] text-[#A0A0A0]">
              Hoshika #{hoshikaId}
            </span>
            {selectionMode === 'manual' ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-white text-black font-bold">
                <Lock size={11} />
                MANUAL OVERRIDE LOCKED
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-[#141414] border border-[#292929] text-white">
                <Sparkles size={11} />
                AUTO ENGLISH PRIORITY
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-[#A0A0A0] font-mono">
            <span>AniList ID (In-Memory): {animeMeta.anilistId || 'N/A'}</span>
            <span>TVDB ID: {animeMeta.tvdbId || 'N/A'}</span>
            <span>TMDB ID: {animeMeta.tmdbId || 'N/A'}</span>
            {overrideDoc?.updatedByEmail && (
              <span>Last edited by: {overrideDoc.updatedByEmail}</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/anime/${hoshikaId}`}
            target="_blank"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white transition-colors"
          >
            <span>Open Live Anime Page</span>
            <ExternalLink size={13} />
          </Link>

          <button
            type="button"
            onClick={() => loadArtworkData(true)}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            <RefreshCw size={13} />
            <span>Re-Fetch Fanart.tv</span>
          </button>

          {canManageArtwork && (
            <button
              type="button"
              onClick={handleResetToAuto}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white text-black hover:bg-[#E5E5E5] text-xs font-bold transition-colors cursor-pointer"
            >
              <RotateCcw size={13} />
              <span>Reset to Automatic</span>
            </button>
          )}
        </div>
      </div>

      {/* Live Hero Preview */}
      <ArtworkPreview
        animeTitle={animeMeta.title}
        backgroundUrl={animeMeta.backgroundUrl}
        posterUrl={animeMeta.posterUrl}
        logoUrl={selectedLogoUrl || null}
        logoDisplay={logoDisplay}
        onChangeDisplay={setLogoDisplay}
      />

      {/* AniList ID Lookup & Verification Tool (In-Memory Only — Zero Firebase Persistence) */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <ShieldCheck size={16} className="text-white" />
              <span>AniList ID Lookup & Verification Tool</span>
              <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#292929] text-[10px] font-mono text-[#A0A0A0]">
                IN-MEMORY ONLY • ZERO FIREBASE STORAGE
              </span>
            </h3>
            <p className="text-xs text-[#A0A0A0] mt-0.5">
              Search AniList across English, Romaji, Japanese, Korean, and alternative titles to verify candidate IDs and preview Fanart artwork.
            </p>
          </div>

          {idResolutionInfo && (
            <div className="flex items-center gap-2 text-xs font-mono bg-[#141414] border border-[#292929] px-3 py-1.5 rounded-lg">
              <span className="text-[#A0A0A0]">Active Match:</span>
              <span className="text-white font-bold">
                {idResolutionInfo.aniListId ? `#${idResolutionInfo.aniListId}` : 'None'}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-white text-black font-bold text-[10px] uppercase">
                {Math.round((idResolutionInfo.confidence || 0) * 100)}% • {idResolutionInfo.status}
              </span>
            </div>
          )}
        </div>

        {idResolutionInfo?.explanation && (
          <div className="px-3.5 py-2.5 rounded-lg bg-[#141414]/70 border border-[#292929] text-xs font-mono text-[#A0A0A0]">
            <span className="text-white font-bold">Resolution Diagnostics: </span>
            {idResolutionInfo.explanation}
          </div>
        )}

        <form onSubmit={handleSearchAniList} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#707070]"
            />
            <input
              type="text"
              value={lookupQuery}
              onChange={(e) => setLookupQuery(e.target.value)}
              placeholder="Search anime title, Romaji, Japanese, or synonym (e.g., Overgeared, Temppal, 템빨)..."
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-[#141414] border border-[#292929] focus:border-white text-xs text-white placeholder-[#707070] focus:outline-none"
            />
          </div>
          <input
            type="number"
            value={lookupYear}
            onChange={(e) => setLookupYear(e.target.value)}
            placeholder="Year (opt)"
            className="w-full sm:w-28 px-3 py-2 rounded-lg bg-[#141414] border border-[#292929] focus:border-white text-xs text-white placeholder-[#707070] font-mono focus:outline-none"
          />
          <button
            type="submit"
            disabled={lookupLoading}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-white text-black font-bold text-xs hover:bg-[#E5E5E5] transition-colors cursor-pointer disabled:opacity-50"
          >
            {lookupLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Search size={14} />
            )}
            <span>Search AniList</span>
          </button>
        </form>

        {lookupCollectedTitles.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-[#707070]">
            <span>Normalized search variants:</span>
            {lookupCollectedTitles.map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded bg-[#141414] border border-[#292929] text-[#A0A0A0]"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {lookupCandidates.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {lookupCandidates.slice(0, 6).map((cand) => {
              const isCurrent = animeMeta.anilistId === cand.id;
              const confidencePct = Math.round(cand.confidence * 100);
              const confidenceLabel =
                cand.confidence >= 0.9
                  ? 'Very High Confidence'
                  : cand.confidence >= 0.75
                  ? 'High Confidence'
                  : cand.confidence >= 0.6
                  ? 'Possible Match'
                  : 'Uncertain';

              return (
                <div
                  key={cand.id}
                  className={`rounded-xl border p-3.5 flex flex-col justify-between gap-3 transition-all ${
                    isCurrent
                      ? 'border-white bg-white/[0.06]'
                      : 'border-[#292929] bg-[#141414]/40 hover:border-[#707070]'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-white">
                          {cand.englishTitle || cand.romajiTitle || `AniList #${cand.id}`}
                        </div>
                        {cand.romajiTitle && cand.romajiTitle !== cand.englishTitle && (
                          <div className="text-[11px] text-[#A0A0A0] font-mono">
                            Romaji: {cand.romajiTitle}
                          </div>
                        )}
                        {cand.nativeTitle && (
                          <div className="text-[11px] text-[#707070] font-mono">
                            Native: {cand.nativeTitle}
                          </div>
                        )}
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold shrink-0 ${
                          cand.confidence >= 0.75
                            ? 'bg-white text-black'
                            : 'bg-[#1F1F1F] text-[#A0A0A0] border border-[#292929]'
                        }`}
                      >
                        {confidencePct}% • {confidenceLabel}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-[#A0A0A0]">
                      <span className="px-1.5 py-0.5 rounded bg-[#0A0A0A] border border-[#292929] text-white">
                        AniList #{cand.id}
                      </span>
                      <span>Format: {cand.format || 'N/A'}</span>
                      <span>Year: {cand.seasonYear || 'TBA'}</span>
                      <span>Episodes: {cand.episodes ?? 'N/A'}</span>
                    </div>

                    {cand.synonyms && cand.synonyms.length > 0 && (
                      <div className="text-[10px] font-mono text-[#707070] truncate">
                        Synonyms: {cand.synonyms.slice(0, 4).join(' • ')}
                      </div>
                    )}

                    <p className="text-[11px] text-[#A0A0A0] bg-[#0A0A0A] border border-[#292929] rounded px-2.5 py-1.5 font-mono">
                      {cand.explanation}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#292929]/60">
                    <a
                      href={`https://anilist.co/anime/${cand.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-mono text-[#A0A0A0] hover:text-white"
                    >
                      <span>Open AniList Page</span>
                      <ExternalLink size={11} />
                    </a>

                    <button
                      type="button"
                      disabled={previewingCandidateId === cand.id}
                      onClick={() => handlePreviewCandidateInSession(cand)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                        isCurrent
                          ? 'bg-white text-black'
                          : 'bg-[#141414] border border-[#292929] text-white hover:border-white'
                      }`}
                    >
                      {previewingCandidateId === cand.id ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 size={11} className="animate-spin" />
                          Verifying...
                        </span>
                      ) : isCurrent ? (
                        'Active Session Candidate'
                      ) : (
                        'Test & Preview Candidate'
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Logo Position & Sizing Controls */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sliders size={16} />
              <span>Hero Logo Sizing & Placement Controls</span>
            </h3>
            <p className="text-xs text-[#A0A0A0] mt-0.5">
              Fine-tune width, scale percentage, and horizontal/vertical offset for the selected logo.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLogoDisplay(DEFAULT_LOGO_DISPLAY_SETTINGS)}
              className="px-3 py-1.5 rounded-lg bg-[#141414] border border-[#292929] text-xs text-[#A0A0A0] hover:text-white cursor-pointer"
            >
              Reset Sliders
            </button>
            {canManageArtwork && (
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveDisplaySettings}
                className="px-3.5 py-1.5 rounded-lg bg-white text-black font-bold text-xs hover:bg-[#E5E5E5] cursor-pointer"
              >
                Save Sizing
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
          <div className="p-3.5 rounded-lg bg-[#141414] border border-[#292929] space-y-2">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-[#A0A0A0]">Max Width</span>
              <span className="text-white font-bold">{logoDisplay.width}px</span>
            </div>
            <input
              type="range"
              min={220}
              max={640}
              step={10}
              value={logoDisplay.width}
              onChange={(e) =>
                setLogoDisplay((prev) => ({
                  ...prev,
                  width: Number(e.target.value),
                }))
              }
              className="w-full accent-white cursor-pointer"
            />
          </div>

          <div className="p-3.5 rounded-lg bg-[#141414] border border-[#292929] space-y-2">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-[#A0A0A0]">Scale</span>
              <span className="text-white font-bold">{logoDisplay.scale}%</span>
            </div>
            <input
              type="range"
              min={60}
              max={140}
              step={5}
              value={logoDisplay.scale}
              onChange={(e) =>
                setLogoDisplay((prev) => ({
                  ...prev,
                  scale: Number(e.target.value),
                }))
              }
              className="w-full accent-white cursor-pointer"
            />
          </div>

          <div className="p-3.5 rounded-lg bg-[#141414] border border-[#292929] space-y-2">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-[#A0A0A0]">Horizontal Offset</span>
              <span className="text-white font-bold">
                {logoDisplay.horizontalPosition}px
              </span>
            </div>
            <input
              type="range"
              min={-100}
              max={100}
              step={4}
              value={logoDisplay.horizontalPosition}
              onChange={(e) =>
                setLogoDisplay((prev) => ({
                  ...prev,
                  horizontalPosition: Number(e.target.value),
                }))
              }
              className="w-full accent-white cursor-pointer"
            />
          </div>

          <div className="p-3.5 rounded-lg bg-[#141414] border border-[#292929] space-y-2">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-[#A0A0A0]">Vertical Offset</span>
              <span className="text-white font-bold">
                {logoDisplay.verticalPosition}px
              </span>
            </div>
            <input
              type="range"
              min={-60}
              max={60}
              step={4}
              value={logoDisplay.verticalPosition}
              onChange={(e) =>
                setLogoDisplay((prev) => ({
                  ...prev,
                  verticalPosition: Number(e.target.value),
                }))
              }
              className="w-full accent-white cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Custom Logo Uploader */}
      {canUploadLogos && (
        <LogoUploader
          animeTitle={animeMeta.title}
          onUploadProcessedLogo={handleCustomUpload}
          disabled={saving}
        />
      )}

      {/* Custom Uploaded Logos Gallery */}
      {customLogos.length > 0 && (
        <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white">
            Custom Uploaded Logos ({customLogos.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {customLogos.map((custom) => {
              const isSelected =
                selectedLogoSource === 'custom_upload' &&
                selectedLogoUrl === custom.url;
              return (
                <div
                  key={custom.id}
                  className={`rounded-xl border p-4 flex flex-col justify-between gap-3 transition-all ${
                    isSelected
                      ? 'border-white bg-white/[0.06]'
                      : 'border-[#292929] bg-[#141414]/60'
                  }`}
                >
                  <div className="h-28 rounded-lg bg-[#050505] border border-[#292929] flex items-center justify-center p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={custom.url}
                      alt={custom.fileName}
                      className="max-h-20 max-w-full object-contain"
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono text-[#A0A0A0]">
                    <span className="truncate max-w-[160px] text-white">
                      {custom.fileName}
                    </span>
                    <span>
                      {custom.width}×{custom.height}px
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={saving || isSelected}
                      onClick={() => handleSelectCustomLogo(custom)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                        isSelected
                          ? 'bg-white text-black'
                          : 'bg-[#141414] border border-[#292929] text-white hover:border-white'
                      }`}
                    >
                      <Check size={13} />
                      <span>{isSelected ? 'Active Logo' : 'Use This Logo'}</span>
                    </button>

                    {canDeleteLogos && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleDeleteCustomLogo(custom)}
                        className="p-2 rounded-lg bg-[#141414] border border-[#292929] text-[#A0A0A0] hover:text-white hover:border-white cursor-pointer"
                        title="Delete from Firebase Storage"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Fanart.tv Available Logos Grid */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white">
              Available Fanart.tv Logos ({availableLogos.length})
            </h3>
            <p className="text-xs text-[#A0A0A0] mt-0.5">
              Sorted by priority: English HDTVLogo → English ClearLogo → Japanese HDTVLogo → Japanese ClearLogo.
            </p>
          </div>

          {canManageArtwork && (
            <button
              type="button"
              disabled={saving}
              onClick={handleForceTypographyFallback}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                selectedLogoSource === 'typography_fallback' &&
                selectionMode === 'manual'
                  ? 'bg-white text-black border-white'
                  : 'bg-[#141414] border-[#292929] text-[#A0A0A0] hover:text-white'
              }`}
            >
              <Type size={13} />
              <span>Use Typography Title Fallback</span>
            </button>
          )}
        </div>

        {availableLogos.length === 0 ? (
          <div className="border border-[#292929] rounded-xl p-8 text-center bg-[#141414]/30 space-y-2">
            <AlertTriangle size={22} className="text-[#A0A0A0] mx-auto" />
            <p className="text-sm font-semibold text-white">
              No Fanart.tv transparent logos found for this series
            </p>
            <p className="text-xs text-[#A0A0A0]">
              Upload a custom transparent PNG/WebP logo above, verify the AniList ID in the tool above, or keep the clean Hoshika typography fallback.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {availableLogos.map((logo) => {
              const targetUrl = logo.proxyUrl || logo.url;
              const isSelected =
                selectedLogoUrl === targetUrl || selectedLogoUrl === logo.url;
              const isHidden = hiddenLogoIds.includes(logo.id);

              return (
                <div
                  key={logo.id}
                  className={`rounded-xl border p-4 flex flex-col justify-between gap-3 transition-all ${
                    isSelected
                      ? 'border-white bg-white/[0.06]'
                      : isHidden
                      ? 'border-[#292929]/50 bg-[#0A0A0A] opacity-50'
                      : 'border-[#292929] bg-[#141414]/50 hover:border-[#707070]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                    <div className="flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded bg-white text-black font-bold uppercase">
                        {logo.lang || 'EN'}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#0A0A0A] border border-[#292929] text-white uppercase">
                        {logo.category}
                      </span>
                    </div>
                    <span className="text-[#A0A0A0]">{logo.likes} likes</span>
                  </div>

                  <div className="h-28 rounded-lg bg-[#050505] border border-[#292929] flex items-center justify-center p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={targetUrl}
                      alt={logo.label || logo.id}
                      className="max-h-20 max-w-full object-contain"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={saving || isHidden}
                      onClick={() => handleSelectFanartLogo(logo)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-white text-black'
                          : 'bg-[#0A0A0A] border border-[#292929] text-white hover:border-white'
                      }`}
                    >
                      <Check size={13} />
                      <span>
                        {isSelected
                          ? selectionMode === 'manual'
                            ? 'Locked Manual'
                            : 'Active (Auto)'
                          : 'Select & Lock'}
                      </span>
                    </button>

                    {canManageArtwork && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleToggleHideLogo(logo.id)}
                        className="p-2 rounded-lg bg-[#0A0A0A] border border-[#292929] text-[#A0A0A0] hover:text-white cursor-pointer"
                        title={isHidden ? 'Unhide logo' : 'Hide broken/wrong logo'}
                      >
                        {isHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
