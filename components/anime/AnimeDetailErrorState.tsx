'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Compass, Home, RefreshCw } from 'lucide-react';

interface AnimeDetailErrorStateProps {
  title?: string;
  description?: string;
  code?: string;
}

export function AnimeDetailErrorState({
  title = 'Temporarily Unable to Load Anime',
  description = 'AniScroll could not reach the upstream anime catalogue right now. This is a temporary connectivity issue, not a missing title.',
  code,
}: AnimeDetailErrorStateProps) {
  const router = useRouter();
  const [retrying, setRetrying] = React.useState(false);

  const handleRetry = () => {
    setRetrying(true);
    router.refresh();
    setTimeout(() => setRetrying(false), 1200);
  };

  return (
    <div
      data-testid="upstream-unavailable-state"
      className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6 py-16"
    >
      <div className="w-16 h-16 rounded-2xl bg-[#111111] border border-[#292929] flex items-center justify-center mb-5 text-white">
        <AlertTriangle size={28} />
      </div>

      <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white mb-2">
        {title}
      </h1>
      <p className="text-sm text-[#A0A0A0] max-w-md mb-6 leading-relaxed">
        {description}
      </p>

      {code && (
        <span className="mb-6 px-3 py-1 rounded-md bg-[#111111] border border-[#292929] font-mono text-[11px] uppercase tracking-wider text-[#888888]">
          {code}
        </span>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={handleRetry}
          className="px-5 py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors inline-flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw size={14} className={retrying ? 'animate-spin' : ''} />
          <span>Try Again</span>
        </button>

        <Link
          href="/"
          className="px-5 py-2.5 rounded-xl bg-[#141414] border border-[#292929] text-white font-semibold text-xs hover:border-white transition-colors inline-flex items-center gap-2"
        >
          <Home size={14} />
          <span>Back Home</span>
        </Link>

        <Link
          href="/explore"
          className="px-5 py-2.5 rounded-xl bg-transparent border border-[#292929] text-[#A0A0A0] font-semibold text-xs hover:text-white hover:border-white transition-colors inline-flex items-center gap-2"
        >
          <Compass size={14} />
          <span>Explore</span>
        </Link>
      </div>
    </div>
  );
}
