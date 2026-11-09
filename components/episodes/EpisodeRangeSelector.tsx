'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { EpisodeRange } from '@/lib/episode-pagination';

interface EpisodeRangeSelectorProps {
  ranges: EpisodeRange[];
  selectedRangeIndex: number;
  onSelectRange: (rangeIndex: number) => void;
  className?: string;
}

export function EpisodeRangeSelector({
  ranges,
  selectedRangeIndex,
  onSelectRange,
  className = '',
}: EpisodeRangeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const currentRange = ranges[selectedRangeIndex] || ranges[0];

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      const timer = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 0);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  // Scroll active item into view when dropdown opens
  useEffect(() => {
    if (isOpen && listRef.current) {
      const activeEl = listRef.current.querySelector('[data-active="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (selectedRangeIndex < ranges.length - 1) {
          onSelectRange(selectedRangeIndex + 1);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (selectedRangeIndex > 0) {
          onSelectRange(selectedRangeIndex - 1);
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        setIsOpen(false);
        break;
    }
  };

  if (!ranges || ranges.length <= 1) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger Button */}
      <button
        type="button"
        data-testid="episode-range-trigger"
        data-selected-index={selectedRangeIndex}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        className="h-9 px-3.5 bg-[#0A0A0A] hover:bg-[#171717] text-white border border-[#303030] hover:border-[#404040] rounded-xl text-xs font-mono font-medium flex items-center justify-between gap-2.5 transition-all shadow-sm focus:outline-none focus:border-white cursor-pointer select-none"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title="Select episode range"
      >
        <span>{currentRange ? currentRange.label : 'Select range'}</span>
        <ChevronDown
          size={14}
          className={`text-[#A0A0A0] transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-white' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Episode ranges"
          className="absolute z-40 left-0 sm:left-auto sm:right-0 mt-1.5 w-44 max-h-64 overflow-y-auto bg-[#171717] border border-[#303030] rounded-xl shadow-2xl p-1.5 text-xs focus:outline-none animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="px-2 py-1 text-[10px] uppercase font-semibold text-[#707070] tracking-wider select-none">
            Episode Ranges ({ranges.length})
          </div>

          <div className="space-y-0.5">
            {ranges.map((range) => {
              const isSelected = range.index === selectedRangeIndex;
              return (
                <button
                  key={range.index}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-active={isSelected}
                  data-testid={`range-option-${range.index}`}
                  data-range-label={range.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectRange(range.index);
                    setIsOpen(false);
                  }}
                  className={`w-full px-2.5 py-2 rounded-lg text-left font-mono text-xs flex items-center justify-between transition-colors cursor-pointer select-none ${
                    isSelected
                      ? 'bg-white text-black font-bold shadow-sm'
                      : 'text-[#A0A0A0] hover:bg-[#292929] hover:text-white'
                  }`}
                >
                  <span>{range.label}</span>
                  {isSelected && <Check size={13} strokeWidth={2.5} className="shrink-0 text-black" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
