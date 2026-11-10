'use client';

import { useState, useEffect, useCallback } from 'react';
import { UserPreferences } from '@/types/streaming';
import {
  getUserPreferences,
  saveUserPreferences,
  DEFAULT_PREFERENCES,
} from '@/lib/storage';

export function usePreferences() {
  const [preferences, setPreferences] =
    useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setPreferences(getUserPreferences());

    const handleUpdate = () => setPreferences(getUserPreferences());
    window.addEventListener('aniscroll_preferences_updated', handleUpdate);
    return () =>
      window.removeEventListener('aniscroll_preferences_updated', handleUpdate);
  }, []);

  const updatePreferences = useCallback((partial: Partial<UserPreferences>) => {
    const updated = saveUserPreferences(partial);
    setPreferences(updated);
    return updated;
  }, []);

  return {
    preferences,
    mounted,
    updatePreferences,
  };
}
