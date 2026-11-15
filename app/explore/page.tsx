import React from 'react';
import type { Metadata } from 'next';
import { getHoshikaCatalog, getHoshikaGenres } from '@/lib/hoshika';
import { ExploreCatalog } from '@/components/explore/ExploreCatalog';
import {
  DEFAULT_PER_PAGE,
  buildPaginatedResponse,
  parseGenresParam,
  sanitizePageNumber,
} from '@/lib/explore-catalog';
import { buildBrowseSocialMetadata } from '@/lib/social-metadata';
import { Compass } from 'lucide-react';

export const revalidate = 180;

interface ExplorePageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({
  searchParams,
}: ExplorePageProps): Promise<Metadata> {
  const resolved = searchParams ? await searchParams : {};
  const q = typeof resolved.q === 'string' ? resolved.q.trim() : '';
  const genre = typeof resolved.genre === 'string' ? resolved.genre.trim() : '';
  const format = typeof resolved.format === 'string' ? resolved.format.trim() : '';

  const labelParts = [genre, format].filter(Boolean);
  const title = q
    ? `Explore "${q}"`
    : labelParts.length > 0
    ? `Explore ${labelParts.join(' ')} Anime`
    : 'Explore Anime Catalogue';

  const description = q
    ? `Browse anime matching "${q}" by format, genre, and release year on AniScroll.`
    : 'Browse, filter, and discover anime series and movies across all formats, years, and genres on AniScroll.';

  return buildBrowseSocialMetadata({
    title,
    description,
    path: '/explore',
  });
}

export default async function ExplorePage({ searchParams }: ExplorePageProps) {
  const resolvedParams = searchParams ? await searchParams : {};

  const q =
    typeof resolvedParams.q === 'string' ? resolvedParams.q : undefined;
  const genreList = parseGenresParam(
    resolvedParams.genre as string | string[] | undefined
  );
  const genre = genreList.length > 0 ? genreList.join(',') : undefined;
  const format =
    typeof resolvedParams.format === 'string'
      ? resolvedParams.format
      : undefined;
  const status =
    typeof resolvedParams.status === 'string'
      ? resolvedParams.status
      : undefined;
  const year =
    typeof resolvedParams.year === 'string' ? resolvedParams.year : undefined;
  const season =
    typeof resolvedParams.season === 'string'
      ? resolvedParams.season
      : undefined;
  const sort =
    typeof resolvedParams.sort === 'string' ? resolvedParams.sort : 'top';
  const page = sanitizePageNumber(
    Array.isArray(resolvedParams.page)
      ? resolvedParams.page[0]
      : resolvedParams.page
  );

  const [initialCatalog, genres] = await Promise.all([
    getHoshikaCatalog({
      q,
      genre,
      format,
      status,
      year,
      season,
      sort,
      page,
      perPage: DEFAULT_PER_PAGE,
    }).catch(() =>
      buildPaginatedResponse({
        results: [],
        currentPage: page,
        perPage: DEFAULT_PER_PAGE,
        totalItems: 0,
      })
    ),
    getHoshikaGenres(),
  ]);

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-2.5 pb-2 border-b border-[#292929]">
        <Compass size={22} className="text-white" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Explore Anime Catalogue
          </h1>
          <p className="text-xs text-[#707070]">
            Browse, filter, and discover anime across all formats and genres.
          </p>
        </div>
      </div>

      <React.Suspense
        fallback={
          <div className="h-40 bg-[#141414] rounded-2xl animate-pulse" />
        }
      >
        <ExploreCatalog initialData={initialCatalog} genres={genres} />
      </React.Suspense>
    </div>
  );
}
