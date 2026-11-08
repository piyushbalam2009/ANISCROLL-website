'use client';

import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { GlobalSearch } from './GlobalSearch';
import { Menu, Bookmark, History } from 'lucide-react';
import Link from 'next/link';
import { getUserPreferences, saveUserPreferences } from '@/lib/storage';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const prefs = getUserPreferences();
    if (prefs.sidebarCollapsed !== undefined) {
      setCollapsed(prefs.sidebarCollapsed);
    }

    const handlePrefChange = (e: any) => {
      if (e.detail?.sidebarCollapsed !== undefined) {
        setCollapsed(e.detail.sidebarCollapsed);
      }
    };

    window.addEventListener('aniscroll_preferences_updated', handlePrefChange);
    return () => window.removeEventListener('aniscroll_preferences_updated', handlePrefChange);
  }, []);

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      saveUserPreferences({ sidebarCollapsed: next });
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[#000000] text-white flex">
      {/* Permanent Fixed Sidebar */}
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        isMobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-h-screen transition-all duration-200 ease-in-out ${
          collapsed ? 'md:pl-[76px]' : 'md:pl-[240px]'
        }`}
      >
        {/* Global Content Header with Search */}
        <header className="sticky top-0 z-30 h-16 bg-[#000000]/90 backdrop-blur-md border-b border-[#292929] px-4 md:px-8 flex items-center justify-between gap-4">
          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 text-[#A0A0A0] hover:text-white rounded-lg hover:bg-[#141414] transition-colors"
            aria-label="Open mobile navigation drawer"
          >
            <Menu size={22} />
          </button>

          {/* Centered Global Real-Time Search Bar with Suspense Boundary */}
          <div className="flex-1 max-w-xl">
            <React.Suspense fallback={
              <div className="w-full h-10 bg-[#141414] rounded-lg border border-[#292929] animate-pulse" />
            }>
              <GlobalSearch />
            </React.Suspense>
          </div>

          {/* Quick Header Utilities */}
          <div className="flex items-center gap-2">
            <Link
              href="/watchlist"
              className="p-2 text-[#A0A0A0] hover:text-white rounded-lg hover:bg-[#141414] transition-colors hidden sm:flex items-center gap-1.5 text-xs font-medium"
              title="My Watchlist"
            >
              <Bookmark size={17} />
              <span className="hidden lg:inline">Watchlist</span>
            </Link>
            <Link
              href="/history"
              className="p-2 text-[#A0A0A0] hover:text-white rounded-lg hover:bg-[#141414] transition-colors hidden sm:flex items-center gap-1.5 text-xs font-medium"
              title="Watch History"
            >
              <History size={17} />
              <span className="hidden lg:inline">History</span>
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 w-full max-w-[1600px] mx-auto p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
