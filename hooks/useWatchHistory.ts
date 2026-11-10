'use client';

import { useState, useEffect, useCallback } from 'react';
import { WatchHistoryEntry } from '@/types/streaming';
import {
  getWatchHistory,
  saveWatchProgress,
  removeHistoryEntry,
  clearWatchHistory,
} from '@/lib/storage';

export function useWatchHistory() {
  const [history, setHistory] = useState<WatchHistoryEntry[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setHistory(getWatchHistory());

    const handleUpdate = () => setHistory(getWatchHistory());
    window.addEventListener('aniscroll_history_updated', handleUpdate);
    return () =>
      window.removeEventListener('aniscroll_history_updated', handleUpdate);
  }, []);

  const recordWatch = useCallback(
    (entry: Omit<WatchHistoryEntry, 'timestamp'>) => {
      saveWatchProgress(entry);
    },
    []
  );

  const removeEntry = useCallback(
    (hoshikaId: number, episodeNumber: number) => {
      removeHistoryEntry(hoshikaId, episodeNumber);
    },
    []
  );

  const clearAll = useCallback(() => {
    clearWatchHistory();
  }, []);

  return {
    history,
    mounted,
    recordWatch,
    removeEntry,
    clearAll,
  };
}
