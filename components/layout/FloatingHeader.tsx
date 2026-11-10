'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Search,
  Loader2,
  X,
  ArrowRight,
  Film,
  Bell,
  User,
  Menu,
  Check,
  Bookmark,
  History,
  PlayCircle,
  Settings,
  LogIn,
  LogOut,
  UserPlus,
  Shield,
} from 'lucide-react';
import { HoshikaAnimeItem } from '@/types/anime';
import { useAuth } from '@/hooks/useAuth';

interface FloatingHeaderProps {
  collapsed: boolean;
  onOpenMobile: () => void;
}

export function FloatingHeader({
  collapsed,
  onOpenMobile,
}: FloatingHeaderProps) {
  const router = useRouter();
  const { user, profile, isAdmin, signOutUser } = useAuth();

  // Search State
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HoshikaAnimeItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Popover States
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  // Refs
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const notifContainerRef = useRef<HTMLDivElement>(null);
  const profileContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(target)
      ) {
        setIsSearchOpen(false);
      }
      if (
        notifContainerRef.current &&
        !notifContainerRef.current.contains(target)
      ) {
        setIsNotificationsOpen(false);
      }
      if (
        profileContainerRef.current &&
        !profileContainerRef.current.contains(target)
      ) {
        setIsProfileOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Global keyboard shortcut '/' to focus search
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Real-time search with 300ms debounce and stale request cancellation
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      setResults([]);
      setIsLoading(false);
      setIsSearchOpen(false);
      setErrorMessage(null);
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    setIsLoading(true);
    setErrorMessage(null);

    debounceTimerRef.current = setTimeout(async () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}&limit=8`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        if (data.ok) {
          setResults(data.results || []);
          setIsSearchOpen(true);
          setSelectedIndex(-1);
        } else {
          setErrorMessage(data.error || 'No results found');
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setErrorMessage('Unable to reach search service');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query]);

  // Keyboard navigation for search dropdown
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isSearchOpen) {
      if (e.key === 'ArrowDown' && results.length > 0) {
        setIsSearchOpen(true);
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
      setIsSearchOpen(false);
      inputRef.current?.blur();
    }
  };

  const navigateToAnime = (shortId: number) => {
    setIsSearchOpen(false);
    setQuery('');
    router.push(`/anime/${shortId}`);
  };

  const submitFullSearch = () => {
    if (!query.trim()) return;
    setIsSearchOpen(false);
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  const handleSignOut = async () => {
    setIsProfileOpen(false);
    await signOutUser();
    router.push('/');
  };

  const displayName =
    profile?.displayName ||
    user?.displayName ||
    user?.email?.split('@')[0] ||
    'AniScroll Member';
  const email = profile?.email || user?.email || '';
  const photoURL = profile?.photoURL || user?.photoURL || '';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div
      className={`fixed top-5 md:top-6 left-0 right-0 z-40 pointer-events-none transition-all duration-200 ease-in-out px-4 sm:px-6 md:px-8 ${
        collapsed ? 'md:left-[76px]' : 'md:left-[240px]'
      }`}
    >
      <div className="relative w-full flex items-center justify-between gap-3">
        {/* Mobile Sidebar Hamburger Toggle */}
        <div className="pointer-events-auto md:hidden flex items-center">
          <button
            onClick={onOpenMobile}
            className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/90 backdrop-blur-xl border border-white/15 text-white flex items-center justify-center shadow-2xl transition-all active:scale-95"
            aria-label="Open navigation menu"
          >
            <Menu size={20} />
          </button>
        </div>

        {/* Center: Floating Pill Search Bar */}
        <div
          ref={searchContainerRef}
          className="pointer-events-auto mx-auto w-full max-w-sm sm:max-w-md md:max-w-lg lg:max-w-xl relative"
        >
          <div className="relative flex items-center">
            <Search
              size={16}
              className="absolute left-4 text-[#A0A0A0] pointer-events-none"
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => {
                if (results.length > 0 || errorMessage) setIsSearchOpen(true);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search anime..."
              className="w-full h-10 sm:h-11 pl-11 pr-20 bg-black/60 hover:bg-black/75 focus:bg-black/90 backdrop-blur-xl text-white placeholder-[#888888] text-xs sm:text-sm rounded-full border border-white/15 focus:border-white/40 focus:outline-none transition-all shadow-2xl shadow-black/80"
              aria-label="Search anime"
            />

            {/* Right icons: Clear button or Enter Keyboard Badge */}
            <div className="absolute right-3.5 flex items-center gap-1.5">
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setResults([]);
                    setIsSearchOpen(false);
                    inputRef.current?.focus();
                  }}
                  className="text-[#888888] hover:text-white transition-colors p-1"
                  aria-label="Clear search"
                >
                  {isLoading ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <X size={15} />
                  )}
                </button>
              ) : (
                <span className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-white/10 text-[10px] font-mono text-[#A0A0A0] border border-white/10 pointer-events-none select-none">
                  Enter ↵
                </span>
              )}
            </div>
          </div>

          {/* Floating Dropdown Results Menu */}
          {isSearchOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-[#0D0D0D]/95 backdrop-blur-2xl border border-[#292929] rounded-2xl shadow-2xl shadow-black/90 overflow-hidden z-50 divide-y divide-[#202020] animate-in fade-in zoom-in-95 duration-150">
              {isLoading && results.length === 0 && (
                <div className="flex items-center justify-center p-6 text-xs sm:text-sm text-[#A0A0A0] gap-2.5">
                  <Loader2 size={16} className="animate-spin text-white" />
                  <span>Searching Hoshika catalog...</span>
                </div>
              )}

              {errorMessage && (
                <div className="p-4 text-center text-xs text-[#A0A0A0]">
                  {errorMessage}
                </div>
              )}

              {!isLoading && results.length === 0 && query.trim() && !errorMessage && (
                <div className="p-6 text-center text-xs sm:text-sm text-[#707070]">
                  No anime found for &ldquo;{query}&rdquo;
                </div>
              )}

              {results.length > 0 && (
                <div className="max-h-[380px] overflow-y-auto no-scrollbar py-1">
                  {results.map((anime, index) => {
                    const isSelected = selectedIndex === index;
                    const title =
                      anime.titleEnglish ||
                      anime.titleRomaji ||
                      anime.titleLocalized ||
                      'Unknown Anime';
                    const subTitle = anime.titleJapanese || anime.titleRomaji;

                    return (
                      <button
                        key={anime.id || anime.shortId}
                        type="button"
                        onClick={() => navigateToAnime(anime.shortId)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={`w-full text-left px-4 py-2.5 flex items-center gap-3.5 transition-colors ${
                          isSelected ? 'bg-white/10' : 'hover:bg-white/5'
                        }`}
                      >
                        <div className="relative w-10 h-14 bg-[#141414] rounded-lg overflow-hidden shrink-0 border border-white/10 shadow-sm">
                          {anime.coverImage ? (
                            <Image
                              src={anime.coverImage}
                              alt={title}
                              fill
                              className="object-cover"
                              sizes="40px"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[#707070]">
                              <Film size={14} />
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-xs sm:text-sm text-white truncate">
                            {title}
                          </div>
                          {subTitle && subTitle !== title && (
                            <div className="text-[11px] text-[#707070] truncate">
                              {subTitle}
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-[#A0A0A0]">
                            <span className="uppercase">{anime.format || 'TV'}</span>
                            {anime.seasonYear && (
                              <>
                                <span aria-hidden="true" className="text-[#555555]">·</span>
                                <span>{anime.seasonYear}</span>
                              </>
                            )}
                            {anime.averageScore && (
                              <>
                                <span aria-hidden="true" className="text-[#555555]">·</span>
                                <span className="text-white font-mono font-medium">
                                  {(anime.averageScore / 10).toFixed(1)} ★
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {query.trim() && (
                <button
                  type="button"
                  onClick={submitFullSearch}
                  className={`w-full px-4 py-2.5 text-xs font-medium flex items-center justify-between text-white transition-colors ${
                    selectedIndex === results.length
                      ? 'bg-white/10'
                      : 'hover:bg-white/5'
                  }`}
                >
                  <span>View all results for &ldquo;{query.trim()}&rdquo;</span>
                  <ArrowRight size={14} className="text-[#A0A0A0]" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Top-Right: Floating Monochrome Action Controls */}
        <div className="pointer-events-auto flex items-center gap-2.5 sm:gap-3">
          {!user && (
            <Link
              href="/login"
              className="hidden sm:inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-white hover:bg-neutral-200 text-black font-semibold text-xs transition-all shadow-2xl active:scale-95"
            >
              <LogIn size={14} />
              <span>Sign In</span>
            </Link>
          )}

          {/* 1. Floating Circular Notification Bell Button */}
          <div className="relative" ref={notifContainerRef}>
            <button
              type="button"
              onClick={() => setIsNotificationsOpen((prev) => !prev)}
              className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/85 backdrop-blur-xl border border-white/15 hover:border-white/40 text-white flex items-center justify-center transition-all shadow-2xl active:scale-95 relative"
              aria-label="View notifications"
              title="Notifications"
            >
              <Bell size={18} className="text-white/90" />
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-white animate-pulse" />
            </button>

            {isNotificationsOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 sm:w-80 rounded-2xl bg-[#0D0D0D]/95 backdrop-blur-2xl border border-[#292929] shadow-2xl p-4 z-50 text-xs animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between pb-3 border-b border-[#222222]">
                  <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                    Notifications
                  </span>
                  <span className="text-[10px] text-[#707070]">All caught up</span>
                </div>
                <div className="py-4 text-center text-[#888888] space-y-2">
                  <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-[#A0A0A0]">
                    <Check size={16} />
                  </div>
                  <p className="text-xs text-white/80">No new notifications</p>
                  <p className="text-[11px] text-[#707070]">
                    You&apos;ll be alerted when new episodes of your subscribed anime release.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 2. Floating Circular User Profile Avatar Button (Monochrome) */}
          <div className="relative" ref={profileContainerRef}>
            <button
              type="button"
              onClick={() => setIsProfileOpen((prev) => !prev)}
              className="w-10 h-10 rounded-full bg-white hover:bg-neutral-200 text-black border border-white/40 flex items-center justify-center font-bold text-xs transition-all shadow-2xl active:scale-95 overflow-hidden relative"
              aria-label="User profile and settings"
              title="Account"
            >
              {user && photoURL ? (
                <Image
                  src={photoURL}
                  alt={displayName}
                  fill
                  sizes="40px"
                  className="object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : user ? (
                <span>{initials}</span>
              ) : (
                <User size={18} className="text-black" />
              )}
            </button>

            {/* Profile Quick Menu */}
            {isProfileOpen && (
              <div className="absolute right-0 top-full mt-2 w-60 rounded-2xl bg-[#0D0D0D]/95 backdrop-blur-2xl border border-[#292929] shadow-2xl py-2 z-50 text-xs animate-in fade-in zoom-in-95 duration-150 divide-y divide-[#202020]">
                {user ? (
                  <>
                    <div className="px-4 py-3">
                      <div className="font-semibold text-white truncate">
                        {displayName}
                      </div>
                      {email && (
                        <div className="text-[11px] text-[#707070] truncate mt-0.5">
                          {email}
                        </div>
                      )}
                      <div className="inline-block mt-1.5 text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-white/10 text-white/90">
                        Cloud Synced
                      </div>
                    </div>

                    <div className="py-1">
                      {isAdmin && (
                        <Link
                          href="/admin"
                          onClick={() => setIsProfileOpen(false)}
                          className="flex items-center gap-2.5 px-4 py-2 text-white font-semibold bg-white/5 hover:bg-white/15 transition-colors"
                        >
                          <Shield size={15} />
                          <span>Admin Console</span>
                        </Link>
                      )}
                      <Link
                        href="/profile"
                        onClick={() => setIsProfileOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <User size={15} />
                        <span>Account Profile</span>
                      </Link>
                      <Link
                        href="/watchlist"
                        onClick={() => setIsProfileOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <Bookmark size={15} />
                        <span>My Watchlist</span>
                      </Link>
                      <Link
                        href="/continue-watching"
                        onClick={() => setIsProfileOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <PlayCircle size={15} />
                        <span>Continue Watching</span>
                      </Link>
                      <Link
                        href="/history"
                        onClick={() => setIsProfileOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <History size={15} />
                        <span>Watch History</span>
                      </Link>
                      <Link
                        href="/settings"
                        onClick={() => setIsProfileOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <Settings size={15} />
                        <span>Settings</span>
                      </Link>
                    </div>

                    <div className="py-1">
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-white/80 hover:text-white hover:bg-white/10 transition-colors text-left"
                      >
                        <LogOut size={15} />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="px-4 py-2.5">
                      <div className="font-semibold text-white">Guest Session</div>
                      <div className="text-[11px] text-[#707070]">
                        Sign in to sync across devices
                      </div>
                    </div>

                    <div className="py-1">
                      <Link
                        href="/login"
                        onClick={() => setIsProfileOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-white font-medium hover:bg-white/10 transition-colors"
                      >
                        <LogIn size={15} />
                        <span>Sign In</span>
                      </Link>
                      <Link
                        href="/register"
                        onClick={() => setIsProfileOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <UserPlus size={15} />
                        <span>Create Account</span>
                      </Link>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
