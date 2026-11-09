import React from 'react';
import { notFound } from 'next/navigation';
import { getHoshikaAnime, getEpisodesForWatch } from '@/lib/hoshika';
import { WatchPageClient } from '@/components/player/WatchPageClient';

interface WatchPageProps {
  params: Promise<{ id: string; episode: string }>;
}

export const revalidate = 120;

export default async function WatchPage({ params }: WatchPageProps) {
  const { id, episode } = await params;
  const episodeNumber = parseInt(episode, 10);

  if (isNaN(episodeNumber) || episodeNumber < 1) {
    notFound();
  }

  const [anime, episodeData] = await Promise.all([
    getHoshikaAnime(id, 'en'),
    getEpisodesForWatch(id, episodeNumber, 'en'),
  ]);

  if (!anime) {
    notFound();
  }

  return (
    <WatchPageClient
      anime={anime}
      episodes={episodeData.items}
      episodeNumber={episodeNumber}
    />
  );
}
