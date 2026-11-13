'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Users,
  Search,
  User,
  Bookmark,
  History,
  ArrowUpRight,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { PublicUserProfile } from '@/lib/profile-privacy';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { RoleBadge } from '@/components/ui/RoleBadge';

const ROLE_FILTERS = [
  { id: 'all', label: 'All Roles' },
  { id: 'owner', label: 'Owner' },
  { id: 'admin', label: 'Admin' },
  { id: 'mod', label: 'Mod' },
  { id: 'member', label: 'Member' },
] as const;

export default function MembersDirectoryPage() {
  const { user, loading: authLoading } = useAuth();
  const [members, setMembers] = useState<PublicUserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (user) {
        const token = await user.getIdToken();
        headers.Authorization = `Bearer ${token}`;
      }
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (roleFilter !== 'all') params.set('role', roleFilter);

      const res = await fetch(`/api/members?${params.toString()}`, { headers });
      const data = await res.json().catch(() => null);
      setMembers(Array.isArray(data?.members) ? data.members : []);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [user, searchQuery, roleFilter]);

  useEffect(() => {
    if (authLoading) return;
    const timer = setTimeout(() => {
      fetchMembers();
    }, 200);
    return () => clearTimeout(timer);
  }, [authLoading, fetchMembers]);

  return (
    <div className="space-y-6 max-w-6xl pb-20">
      {/* Header */}
      <div className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white text-black flex items-center justify-center shrink-0">
            <Users size={20} />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              AniScroll Community
            </h1>
            <p className="text-xs text-[#707070]">
              Discover community members, moderators, administrators, and public anime profiles.
            </p>
          </div>
        </div>

        {user && (
          <Link
            href="/profile"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors shrink-0"
          >
            <span>My Profile</span>
            <ArrowUpRight size={14} />
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="p-4 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search
            size={15}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#707070]"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search members by name, @username, or bio..."
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs sm:text-sm text-white placeholder-[#707070] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {ROLE_FILTERS.map((rf) => {
            const active = roleFilter === rf.id;
            return (
              <button
                key={rf.id}
                type="button"
                onClick={() => setRoleFilter(rf.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono uppercase transition-colors cursor-pointer border ${
                  active
                    ? 'bg-white text-black border-white font-bold'
                    : 'bg-[#141414] text-[#A0A0A0] border-[#292929] hover:text-white'
                }`}
              >
                {rf.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Directory Grid */}
      {loading ? (
        <div className="py-16 flex flex-col items-center justify-center gap-3 text-[#A0A0A0]">
          <Loader2 size={24} className="animate-spin text-white" />
          <span className="text-xs font-mono uppercase tracking-wider">
            Loading Community Profiles...
          </span>
        </div>
      ) : members.length === 0 ? (
        <div className="p-12 rounded-2xl bg-[#0A0A0A] border border-[#292929] text-center space-y-2">
          <Users size={26} className="mx-auto text-[#707070]" />
          <div className="text-sm font-bold text-white">No Members Found</div>
          <p className="text-xs text-[#707070]">
            Try clearing your search filter or check back as more members make their profiles public.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map((member) => {
            const initials = (member.displayName || 'AS').slice(0, 2).toUpperCase();
            return (
              <Link
                key={member.uid}
                href={`/profile/${member.username || member.uid}`}
                className="group p-5 rounded-2xl bg-[#0A0A0A] border border-[#292929] hover:border-white/50 hover:bg-[#111111] transition-all flex flex-col justify-between gap-4"
              >
                <div className="flex items-start gap-3.5">
                  <div className="relative w-14 h-14 rounded-xl bg-[#141414] border border-white/15 overflow-hidden flex items-center justify-center font-bold text-sm text-white shrink-0">
                    {member.photoURL ? (
                      <ResilientImage
                        src={member.photoURL}
                        alt={member.displayName}
                        fill
                        sizes="56px"
                        className="object-cover object-top"
                        fallback={<User size={20} />}
                      />
                    ) : (
                      <span>{initials}</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-white truncate group-hover:underline">
                        {member.displayName}
                      </span>
                      <RoleBadge role={member.role} size="xs" />
                    </div>
                    <div className="text-xs font-mono text-[#707070] truncate mt-0.5">
                      @{member.username}
                    </div>
                    <p className="text-xs text-[#A0A0A0] line-clamp-2 mt-2 leading-relaxed">
                      {member.bio || 'AniScroll anime watcher'}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-[#1D1D1D] flex items-center justify-between text-[11px] font-mono text-[#707070]">
                  {member.stats ? (
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1">
                        <Bookmark size={12} />
                        <span>{member.stats.watchlistCount} saved</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <History size={12} />
                        <span>{member.stats.watchedEpisodes} eps</span>
                      </span>
                    </div>
                  ) : (
                    <span>Stats private</span>
                  )}
                  <span className="text-white/70 group-hover:text-white inline-flex items-center gap-0.5">
                    <span>View</span>
                    <ArrowUpRight size={12} />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
