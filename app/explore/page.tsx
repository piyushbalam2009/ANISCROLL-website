import React from 'react';
import { getHoshikaCatalog, getHoshikaGenres } from '@/lib/hoshika';
import { ExploreCatalog } from '@/components/explore/ExploreCatalog';
import { Compass } from 'lucide-react';

export const revalidate = 300;

export default async function ExplorePage() {
  const [initialCatalog, genres] = await Promise.all([
    getHoshikaCatalog({ sort: 'top', page: 1 }).catch(() => ({
      items: [],
      total: 0,
      page: 1,
      pages: 1,
      hasMore: false,
    })),
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
        <ExploreCatalog
          initialItems={initialCatalog.items}
          initialTotal={initialCatalog.total}
          initialHasMore={initialCatalog.hasMore}
          initialPages={initialCatalog.pages}
          genres={genres}
        />
      </React.Suspense>
    </div>
  );
}
