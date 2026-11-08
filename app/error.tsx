'use client';

import React from 'react';
import Link from 'next/link';
import { AlertCircle, RotateCcw, Home } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="py-24 flex flex-col items-center justify-center text-center p-6 space-y-4">
      <AlertCircle size={44} className="text-[#A0A0A0]" />
      <h1 className="text-xl font-bold text-white">
        Something Went Wrong
      </h1>
      <p className="text-xs text-[#707070] max-w-sm">
        {error.message || 'An unexpected error occurred while loading this page.'}
      </p>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={() => reset()}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors"
        >
          <RotateCcw size={15} />
          <span>Try Again</span>
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#292929] text-white text-xs hover:border-white transition-colors"
        >
          <Home size={15} />
          <span>Go Home</span>
        </Link>
      </div>
    </div>
  );
}
