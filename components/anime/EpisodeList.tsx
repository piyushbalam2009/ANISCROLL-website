'use client';

import React from 'react';
import { HoshikaEpisodeItem } from '@/types/anime';
import { EpisodeSection } from '@/components/episodes/EpisodeSection';

interface EpisodeListProps {
  animeId: string | number;
  episodes: HoshikaEpisodeItem[];
  currentEpisode?: number;
  totalEpisodes?: number;
  activeType?: 'sub' | 'dub';
  onChangeType?: (type: 'sub' | 'dub') => void;
  showSubDubToggle?: boolean;
}

export function EpisodeList({
  animeId,
  episodes,
  currentEpisode,
  totalEpisodes,
  activeType,
  onChangeType,
  showSubDubToggle = true,
}: EpisodeListProps) {
  return (
    <EpisodeSection
      animeId={animeId}
      episodes={episodes}
      totalEpisodes={totalEpisodes}
      currentEpisode={currentEpisode}
      activeType={activeType}
      onChangeType={onChangeType}
      showSubDubToggle={showSubDubToggle}
    />
  );
}
