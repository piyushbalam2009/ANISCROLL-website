'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Compass,
  TrendingUp,
  Flame,
  Clock,
  Calendar,
  Layers,
  Bookmark,
  PlayCircle,
  History,
  Settings,
  User,
} from 'lucide-react';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const pathname = usePathname();

  const mainNav = [
    { label: 'Home', href: '/', icon: Home },
    { label: 'Explore', href: '/explore', icon: Compass },
    { label: 'Trending', href: '/trending', icon: TrendingUp },
    { label: 'Popular', href: '/popular', icon: Flame },
    { label: 'Recently Updated', href: '/recent', icon: Clock },
    { label: 'Schedule', href: '/schedule', icon: Calendar },
    { label: 'Genres', href: '/genres', icon: Layers },
  ];

  const libraryNav = [
    { label: 'My Watchlist', href: '/watchlist', icon: Bookmark },
    { label: 'Continue Watching', href: '/continue-watching', icon: PlayCircle },
    { label: 'Watch History', href: '/history', icon: History },
  ];

  const bottomNav = [
    { label: 'Settings', href: '/settings', icon: Settings },
    { label: 'Profile', href: '/profile', icon: User },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const navContent = (
    <div className="flex flex-col h-full bg-[#0A0A0A] border-r border-[#292929] select-none">
      {/* Brand & Collapse Header - Clicking logo toggles collapse/expand */}
      <div className="h-16 flex items-center px-4 border-b border-[#292929] shrink-0">
        <button
          type="button"
          onClick={() => {
            onToggleCollapse();
            onCloseMobile();
          }}
          className={`group flex items-center gap-3 w-full transition-opacity hover:opacity-90 text-left focus:outline-none cursor-pointer ${
            collapsed ? 'justify-center' : 'justify-start'
          }`}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {/* Stylized Monochrome Logo Mark */}
          <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform shadow-sm">
            <span className="text-black font-black text-sm tracking-tighter">AS</span>
          </div>
          {!collapsed && (
            <div className="flex flex-col flex-1 min-w-0">
              <span className="font-bold text-base tracking-wider text-white uppercase font-sans truncate">
                AniScroll
              </span>
              <span className="text-[10px] tracking-widest text-[#707070] uppercase">
                Premium Anime
              </span>
            </div>
          )}
        </button>
      </div>

      {/* Nav Items Scrollable Body */}
      <div className="flex-1 overflow-y-auto no-scrollbar py-4 px-3 space-y-6">
        {/* Main Section */}
        <div>
          {!collapsed && (
            <div className="px-3 pb-2 text-[10px] font-semibold tracking-wider text-[#707070] uppercase">
              Main
            </div>
          )}
          <nav className="space-y-1">
            {mainNav.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onCloseMobile}
                  className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    active
                      ? 'bg-white text-black font-semibold shadow-sm'
                      : 'text-[#A0A0A0] hover:text-white hover:bg-[#141414]'
                  } ${collapsed ? 'justify-center px-0' : ''}`}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon
                    size={20}
                    className={`shrink-0 transition-transform ${
                      active ? 'text-black' : 'text-[#A0A0A0] group-hover:text-white'
                    }`}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}

                  {/* Tooltip in collapsed mode */}
                  {collapsed && (
                    <div className="hidden md:group-hover:block absolute left-full ml-3 px-2.5 py-1 bg-[#1B1B1B] text-white text-xs rounded-md shadow-lg border border-[#292929] whitespace-nowrap z-50">
                      {item.label}
                    </div>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Library Section */}
        <div>
          {!collapsed && (
            <div className="px-3 pb-2 text-[10px] font-semibold tracking-wider text-[#707070] uppercase">
              Library
            </div>
          )}
          <nav className="space-y-1">
            {libraryNav.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onCloseMobile}
                  className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    active
                      ? 'bg-white text-black font-semibold shadow-sm'
                      : 'text-[#A0A0A0] hover:text-white hover:bg-[#141414]'
                  } ${collapsed ? 'justify-center px-0' : ''}`}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon
                    size={20}
                    className={`shrink-0 transition-transform ${
                      active ? 'text-black' : 'text-[#A0A0A0] group-hover:text-white'
                    }`}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}

                  {/* Tooltip in collapsed mode */}
                  {collapsed && (
                    <div className="hidden md:group-hover:block absolute left-full ml-3 px-2.5 py-1 bg-[#1B1B1B] text-white text-xs rounded-md shadow-lg border border-[#292929] whitespace-nowrap z-50">
                      {item.label}
                    </div>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="p-3 border-t border-[#292929] space-y-1 shrink-0">
        {bottomNav.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onCloseMobile}
              className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'bg-white text-black font-semibold'
                  : 'text-[#A0A0A0] hover:text-white hover:bg-[#141414]'
              } ${collapsed ? 'justify-center px-0' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={19} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}

              {/* Tooltip in collapsed mode */}
              {collapsed && (
                <div className="hidden md:group-hover:block absolute left-full ml-3 px-2.5 py-1 bg-[#1B1B1B] text-white text-xs rounded-md shadow-lg border border-[#292929] whitespace-nowrap z-50">
                  {item.label}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Fixed Sidebar */}
      <aside
        className={`hidden md:block fixed top-0 left-0 bottom-0 z-40 transition-all duration-200 ease-in-out ${
          collapsed ? 'w-[76px]' : 'w-[240px]'
        }`}
      >
        {navContent}
      </aside>

      {/* Mobile Drawer Backdrop */}
      {isMobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/80 backdrop-blur-sm z-50 transition-opacity"
          onClick={onCloseMobile}
        />
      )}

      {/* Mobile Sidebar Drawer */}
      <div
        className={`md:hidden fixed top-0 bottom-0 left-0 w-[260px] z-50 transform transition-transform duration-200 ease-in-out ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {navContent}
      </div>
    </>
  );
}
