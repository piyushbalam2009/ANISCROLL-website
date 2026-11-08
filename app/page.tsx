import React from 'react';
import Link from 'next/link';
import { ArrowRight, Flame, Sparkles, TrendingUp, Clock, Compass } from 'lucide-react';
import { getHoshikaHome, getHoshikaBrowse } from '@/lib/hoshika';
import { AnimeHero } from '@/components/anime/AnimeHero';
import { AnimeGrid } from '@/components/anime/AnimeGrid';
import { ContinueWatchingRow } from '@/components/anime/ContinueWatchingRow';

// Revalidate home page every 10 minutes
export const revalidate = 600;

export default async function HomePage() {
  const [homeData, topAnime] = await Promise.all([
    getHoshikaHome('en'),
    getHoshikaBrowse('top', 'anime'),
  ]);

  const featured = homeData.trending[0] || homeData.seasonal[0] || topAnime[0];
  const seasonal = homeData.seasonal.slice(0, 12);
  const trending = homeData.trending.slice(0, 12);
  const recent = homeData.recentlyAdded.slice(0, 12);
  const popular = topAnime.slice(0, 12);

  return (
    <div className="space-y-12 pb-16">
      {/* Featured Anime Hero Banner */}
      {featured && <AnimeHero anime={featured} />}

      {/* Client-Side Continue Watching Row (from localStorage) */}
      <ContinueWatchingRow />

      {/* Trending Anime Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp size={20} className="text-white" />
            <h2 className="text-xl font-bold tracking-tight text-white">
              Trending Now
            </h2>
          </div>
          <Link
            href="/trending"
            className="text-xs font-medium text-[#A0A0A0] hover:text-white flex items-center gap-1 transition-colors"
          >
            <span>View All</span>
            <ArrowRight size={14} />
          </Link>
        </div>
        <AnimeGrid animeList={trending} />
      </section>

      {/* Current Seasonal Anime Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-white" />
            <h2 className="text-xl font-bold tracking-tight text-white">
              {homeData.season
                ? `${homeData.season.season} ${homeData.season.year} Season`
                : 'Current Season'}
            </h2>
          </div>
          <Link
            href="/explore?status=RELEASING"
            className="text-xs font-medium text-[#A0A0A0] hover:text-white flex items-center gap-1 transition-colors"
          >
            <span>Explore Seasonal</span>
            <ArrowRight size={14} />
          </Link>
        </div>
        <AnimeGrid animeList={seasonal} />
      </section>

      {/* All-Time Popular Anime Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame size={20} className="text-white" />
            <h2 className="text-xl font-bold tracking-tight text-white">
              All-Time Popular
            </h2>
          </div>
          <Link
            href="/popular"
            className="text-xs font-medium text-[#A0A0A0] hover:text-white flex items-center gap-1 transition-colors"
          >
            <span>View Top 60</span>
            <ArrowRight size={14} />
          </Link>
        </div>
        <AnimeGrid animeList={popular} />
      </section>

      {/* Recently Added / Updated Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={20} className="text-white" />
            <h2 className="text-xl font-bold tracking-tight text-white">
              Recently Updated
            </h2>
          </div>
          <Link
            href="/recent"
            className="text-xs font-medium text-[#A0A0A0] hover:text-white flex items-center gap-1 transition-colors"
          >
            <span>View All</span>
            <ArrowRight size={14} />
          </Link>
        </div>
        <AnimeGrid animeList={recent} />
      </section>

      {/* Category Discovery Kicker */}
      <section className="p-8 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div>
          <h3 className="text-lg font-bold text-white mb-1">
            Looking for something specific?
          </h3>
          <p className="text-xs text-[#A0A0A0] max-w-lg">
            Filter through thousands of titles by genre, release year, airing status, or format with real-time Hoshika catalog filters.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/explore"
            className="px-5 py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors inline-flex items-center gap-2"
          >
            <Compass size={15} />
            <span>Explore Catalogue</span>
          </Link>
          <Link
            href="/schedule"
            className="px-5 py-2.5 rounded-xl bg-transparent border border-white text-white font-medium text-xs hover:bg-white/10 transition-colors"
          >
            Airing Schedule
          </Link>
        </div>
      </section>
    </div>
  );
}
