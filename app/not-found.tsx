import React from 'react';
import Link from 'next/link';
import { Compass, Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="py-24 flex flex-col items-center justify-center text-center p-6 space-y-4">
      <div className="text-7xl font-black font-mono tracking-tighter text-white">
        404
      </div>
      <h1 className="text-xl font-bold text-white">
        Page Not Found
      </h1>
      <p className="text-xs text-[#707070] max-w-sm">
        The anime title, episode, or page you are looking for does not exist or has been relocated.
      </p>

      <div className="flex items-center gap-3 pt-2">
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors"
        >
          <Home size={15} />
          <span>Back to Home</span>
        </Link>
        <Link
          href="/explore"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#292929] text-white text-xs hover:border-white transition-colors"
        >
          <Compass size={15} />
          <span>Explore Catalogue</span>
        </Link>
      </div>
    </div>
  );
}
