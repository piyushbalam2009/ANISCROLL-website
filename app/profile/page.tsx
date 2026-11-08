'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { User, Bookmark, History, PlayCircle, Settings, ShieldCheck, Film } from 'lucide-react';
import { getWatchlist, getWatchHistory } from '@/lib/storage';

export default function ProfilePage() {
  const [watchlistCount, setWatchlistCount] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setWatchlistCount(getWatchlist().length);
    setHistoryCount(getWatchHistory().length);
  }, []);

  return (
    <div className="space-y-8 max-w-4xl pb-20">
      {/* Profile Header */}
      <div className="p-6 md:p-8 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col sm:flex-row items-center sm:items-start gap-6 text-center sm:text-left">
        <div className="w-20 h-20 rounded-2xl bg-white text-black flex items-center justify-center font-bold text-2xl shadow-xl shrink-0">
          <User size={36} />
        </div>

        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              AniScroll User
            </h1>
            <span className="text-[10px] font-mono uppercase bg-[#141414] border border-[#292929] text-[#A0A0A0] px-2 py-0.5 rounded">
              Local Session
            </span>
          </div>
          <p className="text-xs text-[#707070]">
            Your watch history, continue watching queue, and watchlist are stored securely on this client.
          </p>

          <div className="pt-3 flex flex-wrap items-center justify-center sm:justify-start gap-3">
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#292929] text-xs text-white hover:border-white transition-colors"
            >
              <Settings size={14} />
              <span>Edit Preferences</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link
          href="/watchlist"
          className="p-5 rounded-2xl bg-[#0A0A0A] border border-[#292929] hover:border-[#404040] hover:bg-[#141414] transition-all group"
        >
          <div className="flex items-center justify-between text-[#707070] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">
              Saved in Watchlist
            </span>
            <Bookmark size={18} className="group-hover:text-white transition-colors" />
          </div>
          <div className="text-3xl font-black text-white font-mono">
            {mounted ? watchlistCount : '--'}
          </div>
          <span className="text-[11px] text-[#A0A0A0] mt-1 block">
            Click to manage titles
          </span>
        </Link>

        <Link
          href="/history"
          className="p-5 rounded-2xl bg-[#0A0A0A] border border-[#292929] hover:border-[#404040] hover:bg-[#141414] transition-all group"
        >
          <div className="flex items-center justify-between text-[#707070] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">
              Episodes Streamed
            </span>
            <History size={18} className="group-hover:text-white transition-colors" />
          </div>
          <div className="text-3xl font-black text-white font-mono">
            {mounted ? historyCount : '--'}
          </div>
          <span className="text-[11px] text-[#A0A0A0] mt-1 block">
            View complete playback log
          </span>
        </Link>

        <Link
          href="/continue-watching"
          className="p-5 rounded-2xl bg-[#0A0A0A] border border-[#292929] hover:border-[#404040] hover:bg-[#141414] transition-all group"
        >
          <div className="flex items-center justify-between text-[#707070] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">
              Continue Watching
            </span>
            <PlayCircle size={18} className="group-hover:text-white transition-colors" />
          </div>
          <div className="text-3xl font-black text-white font-mono">
            Active
          </div>
          <span className="text-[11px] text-[#A0A0A0] mt-1 block">
            Resume in-progress series
          </span>
        </Link>
      </div>

      {/* About AniScroll Architecture */}
      <div className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-3 text-xs text-[#A0A0A0] leading-relaxed">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <ShieldCheck size={16} />
          <span>System & Architecture Specifications</span>
        </h3>
        <p>
          <strong className="text-white">AniScroll</strong> combines official Hoshika REST API v1 for catalog metadata, AniList GraphQL with heuristic fuzzy scoring for ID matching, AniScroll high-speed HLS video streaming, and AniSkip v2 for opening and ending skip detection.
        </p>
        <p>
          Metadata and streaming mappings are intelligently cached server-side for maximum performance. All user watchlists and playback positions remain stored locally in your browser.
        </p>
      </div>
    </div>
  );
}
