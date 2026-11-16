import React, { cache } from 'react';
import type { Metadata } from 'next';
import { unstable_noStore as noStore } from 'next/cache';
import { notFound } from 'next/navigation';
import { getEpisodesForWatch, resolveAnimeDetailById } from '@/lib/hoshika';
import { isMovieContent } from '@/lib/stream-provider-core';
import { buildWatchSocialMetadata } from '@/lib/social-metadata';
import { WatchPageClient } from '@/components/player/WatchPageClient';
import { AnimeDetailErrorState } from '@/components/anime/AnimeDetailErrorState';

interface WatchPageProps {
  params: Promise<{ id: string; episode: string }>;
}

export const revalidate = 120;

const getCachedAnimeOutcome = cache((id: string) =>
  resolveAnimeDetailById(id, 'en')
);
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

  const outcome = await getCachedAnimeOutcome(id).catch(() => null);
  const anime = outcome?.anime || null;
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
    ? await getCachedWatchEpisodes(
        String(anime.shortId),
        safeEpisodeNumber
      ).catch(() => ({
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

  const outcome = await getCachedAnimeOutcome(id);
  if (outcome.status === 'invalid_id' || outcome.status === 'not_found') {
    notFound();
  }

  if (outcome.status === 'upstream_error' || !outcome.anime) {
    noStore();
    return (
      <AnimeDetailErrorState
        title="Temporarily Unable to Load Episode"
        code={outcome.error?.category || 'UPSTREAM_UNAVAILABLE'}
      />
    );
  }

  const episodeData = await getCachedWatchEpisodes(
    String(outcome.anime.shortId),
    episodeNumber
  );

  return (
    <WatchPageClient
      anime={outcome.anime}
      episodes={episodeData.items}
      episodeNumber={episodeNumber}
    />
  );
}
