import React from 'react';
import { getHoshikaBrowse } from '@/lib/hoshika';
import { AnimeGrid } from '@/components/anime/AnimeGrid';
import { Flame } from 'lucide-react';

export const revalidate = 600;

export default async function PopularPage() {
  const items = await getHoshikaBrowse('top', 'anime');

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

      <AnimeGrid animeList={items} />
    </div>
  );
}
