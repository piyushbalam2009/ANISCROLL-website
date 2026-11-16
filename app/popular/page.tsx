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
import { Flame } from 'lucide-react';

export const revalidate = 600;

export const metadata: Metadata = buildBrowseSocialMetadata({
  title: 'All-Time Popular Anime',
  description:
    'Explore the highest rated and most celebrated anime series and movies of all time on AniScroll.',
  path: '/popular',
});

interface PopularPageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function PopularPage({ searchParams }: PopularPageProps) {
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
      'popular',
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
        title="Temporarily Unable to Load Popular Anime"
        code={errorCode}
      />
    );
  }

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-2.5 pb-2 border-b border-[#292929]">
        <Flame size={22} className="text-white" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            All-Time Popular Anime
          </h1>
          <p className="text-xs text-[#707070]">
            The highest rated and most celebrated anime series of all time.
          </p>
        </div>
      </div>

      <React.Suspense
        fallback={
          <div className="h-40 bg-[#141414] rounded-2xl animate-pulse" />
        }
      >
        <PaginatedBrowseSection
          category="popular"
          initialData={initialData}
          emptyMessage="No popular anime found on this page."
        />
      </React.Suspense>
    </div>
  );
}
