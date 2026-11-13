'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { AnimeArtworkResult } from '@/types/artwork';
import { AnimeArtworkFirestoreDoc } from '@/lib/admin/admin-firestore';
import { resolveAnimeLogoSelection } from '@/lib/artwork/logo-selector';
import {
  appendArtworkVersion,
  isDeadLegacyFanartUrl,
  isValidBackdropCandidateUrl,
  normalizeArtworkVersionToken,
  toSafeArtworkUrl,
  unwrapProxiedArtworkUrl,
} from '@/lib/artwork-mapper';

/**
 * Subscribes to /animeArtwork/{hoshikaId} in Firestore so any admin logo override,
 * custom logo upload, backdrop override, or display adjustment updates the hero banner
 * in real time, while strictly filtering out dead /fanart/tv/ placeholder URLs.
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
          const versionToken = normalizeArtworkVersionToken(override.updatedAt);
          const isSameServerVersion =
            Boolean(prev) &&
            versionToken !== null &&
            prev?.overrideUpdatedAt === versionToken;

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
              ? toSafeArtworkUrl(override.backgroundUrl, versionToken)
              : null;

          const sameCanonicalBg =
            Boolean(rawOverrideBg && prev?.backgroundUrl) &&
            unwrapProxiedArtworkUrl(rawOverrideBg) ===
              unwrapProxiedArtworkUrl(prev?.backgroundUrl);

          // Only prioritize override.backgroundUrl over an existing server-verified backdrop
          // when this snapshot reflects an actual override update (or matches the same canonical URL).
          // Otherwise, if SSR already skipped a dead 404 override URL, keep prev.backgroundUrl first.
          const hasExplicitAdminBackdrop = Boolean(
            rawOverrideBg &&
              (override.reviewed || override.selectionMode === 'manual') &&
              (!prev?.backgroundUrl || !isSameServerVersion || sameCanonicalBg)
          );

          const nextBg =
            (hasExplicitAdminBackdrop ? rawOverrideBg : null) ||
            prev?.backgroundUrl ||
            rawOverrideBg ||
            null;

          const safeOverrideCandidate =
            rawOverrideBg && (!isSameServerVersion || sameCanonicalBg || !prev?.backgroundUrl)
              ? rawOverrideBg
              : null;

          const nextBackdropCandidates = Array.from(
            new Set(
              [
                nextBg,
                safeOverrideCandidate,
                ...(prev?.backdropCandidates || []),
              ].filter((u): u is string =>
                Boolean(u && isValidBackdropCandidateUrl(u, hoshikaId))
              )
            )
          );

          const nextLogoUrl =
            resolved.logoUrl && !isDeadLegacyFanartUrl(resolved.logoUrl, hoshikaId)
              ? resolved.selectedLogoSource === 'custom_upload'
                ? appendArtworkVersion(resolved.logoUrl, versionToken)
                : toSafeArtworkUrl(
                    resolved.logoUrl,
                    resolved.selectionMode === 'manual' ? versionToken : null
                  )
              : prev?.logoUrl && !isDeadLegacyFanartUrl(prev.logoUrl, hoshikaId)
              ? prev.logoUrl
              : null;

          const nextPosterUrl =
            override.posterUrl &&
            !isDeadLegacyFanartUrl(override.posterUrl, hoshikaId) &&
            override.posterUrl.trim()
              ? toSafeArtworkUrl(override.posterUrl.trim(), versionToken)
              : prev?.posterUrl || null;

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
            posterUrl: nextPosterUrl,
            source:
              resolved.selectionMode === 'manual' ||
              resolved.selectedLogoSource === 'custom_upload' ||
              hasExplicitAdminBackdrop
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
            overrideUpdatedAt: versionToken,
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
