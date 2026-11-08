import React from 'react';
import { getHoshikaSchedule } from '@/lib/hoshika';
import { ScheduleView } from '@/components/schedule/ScheduleView';
import { Calendar } from 'lucide-react';

export const revalidate = 600;

export default async function SchedulePage() {
  const items = await getHoshikaSchedule('en');

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

      <ScheduleView scheduleItems={items} />
    </div>
  );
}
