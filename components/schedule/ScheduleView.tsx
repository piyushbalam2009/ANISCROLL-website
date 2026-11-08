'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Film, Clock } from 'lucide-react';
import { ScheduleItem } from '@/types/anime';

interface ScheduleViewProps {
  scheduleItems: ScheduleItem[];
}

export function ScheduleView({ scheduleItems }: ScheduleViewProps) {
  const days = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];

  // Detect current day of week (0 is Sunday in JS, so adjust to index 0 = Monday)
  const todayJs = new Date().getDay();
  const defaultDayIndex = todayJs === 0 ? 6 : todayJs - 1;

  const [activeDayIndex, setActiveDayIndex] = useState<number>(defaultDayIndex);

  // Group items by day of the week based on airingAt timestamp
  const itemsByDay: Record<number, ScheduleItem[]> = {
    0: [],
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
    6: [],
  };

  scheduleItems.forEach((item) => {
    if (item.airingAt) {
      const date = new Date(item.airingAt);
      const jsDay = date.getDay();
      const dayIdx = jsDay === 0 ? 6 : jsDay - 1;
      itemsByDay[dayIdx].push(item);
    } else {
      // Fallback
      itemsByDay[0].push(item);
    }
  });

  const activeDayItems = itemsByDay[activeDayIndex] || [];

  const formatReleaseTime = (isoString?: string) => {
    if (!isoString) return '--:--';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '--:--';
    }
  };

  return (
    <div className="space-y-6">
      {/* Day Selector Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-[#0A0A0A] rounded-2xl border border-[#292929] overflow-x-auto no-scrollbar">
        {days.map((day, idx) => {
          const isActive = activeDayIndex === idx;
          const count = itemsByDay[idx]?.length || 0;
          return (
            <button
              key={day}
              onClick={() => setActiveDayIndex(idx)}
              className={`flex-1 min-w-[100px] py-2.5 px-3 rounded-xl text-xs font-medium transition-all flex flex-col items-center gap-1 ${
                isActive
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-[#A0A0A0] hover:text-white hover:bg-[#141414]'
              }`}
            >
              <span>{day}</span>
              <span
                className={`text-[10px] font-mono ${
                  isActive ? 'text-black/70' : 'text-[#707070]'
                }`}
              >
                {count} releases
              </span>
            </button>
          );
        })}
      </div>

      {/* Schedule Items Grid */}
      {activeDayItems.length === 0 ? (
        <div className="py-16 text-center text-[#707070] bg-[#0A0A0A] rounded-2xl border border-[#292929]">
          <p className="text-sm">No scheduled releases recorded for {days[activeDayIndex]}.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {activeDayItems.map((item) => {
            const title =
              item.titleEnglish ||
              item.titleRomaji ||
              item.titleLocalized ||
              'Airing Anime';

            return (
              <Link
                key={item.id || item.shortId}
                href={`/anime/${item.shortId}`}
                className="group flex items-start gap-3 p-3 rounded-xl bg-[#141414] border border-[#292929] hover:border-[#404040] hover:bg-[#1B1B1B] transition-all"
              >
                {/* Poster */}
                <div className="relative w-16 h-24 bg-[#0A0A0A] rounded-lg overflow-hidden shrink-0 border border-[#292929]">
                  {item.coverImage ? (
                    <Image
                      src={item.coverImage}
                      alt={title}
                      fill
                      sizes="64px"
                      className="object-cover group-hover:scale-105 transition-transform duration-200"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#707070]">
                      <Film size={20} />
                    </div>
                  )}

                  {/* Release Time Badge */}
                  <div className="absolute bottom-1 left-1 right-1 bg-black/90 backdrop-blur-sm text-[10px] font-mono text-center text-white py-0.5 rounded flex items-center justify-center gap-1">
                    <Clock size={10} />
                    <span>{formatReleaseTime(item.airingAt)}</span>
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-[#A0A0A0] flex items-center gap-1.5">
                    <span className="font-semibold text-white">
                      {item.episode ? `Episode ${item.episode}` : 'New Episode'}
                    </span>
                    <span aria-hidden="true" className="text-[#707070]">·</span>
                    <span>{item.format || 'TV'}</span>
                  </div>

                  <h3
                    className="text-xs font-semibold text-white truncate mt-1 group-hover:underline"
                    title={title}
                  >
                    {title}
                  </h3>

                  {item.titleJapanese && (
                    <p className="text-[11px] text-[#707070] truncate mt-0.5">
                      {item.titleJapanese}
                    </p>
                  )}

                  <div className="mt-2 text-[10px] text-[#707070]">
                    Local Time: {formatReleaseTime(item.airingAt)}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
