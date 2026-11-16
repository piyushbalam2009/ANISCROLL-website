import React from 'react';
import type { Metadata } from 'next';
import { unstable_noStore as noStore } from 'next/cache';
import { getHoshikaScheduleDetailed } from '@/lib/hoshika';
import { ScheduleView } from '@/components/schedule/ScheduleView';
import { AnimeDetailErrorState } from '@/components/anime/AnimeDetailErrorState';
import { buildBrowseSocialMetadata } from '@/lib/social-metadata';
import { Calendar } from 'lucide-react';

export const revalidate = 900;

export const metadata: Metadata = buildBrowseSocialMetadata({
  title: 'Anime Airing Schedule',
  description:
    'Track daily broadcast dates and upcoming episode drops in your local timezone on AniScroll.',
  path: '/schedule',
});

export default async function SchedulePage() {
  const res = await getHoshikaScheduleDetailed('en');
  if (!res.ok) {
    noStore();
    return (
      <AnimeDetailErrorState
        title="Temporarily Unable to Load Schedule"
        code={res.error.category}
      />
    );
  }

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-2.5 pb-2 border-b border-[#292929]">
        <Calendar size={22} className="text-white" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Anime Airing Schedule
          </h1>
          <p className="text-xs text-[#707070]">
            Track daily broadcast dates and upcoming episode drops in your local timezone.
          </p>
        </div>
      </div>

      <ScheduleView scheduleItems={res.data} />
    </div>
  );
}
