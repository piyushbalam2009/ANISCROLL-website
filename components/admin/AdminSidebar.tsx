'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Image as ImageIcon,
  AlertTriangle,
  Users,
  Film,
  Activity,
  Megaphone,
  ShieldCheck,
  FileClock,
  Settings,
  ArrowLeft,
  LogOut,
  X,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { ROLE_LABELS } from '@/lib/admin/admin-permissions';

interface AdminSidebarProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const ADMIN_NAV_ITEMS = [
  {
    label: 'Overview',
    href: '/admin',
    icon: LayoutDashboard,
    exact: true,
    badge: 'KPI',
  },
  {
    label: 'Artwork Management',
    href: '/admin/artwork',
    icon: ImageIcon,
    exact: false,
    badge: 'FANART',
  },
  {
    label: 'Missing Logos',
    href: '/admin/missing-logos',
    icon: AlertTriangle,
    exact: false,
    badge: 'SCANNER',
  },
  {
    label: 'User Management',
    href: '/admin/users',
    icon: Users,
    exact: false,
  },
  {
    label: 'Anime Management',
    href: '/admin/anime',
    icon: Film,
    exact: false,
  },
  {
    label: 'Streaming Monitor',
    href: '/admin/streaming',
    icon: Activity,
    exact: false,
    badge: 'LIVE',
  },
  {
    label: 'Announcements',
    href: '/admin/announcements',
    icon: Megaphone,
    exact: false,
  },
  {
    label: 'Admin Management',
    href: '/admin/admins',
    icon: ShieldCheck,
    exact: false,
    badge: 'RBAC',
  },
  {
    label: 'Activity Logs',
    href: '/admin/activity',
    icon: FileClock,
    exact: false,
    badge: 'AUDIT',
  },
  {
    label: 'Settings',
    href: '/admin/settings',
    icon: Settings,
    exact: false,
  },
];

export function AdminSidebar({ mobileOpen, onCloseMobile }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { adminRecord, signOutUser } = useAuth();

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const roleMeta =
    adminRecord?.role && ROLE_LABELS[adminRecord.role]
      ? ROLE_LABELS[adminRecord.role]
      : ROLE_LABELS.analyst;

  const handleSignOut = async () => {
    onCloseMobile();
    await signOutUser();
    router.push('/');
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#0A0A0A] border-r border-[#292929] select-none w-[264px]">
      {/* Brand Header */}
      <div className="h-16 px-5 border-b border-[#292929] flex items-center justify-between shrink-0">
        <Link
          href="/admin"
          onClick={onCloseMobile}
          className="flex items-center gap-3 group"
        >
          <div className="w-8 h-8 rounded-lg bg-white text-black flex items-center justify-center font-black text-xs tracking-tighter">
            AS
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-wider uppercase text-white">
                AniScroll
              </span>
              <span className="px-1.5 py-0.5 rounded bg-white text-black font-mono font-bold text-[9px] uppercase tracking-widest">
                ADMIN
              </span>
            </div>
            <div className="text-[10px] font-mono text-[#707070] uppercase tracking-wider">
              Control Plane v2.4
            </div>
          </div>
        </Link>

        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 rounded-lg text-[#A0A0A0] hover:text-white hover:bg-[#141414]"
          aria-label="Close admin navigation"
        >
          <X size={18} />
        </button>
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        <div className="px-3 pb-2 text-[10px] font-mono font-semibold uppercase tracking-widest text-[#707070]">
          Operations & Systems
        </div>

        {ADMIN_NAV_ITEMS.map((item) => {
          const active = isActive(item.href, item.exact);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onCloseMobile}
              className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                active
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-[#A0A0A0] hover:text-white hover:bg-[#141414]'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Icon size={16} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </div>
              {item.badge && (
                <span
                  className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-semibold tracking-wider uppercase ${
                    active
                      ? 'bg-black/15 text-black'
                      : 'bg-[#141414] text-[#707070] border border-[#292929]'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Admin Identity & Footer */}
      <div className="p-3 border-t border-[#292929] space-y-2 bg-[#070707] shrink-0">
        {adminRecord && (
          <div className="px-3 py-2.5 rounded-lg bg-[#141414] border border-[#292929]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-white truncate">
                {adminRecord.displayName}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-white text-black font-mono text-[9px] font-bold uppercase tracking-wider shrink-0">
                {adminRecord.role}
              </span>
            </div>
            <div className="text-[11px] font-mono text-[#707070] truncate mt-0.5">
              {adminRecord.email}
            </div>
            <div className="text-[10px] font-mono text-[#A0A0A0] mt-1.5 uppercase tracking-wider">
              {roleMeta.badge}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          <Link
            href="/"
            onClick={onCloseMobile}
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-[#141414] border border-[#292929] hover:border-white/40 text-xs font-medium text-white transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Live Site</span>
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-[#141414] border border-[#292929] hover:border-white/40 text-xs font-medium text-[#A0A0A0] hover:text-white transition-colors cursor-pointer"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block fixed top-0 left-0 bottom-0 z-40 w-[264px]">
        {sidebarContent}
      </aside>

      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
          onClick={onCloseMobile}
        />
      )}

      <div
        className={`lg:hidden fixed top-0 bottom-0 left-0 z-50 transform transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </div>
    </>
  );
}
