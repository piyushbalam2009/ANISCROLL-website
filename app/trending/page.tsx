import React from 'react';
import type { Metadata } from 'next';
import { unstable_noStore as noStore } from 'next/cache';
import { getHoshikaBrowsePaginated } from '@/lib/hoshika';
import { PaginatedBrowseSection } from '@/components/anime/PaginatedBrowseSection';
import { AnimeDetailErrorState } from '@/components/anime/AnimeDetailErrorState';
import {
  DEFAULT_PER_PAGE,
  sanitizePageNumber,
} from '@/lib/explore-catalog';
import { buildBrowseSocialMetadata } from '@/lib/social-metadata';
import { TrendingUp } from 'lucide-react';

export const revalidate = 300;

export const metadata: Metadata = buildBrowseSocialMetadata({
  title: 'Trending Anime',
  description:
    'Discover the most watched and actively discussed trending anime series and movies on AniScroll.',
  path: '/trending',
});

interface TrendingPageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function TrendingPage({ searchParams }: TrendingPageProps) {
  const resolvedParams = searchParams ? await searchParams : {};
  const page = sanitizePageNumber(
    Array.isArray(resolvedParams.page)
      ? resolvedParams.page[0]
      : resolvedParams.page
  );

  let initialData: Awaited<ReturnType<typeof getHoshikaBrowsePaginated>> | null = null;
  let errorCode = 'UPSTREAM_UNAVAILABLE';
  try {
    initialData = await getHoshikaBrowsePaginated(
      'trending',
      page,
      DEFAULT_PER_PAGE
    );
  } catch (err: any) {
    if (err?.category) errorCode = String(err.category);
  }

  if (!initialData) {
    noStore();
    return (
      <AnimeDetailErrorState
        title="Temporarily Unable to Load Trending Anime"
        code={errorCode}
      />
    );
  }

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-2.5 pb-2 border-b border-[#292929]">
        <TrendingUp size={22} className="text-white" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Trending Anime
          </h1>
          <p className="text-xs text-[#707070]">
            The most watched and actively discussed anime right now.
          </p>
        </div>
      </div>

      <React.Suspense
        fallback={
          <div className="h-40 bg-[#141414] rounded-2xl animate-pulse" />
        }
      >
        <PaginatedBrowseSection
          category="trending"
          initialData={initialData}
          emptyMessage="No trending anime found on this page."
        />
      </React.Suspense>
    </div>
  );
}
