'use client';

import React from 'react';
import { ParsedSubtitleCue, SubtitlePreferences } from '@/types/streaming';
import { getSubtitleCueStyles } from '@/lib/subtitle-styles';

interface SubtitleOverlayProps {
  currentTime: number;
  cues: ParsedSubtitleCue[];
  preferences: SubtitlePreferences;
  showControls: boolean;
  isFullscreen: boolean;
}

export function SubtitleOverlay({
  currentTime,
  cues,
  preferences,
  showControls,
  isFullscreen,
}: SubtitleOverlayProps) {
  if (!cues || cues.length === 0) {
    return null;
  }

  // Apply subtitle delay offset (positive delay shifts cue appearance later)
  const effectiveTime = currentTime - preferences.offsetSeconds;

  // Find active cues for the current timestamp
  const activeCues = cues.filter(
    (c) => effectiveTime >= c.startTime && effectiveTime <= c.endTime
  );

  if (activeCues.length === 0) {
    return null;
  }

  // Positioning class based on vertical position
  const getVerticalPositionClasses = () => {
    switch (preferences.position) {
      case 'Top':
        return 'top-4 md:top-8';
      case 'Middle':
        return 'top-1/2 -translate-y-1/2';
      case 'Bottom':
      default:
        // Avoid overlapping player controls when controls are visible
        return showControls ? 'bottom-20 md:bottom-24' : 'bottom-6 md:bottom-10';
    }
  };

  // Horizontal alignment class
  const getHorizontalAlignmentClasses = () => {
    switch (preferences.alignment) {
      case 'Left':
        return 'justify-start text-left pl-6 md:pl-14';
      case 'Right':
        return 'justify-end text-right pr-6 md:pr-14';
      case 'Center':
      default:
        return 'justify-center text-center px-4 md:px-8';
    }
  };

  // Dynamic scale factor for fullscreen and mobile responsiveness
  const getScale = () => {
    if (typeof window === 'undefined') return 1;
    if (isFullscreen) return 1.2;
    if (window.innerWidth < 640) return 0.85;
    return 1;
  };

  const scale = getScale();
  const styles = getSubtitleCueStyles(preferences, scale);

  return (
    <div
      className={`absolute inset-x-0 z-30 pointer-events-none flex flex-col items-center transition-all duration-200 ease-out ${getVerticalPositionClasses()}`}
    >
      <div className={`w-full flex ${getHorizontalAlignmentClasses()}`}>
        <div className="flex flex-col gap-1 max-w-[92%]">
          {activeCues.map((cue, idx) => (
            <span key={cue.id || idx} style={styles}>
              {cue.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
