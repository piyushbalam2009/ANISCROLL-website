import React from 'react';
import type { Metadata } from 'next';
import { unstable_noStore as noStore } from 'next/cache';
import { searchHoshikaDetailed } from '@/lib/hoshika';
import { AnimeGrid } from '@/components/anime/AnimeGrid';
import { AnimeDetailErrorState } from '@/components/anime/AnimeDetailErrorState';
import { buildBrowseSocialMetadata } from '@/lib/social-metadata';
import { Search } from 'lucide-react';

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({
  searchParams,
}: SearchPageProps): Promise<Metadata> {
  const { q = '' } = await searchParams;
  const query = q.trim();
  const title = query ? `Search: ${query}` : 'Search Anime';
  const description = query
    ? `Search results for "${query}" across anime series and movies on AniScroll.`
    : 'Search thousands of anime series and movies by title on AniScroll.';

  return buildBrowseSocialMetadata({
    title,
    description,
    path: query ? `/search?q=${encodeURIComponent(query)}` : '/search',
  });
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q = '' } = await searchParams;
  const query = q.trim();

  if (query) {
    const searchRes = await searchHoshikaDetailed(query, 30);
    if (!searchRes.ok && searchRes.error) {
      noStore();
      return (
        <AnimeDetailErrorState
          title="Search Temporarily Unavailable"
          description="AniScroll could not reach the search catalogue right now. Please try again in a moment."
          code={searchRes.error.category}
        />
      );
    }

    return (
      <div className="space-y-6 pb-16">
        <div className="flex items-center gap-2.5 pb-2 border-b border-[#292929]">
          <Search size={22} className="text-white" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Search Results
            </h1>
            <p className="text-xs text-[#707070]">
              Showing results for &quot;{query}&quot;
            </p>
          </div>
        </div>

        <AnimeGrid
          animeList={searchRes.items}
          emptyMessage={`No titles found matching "${query}". Check spelling or try a Japanese romanized title.`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-2.5 pb-2 border-b border-[#292929]">
        <Search size={22} className="text-white" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Search Results
          </h1>
          <p className="text-xs text-[#707070]">
            Enter a search term to find anime.
          </p>
        </div>
      </div>

      <AnimeGrid
        animeList={[]}
        emptyMessage="Type a query in the search bar above to begin."
      />
    </div>
  );
}
