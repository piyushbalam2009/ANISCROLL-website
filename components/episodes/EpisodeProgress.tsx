'use client';

import React from 'react';
import { Check } from 'lucide-react';

interface EpisodeProgressProps {
  currentTime?: number;
  duration?: number;
  completed?: boolean;
  className?: string;
  showBadge?: boolean;
}

export function EpisodeProgress({
  currentTime = 0,
  duration = 0,
  completed = false,
  className = '',
  showBadge = true,
}: EpisodeProgressProps) {
  const percent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const isWatched = completed || percent >= 90;

  if (isWatched) {
    if (!showBadge) return null;
    return (
      <div
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/10 text-white border border-white/20 ${className}`}
        title="Watched"
      >
        <Check size={11} strokeWidth={2.5} />
        <span>Watched</span>
      </div>
    );
  }

  if (percent > 0) {
    return (
      <div className={`w-full flex items-center gap-1.5 ${className}`}>
        <div className="flex-1 h-1 bg-[#292929] rounded-full overflow-hidden">
          <div
            className="h-full bg-white transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="text-[10px] font-mono text-[#A0A0A0] shrink-0">
          {Math.round(percent)}%
        </span>
      </div>
    );
  }

  return null;
}
