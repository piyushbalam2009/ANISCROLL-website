'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { FloatingHeader } from './FloatingHeader';
import { getUserPreferences, saveUserPreferences } from '@/lib/storage';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      saveUserPreferences({ sidebarCollapsed: next });
      return next;
    });
  };

  const isHeroPage = pathname === '/' || pathname.startsWith('/anime/');

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
