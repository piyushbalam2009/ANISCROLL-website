'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Megaphone, X, ArrowRight } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { FloatingHeader } from './FloatingHeader';
import { getUserPreferences, saveUserPreferences } from '@/lib/storage';
import {
  AnnouncementFirestoreDoc,
  getActiveAnnouncementsForPublic,
} from '@/lib/admin/admin-firestore';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<AnnouncementFirestoreDoc[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  const isAdminRoute = pathname.startsWith('/admin');

  useEffect(() => {
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

  useEffect(() => {
    if (isAdminRoute) return;
    getActiveAnnouncementsForPublic()
      .then((items) => setAnnouncements(items))
      .catch(() => {});
  }, [isAdminRoute, pathname]);

  if (isAdminRoute) {
    return <div className="min-h-screen bg-[#000000] text-white">{children}</div>;
  }

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      saveUserPreferences({ sidebarCollapsed: next });
      return next;
    });
  };

  const isHeroPage = pathname === '/' || pathname.startsWith('/anime/');
  const visibleAnnouncements = announcements.filter((a) => !dismissedIds.includes(a.id));

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
        className={`flex-1 flex flex-col min-h-screen relative transition-all duration-200 ease-in-out ${
          collapsed ? 'md:pl-[76px]' : 'md:pl-[240px]'
        }`}
      >
        {/* Active Published Announcements Banner */}
        {visibleAnnouncements.length > 0 && (
          <div className="relative z-40 bg-[#141414] border-b border-[#292929] px-4 py-2 text-xs text-white flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="px-2 py-0.5 rounded bg-white text-black font-mono font-bold text-[10px] uppercase tracking-wider shrink-0">
                {visibleAnnouncements[0].type}
              </span>
              <Megaphone size={14} className="text-white shrink-0" />
              <span className="font-semibold text-white truncate">
                {visibleAnnouncements[0].title}:
              </span>
              <span className="text-[#A0A0A0] truncate">
                {visibleAnnouncements[0].message}
              </span>
              {visibleAnnouncements[0].ctaLink && (
                <Link
                  href={visibleAnnouncements[0].ctaLink}
                  className="inline-flex items-center gap-1 text-white font-semibold underline underline-offset-2 shrink-0 hover:opacity-80"
                >
                  <span>{visibleAnnouncements[0].ctaText || 'Learn more'}</span>
                  <ArrowRight size={12} />
                </Link>
              )}
            </div>
            {visibleAnnouncements[0].dismissible && (
              <button
                type="button"
                onClick={() =>
                  setDismissedIds((prev) => [...prev, visibleAnnouncements[0].id])
                }
                className="text-[#A0A0A0] hover:text-white p-1 shrink-0"
                aria-label="Dismiss announcement"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {/* Floating Global Header: Centered Pill Search & Top-Right Circular Actions */}
        <FloatingHeader
          collapsed={collapsed}
          onOpenMobile={() => setMobileOpen(true)}
        />

        {/* Page Content: Full-bleed for hero pages, padded for standard pages */}
        <main
          className={`flex-1 w-full min-h-screen relative flex flex-col ${
            isHeroPage
              ? 'p-0'
              : 'pt-24 px-4 sm:px-6 md:px-8 max-w-[1600px] mx-auto'
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
