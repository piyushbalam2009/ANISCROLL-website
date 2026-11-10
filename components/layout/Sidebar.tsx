'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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
  LogIn,
  LogOut,
  Shield,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

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
  const router = useRouter();
  const { user, profile, isAdmin, signOutUser } = useAuth();

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

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const handleSignOut = async () => {
    onCloseMobile();
    await signOutUser();
    router.push('/');
  };

  const displayName =
    profile?.displayName ||
    user?.displayName ||
    user?.email?.split('@')[0] ||
    'Profile';

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
        {isAdmin && (
          <Link
            href="/admin"
            onClick={onCloseMobile}
            className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
              isActive('/admin')
                ? 'bg-white text-black'
                : 'bg-[#141414] text-white border border-[#292929] hover:border-white/40'
            } ${collapsed ? 'justify-center px-0' : ''}`}
            title={collapsed ? 'Admin Console' : undefined}
          >
            <Shield size={18} className="shrink-0" />
            {!collapsed && <span className="truncate">Admin Console</span>}
            {collapsed && (
              <div className="hidden md:group-hover:block absolute left-full ml-3 px-2.5 py-1 bg-[#1B1B1B] text-white text-xs rounded-md shadow-lg border border-[#292929] whitespace-nowrap z-50">
                Admin Console
              </div>
            )}
          </Link>
        )}

        <Link
          href="/settings"
          onClick={onCloseMobile}
          className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            isActive('/settings')
              ? 'bg-white text-black font-semibold'
              : 'text-[#A0A0A0] hover:text-white hover:bg-[#141414]'
          } ${collapsed ? 'justify-center px-0' : ''}`}
          title={collapsed ? 'Settings' : undefined}
        >
          <Settings size={19} className="shrink-0" />
          {!collapsed && <span className="truncate">Settings</span>}
          {collapsed && (
            <div className="hidden md:group-hover:block absolute left-full ml-3 px-2.5 py-1 bg-[#1B1B1B] text-white text-xs rounded-md shadow-lg border border-[#292929] whitespace-nowrap z-50">
              Settings
            </div>
          )}
        </Link>

        {user ? (
          <>
            <Link
              href="/profile"
              onClick={onCloseMobile}
              className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive('/profile')
                  ? 'bg-white text-black font-semibold'
                  : 'text-[#A0A0A0] hover:text-white hover:bg-[#141414]'
              } ${collapsed ? 'justify-center px-0' : ''}`}
              title={collapsed ? displayName : undefined}
            >
              <User size={19} className="shrink-0" />
              {!collapsed && <span className="truncate">{displayName}</span>}
              {collapsed && (
                <div className="hidden md:group-hover:block absolute left-full ml-3 px-2.5 py-1 bg-[#1B1B1B] text-white text-xs rounded-md shadow-lg border border-[#292929] whitespace-nowrap z-50">
                  {displayName}
                </div>
              )}
            </Link>

            <button
              type="button"
              onClick={handleSignOut}
              className={`w-full group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-[#A0A0A0] hover:text-white hover:bg-[#141414] transition-all ${
                collapsed ? 'justify-center px-0' : ''
              }`}
              title={collapsed ? 'Sign Out' : undefined}
            >
              <LogOut size={19} className="shrink-0" />
              {!collapsed && <span className="truncate">Sign Out</span>}
              {collapsed && (
                <div className="hidden md:group-hover:block absolute left-full ml-3 px-2.5 py-1 bg-[#1B1B1B] text-white text-xs rounded-md shadow-lg border border-[#292929] whitespace-nowrap z-50">
                  Sign Out
                </div>
              )}
            </button>
          </>
        ) : (
          <Link
            href="/login"
            onClick={onCloseMobile}
            className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              isActive('/login')
                ? 'bg-white text-black font-semibold'
                : 'text-[#A0A0A0] hover:text-white hover:bg-[#141414]'
            } ${collapsed ? 'justify-center px-0' : ''}`}
            title={collapsed ? 'Sign In' : undefined}
          >
            <LogIn size={19} className="shrink-0" />
            {!collapsed && <span className="truncate">Sign In</span>}
            {collapsed && (
              <div className="hidden md:group-hover:block absolute left-full ml-3 px-2.5 py-1 bg-[#1B1B1B] text-white text-xs rounded-md shadow-lg border border-[#292929] whitespace-nowrap z-50">
                Sign In
              </div>
            )}
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside
        className={`hidden md:block fixed top-0 left-0 bottom-0 z-40 transition-all duration-200 ease-in-out ${
          collapsed ? 'w-[76px]' : 'w-[240px]'
        }`}
      >
        {navContent}
      </aside>

      {isMobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/80 backdrop-blur-sm z-50 transition-opacity"
          onClick={onCloseMobile}
        />
      )}

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
