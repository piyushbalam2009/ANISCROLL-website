'use client';

import React, { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Menu,
  Search,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getAdminAuthHeaders } from '@/lib/admin/admin-auth';
import { ADMIN_NAV_ITEMS } from './AdminSidebar';
import { RoleBadge } from '@/components/ui/RoleBadge';

interface AdminHeaderProps {
  onOpenMobile: () => void;
}

export function AdminHeader({ onOpenMobile }: AdminHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { adminRecord, effectiveRole } = useAuth();
  const [quickSearch, setQuickSearch] = useState('');
  const [flushing, setFlushing] = useState(false);
  const [flushedNotice, setFlushedNotice] = useState(false);

  const currentNav =
    ADMIN_NAV_ITEMS.find((item) =>
      item.exact ? pathname === item.href : pathname.startsWith(item.href)
    ) || ADMIN_NAV_ITEMS[0];

  const handleQuickJump = (e: React.FormEvent) => {
    e.preventDefault();
    const q = quickSearch.trim();
    if (!q) return;
    if (/^\d+$/.test(q)) {
      router.push(`/admin/artwork/${q}`);
    } else {
      router.push(`/admin/artwork?q=${encodeURIComponent(q)}`);
    }
    setQuickSearch('');
  };

  const handleFlushArtworkCache = async () => {
    setFlushing(true);
    try {
      const headers = await getAdminAuthHeaders();
      await fetch('/api/admin/artwork', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'invalidate_cache' }),
      });
      setFlushedNotice(true);
      setTimeout(() => setFlushedNotice(false), 2500);
    } catch {
      // Ignore error
    } finally {
      setFlushing(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 h-16 bg-[#0A0A0A]/95 backdrop-blur-md border-b border-[#292929] px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobile}
          className="lg:hidden p-2 rounded-lg bg-[#141414] border border-[#292929] text-white"
          aria-label="Open admin menu"
        >
          <Menu size={18} />
        </button>

        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xs font-mono uppercase tracking-wider text-[#707070] hidden sm:inline">
            Admin
          </span>
          <span className="text-[#292929] hidden sm:inline">/</span>
          <h1 className="text-sm sm:text-base font-bold text-white truncate">
            {currentNav.label}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2.5 sm:gap-3">
        {/* Quick Jump to Anime Artwork by ID or Title */}
        <form onSubmit={handleQuickJump} className="hidden md:flex items-center relative">
          <Search size={14} className="absolute left-3 text-[#707070]" />
          <input
            type="text"
            value={quickSearch}
            onChange={(e) => setQuickSearch(e.target.value)}
            placeholder="Jump to anime title or ID..."
            className="w-56 lg:w-64 pl-8 pr-3 py-1.5 rounded-lg bg-[#141414] border border-[#292929] focus:border-white text-xs text-white placeholder-[#707070] focus:outline-none transition-colors"
          />
        </form>

        {/* Flush Artwork Cache Button */}
        <button
          type="button"
          onClick={handleFlushArtworkCache}
          disabled={flushing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white/40 text-xs font-medium text-white transition-all cursor-pointer disabled:opacity-50"
          title="Flush server-side Fanart.tv & Firestore artwork cache"
        >
          {flushedNotice ? (
            <>
              <CheckCircle2 size={14} className="text-white" />
              <span className="hidden sm:inline">Cache Purged</span>
            </>
          ) : (
            <>
              <RefreshCw size={14} className={flushing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Purge Artwork Cache</span>
            </>
          )}
        </button>

        {/* Live Site Link */}
        <Link
          href="/"
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black hover:bg-neutral-200 text-xs font-bold transition-colors"
        >
          <span>View Site</span>
          <ExternalLink size={13} />
        </Link>

        {/* Role Pill */}
        {adminRecord && (
          <div className="hidden xl:flex items-center">
            <RoleBadge role={effectiveRole} size="md" />
          </div>
        )}
      </div>
    </header>
  );
}
