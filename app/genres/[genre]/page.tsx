import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getHoshikaGenreTitles, getHoshikaCatalog } from '@/lib/hoshika';
import { AnimeGrid } from '@/components/anime/AnimeGrid';
import { buildBrowseSocialMetadata } from '@/lib/social-metadata';
import { Layers, ArrowLeft } from 'lucide-react';

interface GenreDetailPageProps {
  params: Promise<{ genre: string }>;
}

export const revalidate = 600;

function formatGenreTitle(slug: string): string {
  return decodeURIComponent(slug)
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export async function generateMetadata({
  params,
}: GenreDetailPageProps): Promise<Metadata> {
  const { genre } = await params;
  const formattedTitle = formatGenreTitle(genre);
  return buildBrowseSocialMetadata({
    title: `${formattedTitle} Anime`,
    description: `Curated collection of ${formattedTitle} anime series and movies streaming on AniScroll.`,
    path: `/genres/${encodeURIComponent(decodeURIComponent(genre))}`,
  });
}

export default async function GenreDetailPage({ params }: GenreDetailPageProps) {
  const { genre } = await params;
  const decodedGenre = decodeURIComponent(genre);
  const formattedTitle = decodedGenre
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  // Fetch titles for this genre from Hoshika
  let titles = await getHoshikaGenreTitles(decodedGenre);
  if (!titles || titles.length === 0) {
    const catalog = await getHoshikaCatalog({ genre: formattedTitle });
    titles = catalog.items;
  }

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center justify-between pb-2 border-b border-[#292929]">
        <div className="flex items-center gap-3">
          <Link
            href="/genres"
            className="p-2 rounded-lg text-[#A0A0A0] hover:text-white hover:bg-[#141414] transition-colors"
            title="Back to Genres"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <Layers size={22} className="text-white" />
              <span>{formattedTitle} Anime</span>
            </h1>
            <p className="text-xs text-[#707070]">
              Curated collection of {formattedTitle} anime titles on Hoshika.
            </p>
          </div>
        </div>

        <Link
          href={`/explore?genre=${encodeURIComponent(formattedTitle)}`}
          className="text-xs text-[#A0A0A0] hover:text-white transition-colors"
        >
          Filter in Explore
        </Link>
      </div>

      <AnimeGrid
        animeList={titles}
        emptyMessage={`No anime found in the ${formattedTitle} genre.`}
      />
    </div>
  );
}
