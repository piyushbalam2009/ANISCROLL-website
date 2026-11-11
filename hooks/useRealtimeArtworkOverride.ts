'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { AnimeArtworkResult } from '@/types/artwork';
import { AnimeArtworkFirestoreDoc } from '@/lib/admin/admin-firestore';
import { resolveAnimeLogoSelection } from '@/lib/artwork/logo-selector';
import {
  isDeadLegacyFanartUrl,
  isValidBackdropCandidateUrl,
  toSafeArtworkUrl,
} from '@/lib/artwork-mapper';

/**
 * Subscribes to /animeArtwork/{hoshikaId} in Firestore so any admin logo override,
 * custom logo upload, or display adjustment updates the hero banner in real time,
 * while strictly filtering out dead /fanart/tv/ placeholder URLs from overwriting valid backdrops.
 */
export function useRealtimeArtworkOverride(
  hoshikaId: number,
  initialArtwork?: AnimeArtworkResult | null,
  format?: string | null
): AnimeArtworkResult | null | undefined {
  const [liveArtwork, setLiveArtwork] = useState<AnimeArtworkResult | null | undefined>(
    initialArtwork
  );

  useEffect(() => {
    setLiveArtwork(initialArtwork);
  }, [initialArtwork, hoshikaId]);

  useEffect(() => {
    if (!hoshikaId) return;

    const docRef = doc(db, 'animeArtwork', String(hoshikaId));
    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (!snap.exists()) return;
        const override = snap.data() as AnimeArtworkFirestoreDoc;
        setLiveArtwork((prev) => {
          const prevLogos = (prev?.availableLogos || []).filter(
            (l) => l?.url && !isDeadLegacyFanartUrl(l.url, hoshikaId)
          );
          const overrideLogos = (override.availableLogos || []).filter(
            (l) => l?.url && !isDeadLegacyFanartUrl(l.url, hoshikaId)
          );
          const mergedMap = new Map<string, (typeof prevLogos)[number]>();
          for (const logo of [...prevLogos, ...overrideLogos]) {
            if (!logo?.url) continue;
            const key = logo.id || logo.url;
            if (!mergedMap.has(key)) {
              mergedMap.set(key, logo);
            }
          }
          const baseAvailable = Array.from(mergedMap.values());

          const validManualLogoUrl =
            override.selectedLogoUrl &&
            !isDeadLegacyFanartUrl(override.selectedLogoUrl, hoshikaId)
              ? override.selectedLogoUrl
              : null;

          const resolved = resolveAnimeLogoSelection({
            availableLogos: baseAvailable,
            customLogos: override.customLogos || [],
            hiddenLogoIds: override.hiddenLogoIds || [],
            selectionMode: override.selectionMode || 'auto',
            manualLogoUrl: validManualLogoUrl,
            manualLogoSource: validManualLogoUrl
              ? override.selectedLogoSource
              : undefined,
            manualLogoLanguage: override.selectedLogoLanguage,
            logoDisplay: override.logoDisplay,
            preferEnglish: true,
          });

          const rawOverrideBg =
            override.backgroundUrl &&
            isValidBackdropCandidateUrl(override.backgroundUrl, hoshikaId)
              ? toSafeArtworkUrl(override.backgroundUrl)
              : null;

          // Prefer server-verified backgroundUrl unless override has a valid non-legacy backgroundUrl
          const nextBg = prev?.backgroundUrl || rawOverrideBg || null;
          const nextBackdropCandidates = Array.from(
            new Set(
              [
                nextBg,
                ...(prev?.backdropCandidates || []),
                rawOverrideBg,
              ].filter((u): u is string =>
                Boolean(u && isValidBackdropCandidateUrl(u, hoshikaId))
              )
            )
          );

          const nextLogoUrl =
            resolved.logoUrl && !isDeadLegacyFanartUrl(resolved.logoUrl, hoshikaId)
              ? resolved.selectedLogoSource === 'custom_upload'
                ? resolved.logoUrl
                : toSafeArtworkUrl(resolved.logoUrl)
              : prev?.logoUrl && !isDeadLegacyFanartUrl(prev.logoUrl, hoshikaId)
              ? prev.logoUrl
              : null;

          return {
            hoshikaId,
            anilistId: prev?.anilistId || null,
            tvdbId: prev?.tvdbId || override.tvdbId || null,
            tmdbId: prev?.tmdbId || override.tmdbId || null,
            backgroundUrl: nextBg,
            backgroundSource: prev?.backgroundSource,
            backdropCandidates: nextBackdropCandidates,
            logoUrl: nextLogoUrl,
            logoSource: nextLogoUrl
              ? resolved.selectedLogoSource === 'typography_fallback'
                ? prev?.logoSource || 'typography'
                : resolved.selectedLogoSource
              : 'typography',
            characterArtUrl: null,
            posterUrl:
              (override.posterUrl &&
                !isDeadLegacyFanartUrl(override.posterUrl, hoshikaId) &&
                override.posterUrl.trim()) ||
              prev?.posterUrl ||
              null,
            source:
              resolved.selectionMode === 'manual' ||
              resolved.selectedLogoSource === 'custom_upload'
                ? 'custom_override'
                : prev?.source || 'fanart',
            fetchedAt: Date.now(),
            logos: resolved.availableLogos,
            availableLogos: resolved.availableLogos,
            selectedLogo: resolved.selectedLogo,
            customLogos: resolved.customLogos,
            hiddenLogoIds: resolved.hiddenLogoIds,
            selectionMode: resolved.selectionMode,
            selectedLogoSource: nextLogoUrl
              ? resolved.selectedLogoSource
              : 'typography_fallback',
            selectedLogoLanguage: resolved.selectedLogoLanguage,
            logoDisplay: resolved.logoDisplay,
            logoStatus: nextLogoUrl ? resolved.logoStatus : 'typography_fallback',
            hasEnglishLogo: resolved.hasEnglishLogo,
            hasJapaneseLogo: resolved.hasJapaneseLogo,
            reviewed: override.reviewed,
          };
        });
      },
      () => {
        // Ignore snapshot errors on offline/public read fallback
      }
    );

    return () => unsubscribe();
  }, [hoshikaId, format]);

  return liveArtwork;
}
