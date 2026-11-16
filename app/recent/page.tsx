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
import { Clock } from 'lucide-react';

export const revalidate = 300;

export const metadata: Metadata = buildBrowseSocialMetadata({
  title: 'Recently Updated Anime',
  description:
    'Catch up on fresh episode releases and newly updated anime titles streaming on AniScroll.',
  path: '/recent',
});

interface RecentPageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function RecentPage({ searchParams }: RecentPageProps) {
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
      'recent',
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
        title="Temporarily Unable to Load Recent Releases"
        code={errorCode}
      />
    );
  }

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-2.5 pb-2 border-b border-[#292929]">
        <Clock size={22} className="text-white" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Recently Updated
          </h1>
          <p className="text-xs text-[#707070]">
            Fresh episodes and newly added anime titles.
          </p>
        </div>
      </div>

      <React.Suspense
        fallback={
          <div className="h-40 bg-[#141414] rounded-2xl animate-pulse" />
        }
      >
        <PaginatedBrowseSection
          category="recent"
          initialData={initialData}
          emptyMessage="No recently updated anime found on this page."
        />
      </React.Suspense>
    </div>
  );
}
