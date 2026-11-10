'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { AnimeArtworkResult } from '@/types/artwork';
import { AnimeArtworkFirestoreDoc } from '@/lib/admin/admin-firestore';
import { resolveAnimeLogoSelection } from '@/lib/artwork/logo-selector';

/**
 * Subscribes to /animeArtwork/{hoshikaId} in Firestore so any admin logo override,
 * custom logo upload, or display adjustment updates the hero banner in real time.
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
          const baseAvailable =
            override.availableLogos && override.availableLogos.length > 0
              ? override.availableLogos
              : prev?.availableLogos || [];

          const resolved = resolveAnimeLogoSelection({
            availableLogos: baseAvailable,
            customLogos: override.customLogos || [],
            hiddenLogoIds: override.hiddenLogoIds || [],
            selectionMode: override.selectionMode || 'auto',
            manualLogoUrl: override.selectedLogoUrl || null,
            manualLogoSource: override.selectedLogoSource,
            manualLogoLanguage: override.selectedLogoLanguage,
            logoDisplay: override.logoDisplay,
            preferEnglish: true,
          });

          return {
            hoshikaId,
            anilistId: prev?.anilistId || null,
            tvdbId: override.tvdbId || prev?.tvdbId || null,
            tmdbId: override.tmdbId || prev?.tmdbId || null,
            backgroundUrl: override.backgroundUrl || prev?.backgroundUrl || null,
            logoUrl: resolved.logoUrl,
            characterArtUrl: prev?.characterArtUrl || null,
            posterUrl: override.posterUrl || prev?.posterUrl || null,
            source:
              resolved.selectionMode === 'manual' ||
              resolved.selectedLogoSource === 'custom_upload'
                ? 'custom_override'
                : prev?.source || 'fanart',
            fetchedAt: Date.now(),
            availableLogos: resolved.availableLogos,
            customLogos: resolved.customLogos,
            hiddenLogoIds: resolved.hiddenLogoIds,
            selectionMode: resolved.selectionMode,
            selectedLogoSource: resolved.selectedLogoSource,
            selectedLogoLanguage: resolved.selectedLogoLanguage,
            logoDisplay: resolved.logoDisplay,
            logoStatus: resolved.logoStatus,
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
