'use client';

import { useState, useEffect, useCallback } from 'react';
import { WatchHistoryEntry } from '@/types/streaming';
import {
  getContinueWatching,
  saveWatchProgress,
  removeHistoryEntry,
} from '@/lib/storage';

export function useContinueWatching() {
  const [items, setItems] = useState<WatchHistoryEntry[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setItems(getContinueWatching());

    const handleUpdate = () => setItems(getContinueWatching());
    window.addEventListener('aniscroll_history_updated', handleUpdate);
    return () =>
      window.removeEventListener('aniscroll_history_updated', handleUpdate);
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
