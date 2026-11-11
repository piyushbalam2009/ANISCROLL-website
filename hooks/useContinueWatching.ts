'use client';

import { useState, useEffect, useCallback } from 'react';
import { WatchHistoryEntry } from '@/types/streaming';
import {
  getContinueWatching,
  saveWatchProgress,
  removeHistoryEntry,
} from '@/lib/storage';
import { enrichWatchHistoryEntries } from '@/lib/episode-store';

export function useContinueWatching() {
  const [items, setItems] = useState<WatchHistoryEntry[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const loadAndEnrich = () => {
      const current = getContinueWatching();
      setItems(current);
      if (current.length > 0) {
        enrichWatchHistoryEntries(current);
      }
    };

    loadAndEnrich();

    window.addEventListener('aniscroll_history_updated', loadAndEnrich);
    return () =>
      window.removeEventListener('aniscroll_history_updated', loadAndEnrich);
  }, []);

  const saveProgress = useCallback(
    (entry: Omit<WatchHistoryEntry, 'timestamp'>) => {
      saveWatchProgress(entry);
    },
    []
  );

  const removeItem = useCallback((hoshikaId: number, episodeNumber: number) => {
    removeHistoryEntry(hoshikaId, episodeNumber);
  }, []);

  return {
    items,
    mounted,
    saveProgress,
    removeItem,
  };
}
