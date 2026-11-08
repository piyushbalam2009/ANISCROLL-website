import React from 'react';
import Link from 'next/link';
import { getHoshikaGenres } from '@/lib/hoshika';
import { Layers, ArrowRight } from 'lucide-react';

export const revalidate = 86400;

export default async function GenresPage() {
  const genres = await getHoshikaGenres();

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-2.5 pb-2 border-b border-[#292929]">
        <Layers size={22} className="text-white" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Anime Genres
          </h1>
          <p className="text-xs text-[#707070]">
            Browse anime titles categorised by mood, theme, and genre storytelling.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {genres.map((genre) => {
          const slug = genre.toLowerCase().replace(/[\s_]+/g, '-');
          return (
            <Link
              key={genre}
              href={`/genres/${slug}`}
              className="group p-5 rounded-2xl bg-[#0A0A0A] border border-[#292929] hover:border-white hover:bg-[#141414] transition-all flex flex-col justify-between aspect-[16/10]"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[#707070] font-mono">
                  Genre
                </span>
                <ArrowRight
                  size={15}
                  className="text-[#707070] group-hover:text-white group-hover:translate-x-1 transition-all"
                />
              </div>

              <div>
                <h3 className="text-base font-bold text-white group-hover:underline">
                  {genre}
                </h3>
                <span className="text-xs text-[#A0A0A0] mt-0.5 block">
                  Explore titles
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
