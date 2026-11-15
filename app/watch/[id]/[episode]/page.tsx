import React, { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getHoshikaAnime, getEpisodesForWatch } from '@/lib/hoshika';
import { isMovieContent } from '@/lib/stream-provider-core';
import { buildWatchSocialMetadata } from '@/lib/social-metadata';
import { WatchPageClient } from '@/components/player/WatchPageClient';

interface WatchPageProps {
  params: Promise<{ id: string; episode: string }>;
}

export const revalidate = 120;

const getCachedAnime = cache((id: string) => getHoshikaAnime(id, 'en'));
const getCachedWatchEpisodes = cache((id: string, ep: number) =>
  getEpisodesForWatch(id, ep, 'en')
);

export async function generateMetadata({
  params,
}: WatchPageProps): Promise<Metadata> {
  const { id, episode } = await params;
  const episodeNumber = parseInt(episode, 10);
  const safeEpisodeNumber =
    !isNaN(episodeNumber) && episodeNumber >= 1 ? episodeNumber : 1;

  const anime = await getCachedAnime(id).catch(() => null);
  if (!anime) {
    return buildWatchSocialMetadata({
      anime: null,
      rawId: id,
      episodeNumber: safeEpisodeNumber,
    });
  }

  const standalone =
    anime.isStandaloneMovie === true || anime.standaloneMovie === true;
  const isMovie = isMovieContent({
    format: anime.format ?? null,
    isStandaloneMovie: standalone,
  });

  const episodeData = !isMovie
    ? await getCachedWatchEpisodes(id, safeEpisodeNumber).catch(() => ({
        items: [],
        total: 0,
      }))
    : { items: [], total: 0 };

  return buildWatchSocialMetadata({
    anime,
    episodes: episodeData.items,
    rawId: id,
    episodeNumber: safeEpisodeNumber,
  });
}

export default async function WatchPage({ params }: WatchPageProps) {
  const { id, episode } = await params;
  const episodeNumber = parseInt(episode, 10);

  if (isNaN(episodeNumber) || episodeNumber < 1) {
    notFound();
  }

  const [anime, episodeData] = await Promise.all([
    getCachedAnime(id),
    getCachedWatchEpisodes(id, episodeNumber),
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
