'use client';

import { useState, useEffect, useCallback } from 'react';
import { WatchlistEntry } from '@/types/streaming';
import {
  getWatchlist,
  isInWatchlist,
  setWatchlistStatus,
  toggleWatchlist,
} from '@/lib/storage';

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setWatchlist(getWatchlist());

    const handleUpdate = () => setWatchlist(getWatchlist());
    window.addEventListener('aniscroll_watchlist_updated', handleUpdate);
    return () =>
      window.removeEventListener('aniscroll_watchlist_updated', handleUpdate);
  }, []);

  const checkInWatchlist = useCallback(
    (hoshikaId: number) => isInWatchlist(hoshikaId),
    [watchlist]
  );

  const toggleItem = useCallback((item: Omit<WatchlistEntry, 'addedAt'>) => {
    return toggleWatchlist(item);
  }, []);

  const updateStatus = useCallback(
    (
      item: Omit<WatchlistEntry, 'addedAt'>,
      status:
        | 'watching'
        | 'plan_to_watch'
        | 'completed'
        | 'on_hold'
        | 'dropped'
        | 'remove'
    ) => {
      return setWatchlistStatus(item, status);
    },
    []
  );

  return {
    watchlist,
    mounted,
    isInWatchlist: checkInWatchlist,
    toggleWatchlist: toggleItem,
    setWatchlistStatus: updateStatus,
  };
}
