import React from 'react';
import { getHoshikaBrowse, getHoshikaGenres } from '@/lib/hoshika';
import { ExploreCatalog } from '@/components/explore/ExploreCatalog';
import { Compass } from 'lucide-react';

export const revalidate = 300;

export default async function ExplorePage() {
  const [initialItems, genres] = await Promise.all([
    getHoshikaBrowse('top', 'anime'),
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

      <React.Suspense fallback={<div className="h-40 bg-[#141414] rounded-2xl animate-pulse" />}>
        <ExploreCatalog initialItems={initialItems} genres={genres} />
      </React.Suspense>
    </div>
  );
}
