'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Loader2, X, ArrowRight, Film } from 'lucide-react';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { HoshikaAnimeItem } from '@/types/anime';

// Client-side search cache (5 minute TTL) to prevent redundant requests on backspace/retype
const clientSearchCache = new Map<
  string,
  { results: HoshikaAnimeItem[]; expiresAt: number }
>();

export function GlobalSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<HoshikaAnimeItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Sync with URL query parameter
  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search logic (320ms) with client cache & AbortController
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setResults([]);
      setIsLoading(false);
      setIsOpen(false);
      setErrorMessage(null);
      return;
    }

    const cacheKey = trimmed.toLowerCase();
    const cached = clientSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setResults(cached.results);
      setIsLoading(false);
      setIsOpen(true);
      setSelectedIndex(-1);
      setErrorMessage(null);
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setIsLoading(true);
    setErrorMessage(null);

    debounceTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}&limit=7`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        if (controller.signal.aborted) return;

        if (data.ok) {
          const items: HoshikaAnimeItem[] = data.results || [];
          clientSearchCache.set(cacheKey, {
            results: items,
            expiresAt: Date.now() + 5 * 60 * 1000,
          });
          setResults(items);
          setIsOpen(true);
          setSelectedIndex(-1);
        } else {
          setErrorMessage(data.error || 'No results found');
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setErrorMessage('Unable to reach search service');
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 320);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' && results.length > 0) {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < results.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < results.length) {
        const item = results[selectedIndex];
        navigateToAnime(item.shortId);
      } else {
        submitFullSearch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  const navigateToAnime = (shortId: number) => {
    setIsOpen(false);
    router.push(`/anime/${shortId}`);
  };

  const submitFullSearch = () => {
    if (!query.trim()) return;
    setIsOpen(false);
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <div className="relative flex items-center">
        <Search
          size={17}
          className="absolute left-3.5 text-[#707070] pointer-events-none"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => {
            if (results.length > 0 || errorMessage) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search anime by English or Japanese title..."
          className="w-full h-10 pl-10 pr-9 bg-[#141414] text-white placeholder-[#707070] text-sm rounded-lg border border-[#292929] focus:outline-none focus:border-white transition-colors"
          aria-label="Search anime"
        />

        {query && (
          <button
            onClick={() => {
              setQuery('');
              setResults([]);
              setIsOpen(false);
              inputRef.current?.focus();
            }}
            className="absolute right-3 text-[#707070] hover:text-white transition-colors"
            aria-label="Clear search query"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
          </button>
        )}
      </div>

      {/* Suggestions Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#141414] border border-[#292929] rounded-xl shadow-2xl overflow-hidden z-50 divide-y divide-[#292929]">
          {isLoading && results.length === 0 && (
            <div className="flex items-center justify-center p-6 text-sm text-[#A0A0A0] gap-2">
              <Loader2 size={16} className="animate-spin" />
              <span>Searching titles...</span>
            </div>
          )}

          {errorMessage && (
            <div className="p-4 text-center text-xs text-[#A0A0A0]">
              {errorMessage}
            </div>
          )}

          {!isLoading && results.length === 0 && query.trim() && !errorMessage && (
            <div className="p-6 text-center text-sm text-[#707070]">
              No anime found for &ldquo;{query}&rdquo;
            </div>
          )}

          {results.length > 0 && (
            <div className="max-h-[380px] overflow-y-auto no-scrollbar py-1">
              {results.map((anime, index) => {
                const isSelected = selectedIndex === index;
                const title = anime.titleEnglish || anime.titleRomaji || anime.titleLocalized || 'Unknown Title';
                const subTitle = anime.titleJapanese || anime.titleRomaji;

                return (
                  <button
                    key={anime.id || anime.shortId}
                    type="button"
                    onClick={() => navigateToAnime(anime.shortId)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full text-left px-3.5 py-2.5 flex items-center gap-3 transition-colors ${
                      isSelected ? 'bg-[#1B1B1B]' : 'hover:bg-[#1B1B1B]/70'
                    }`}
                  >
                    {/* Poster Thumbnail */}
                    <div className="relative w-10 h-14 bg-[#0A0A0A] rounded overflow-hidden shrink-0 border border-[#292929]">
                      <ResilientImage
                        src={anime.coverImage}
                        alt={title}
                        fill
                        className="object-cover"
                        sizes="40px"
                        fallback={
                          <div className="w-full h-full flex items-center justify-center text-[#707070]">
                            <Film size={14} />
                          </div>
                        }
                      />
                    </div>

                    {/* Metadata */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-white truncate">
                        {title}
                      </div>
                      {subTitle && subTitle !== title && (
                        <div className="text-xs text-[#707070] truncate">
                          {subTitle}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-[#A0A0A0]">
                        <span>{anime.format || 'TV'}</span>
                        {anime.seasonYear && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{anime.seasonYear}</span>
                          </>
                        )}
                        {anime.averageScore && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-white font-mono">{anime.averageScore}%</span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* View All Results Action */}
          {query.trim() && (
            <button
              type="button"
              onClick={submitFullSearch}
              className={`w-full px-4 py-2.5 text-xs font-medium flex items-center justify-between text-white transition-colors ${
                selectedIndex === results.length ? 'bg-[#1B1B1B]' : 'hover:bg-[#1B1B1B]'
              }`}
            >
              <span>View all results for &ldquo;{query.trim()}&rdquo;</span>
              <ArrowRight size={14} className="text-[#A0A0A0]" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
