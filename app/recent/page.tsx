import React from 'react';
import { getHoshikaBrowsePaginated } from '@/lib/hoshika';
import { PaginatedBrowseSection } from '@/components/anime/PaginatedBrowseSection';
import {
  DEFAULT_PER_PAGE,
  buildPaginatedResponse,
  sanitizePageNumber,
} from '@/lib/explore-catalog';
import { Clock } from 'lucide-react';

export const revalidate = 120;

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

  const initialData = await getHoshikaBrowsePaginated(
    'recent',
    page,
    DEFAULT_PER_PAGE
  ).catch(() =>
    buildPaginatedResponse({
      results: [],
      currentPage: page,
      perPage: DEFAULT_PER_PAGE,
      totalItems: 0,
    })
  );

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
