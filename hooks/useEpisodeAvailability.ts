'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AudioLanguage,
  EpisodeAvailabilityResult,
  getCachedEpisodeAvailability,
  resolveEpisodeAvailability,
  selectDefaultLanguage,
} from '@/lib/episode-store';

export interface UseEpisodeAvailabilityReturn {
  availability: EpisodeAvailabilityResult;
  isLoadingAvailability: boolean;
  hasSub: boolean;
  hasDub: boolean;
  hasBoth: boolean;
  hasAny: boolean;
  refreshAvailability: () => Promise<EpisodeAvailabilityResult>;
}

const INITIAL_LOADING_AVAILABILITY: EpisodeAvailabilityResult = {
  sub: { available: false, status: 'loading', episodeCount: 0 },
  dub: { available: false, status: 'loading', episodeCount: 0 },
  defaultLanguage: null,
};

export function useEpisodeAvailability(
  animeId: string | number,
  options?: {
    preferredLanguage?: AudioLanguage | null;
    initialAvailability?: EpisodeAvailabilityResult | null;
    deferFetch?: boolean;
    onResolvedLanguage?: (lang: AudioLanguage) => void;
  }
): UseEpisodeAvailabilityReturn {
  const key = String(animeId).trim();
  const preferredLanguage = options?.preferredLanguage ?? null;
  const deferFetch = Boolean(options?.deferFetch);
  const onResolvedLanguageRef = useRef(options?.onResolvedLanguage);
  useEffect(() => {
    onResolvedLanguageRef.current = options?.onResolvedLanguage;
  }, [options?.onResolvedLanguage]);

  const [availability, setAvailability] = useState<EpisodeAvailabilityResult>(() => {
    if (options?.initialAvailability) {
      return {
        ...options.initialAvailability,
        defaultLanguage: selectDefaultLanguage(
          options.initialAvailability,
          preferredLanguage
        ),
      };
    }
    if (!deferFetch) {
      const cached = getCachedEpisodeAvailability(key);
      if (cached) {
        return {
          ...cached,
          defaultLanguage: selectDefaultLanguage(cached, preferredLanguage),
        };
      }
    }
    return INITIAL_LOADING_AVAILABILITY;
  });

  const [isLoadingAvailability, setIsLoadingAvailability] = useState<boolean>(() => {
    if (options?.initialAvailability) return false;
    if (deferFetch) return true;
    return !getCachedEpisodeAvailability(key);
  });

  const initialAvailability = options?.initialAvailability ?? null;

  useEffect(() => {
    let isMounted = true;

    if (initialAvailability) {
      const next: EpisodeAvailabilityResult = {
        ...initialAvailability,
        defaultLanguage: selectDefaultLanguage(initialAvailability, preferredLanguage),
      };
      setAvailability(next);
      setIsLoadingAvailability(false);
      if (next.defaultLanguage && onResolvedLanguageRef.current) {
        onResolvedLanguageRef.current(next.defaultLanguage);
      }
      return;
    }

    if (deferFetch) {
      setIsLoadingAvailability(true);
      setAvailability(INITIAL_LOADING_AVAILABILITY);
      return;
    }

    const cached = getCachedEpisodeAvailability(key);
    if (cached) {
      const next: EpisodeAvailabilityResult = {
        ...cached,
        defaultLanguage: selectDefaultLanguage(cached, preferredLanguage),
      };
      setAvailability(next);
      setIsLoadingAvailability(false);
      if (next.defaultLanguage && onResolvedLanguageRef.current) {
        onResolvedLanguageRef.current(next.defaultLanguage);
      }
      return;
    }

    setIsLoadingAvailability(true);
    setAvailability(INITIAL_LOADING_AVAILABILITY);

    resolveEpisodeAvailability(key, { preferredLanguage })
      .then((resolved) => {
        if (!isMounted) return;
        setAvailability(resolved);
        setIsLoadingAvailability(false);
        if (resolved.defaultLanguage && onResolvedLanguageRef.current) {
          onResolvedLanguageRef.current(resolved.defaultLanguage);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setIsLoadingAvailability(false);
      });

    return () => {
      isMounted = false;
    };
  }, [key, preferredLanguage, initialAvailability, deferFetch]);

  const refreshAvailability = useCallback(async () => {
    setIsLoadingAvailability(true);
    const resolved = await resolveEpisodeAvailability(key, {
      preferredLanguage,
      forceRefresh: true,
    });
    setAvailability(resolved);
    setIsLoadingAvailability(false);
    if (resolved.defaultLanguage && onResolvedLanguageRef.current) {
      onResolvedLanguageRef.current(resolved.defaultLanguage);
    }
    return resolved;
  }, [key, preferredLanguage]);

  const hasSub = availability.sub.available && availability.sub.episodeCount > 0;
  const hasDub = availability.dub.available && availability.dub.episodeCount > 0;

  return {
    availability,
    isLoadingAvailability,
    hasSub,
    hasDub,
    hasBoth: hasSub && hasDub,
    hasAny: hasSub || hasDub,
    refreshAvailability,
  };
}
