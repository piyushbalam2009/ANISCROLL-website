import React from 'react';
import { getHoshikaBrowse } from '@/lib/hoshika';
import { AnimeGrid } from '@/components/anime/AnimeGrid';
import { Clock } from 'lucide-react';

export const revalidate = 300;

export default async function RecentPage() {
  const items = await getHoshikaBrowse('recent', 'anime');

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

      <AnimeGrid animeList={items} />
    </div>
  );
}
