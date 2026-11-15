import React from 'react';
import type { Metadata } from 'next';
import { searchHoshika } from '@/lib/hoshika';
import { AnimeGrid } from '@/components/anime/AnimeGrid';
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

  let results: any[] = [];
  if (query) {
    results = await searchHoshika(query, 30);
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
            {query
              ? `Showing results for "${query}"`
              : 'Enter a search term to find anime.'}
          </p>
        </div>
      </div>

      <AnimeGrid
        animeList={results}
        emptyMessage={
          query
            ? `No titles found matching "${query}". Check spelling or try a Japanese romanized title.`
            : 'Type a query in the search bar above to begin.'
        }
      />
    </div>
  );
}
