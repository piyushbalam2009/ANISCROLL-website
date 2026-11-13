'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Lock, ArrowLeft, LogIn, UserX, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { PublicUserProfile } from '@/lib/profile-privacy';
import { ProfileView } from '@/components/profile/ProfileView';
import { RoleBadge } from '@/components/ui/RoleBadge';

export default function PublicProfilePage() {
  const params = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const identifier = params?.id ? decodeURIComponent(String(params.id)) : '';

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [restrictedInfo, setRestrictedInfo] = useState<{
    reason: string;
    minimal?: {
      uid: string;
      username: string;
      displayName: string;
      role: string;
      privacy?: { profileVisibility?: string };
    };
  } | null>(null);
  const [notFoundError, setNotFoundError] = useState(false);

  useEffect(() => {
    if (!identifier || authLoading) return;
    let active = true;

    async function load() {
      setLoading(true);
      setRestrictedInfo(null);
      setNotFoundError(false);

      try {
        const headers: Record<string, string> = {};
        if (user) {
          const token = await user.getIdToken();
          headers.Authorization = `Bearer ${token}`;
        }

        const res = await fetch(
          `/api/profile/${encodeURIComponent(identifier)}`,
          { headers }
        );
        const data = await res.json().catch(() => null);

        if (!active) return;

        if (res.status === 403 && data?.restricted) {
          setRestrictedInfo({
            reason: data.error || 'This profile is private.',
            minimal: data.minimal,
          });
          setProfile(null);
          return;
        }

        if (!res.ok || !data?.ok || !data?.profile) {
          setNotFoundError(true);
          setProfile(null);
          return;
        }

        setProfile(data.profile);
        setIsOwner(Boolean(data.isOwner));
      } catch {
        if (active) setNotFoundError(true);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [identifier, user, authLoading]);

  if (loading || authLoading) {
    return (
      <div className="max-w-5xl space-y-6 pb-20">
        <div className="p-8 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex items-center gap-4">
          <Loader2 size={22} className="animate-spin text-white" />
          <span className="text-xs font-mono uppercase tracking-wider text-[#A0A0A0]">
            Loading AniScroll Profile...
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="h-28 rounded-2xl bg-[#0A0A0A] border border-[#292929] animate-pulse" />
          <div className="h-28 rounded-2xl bg-[#0A0A0A] border border-[#292929] animate-pulse" />
          <div className="h-28 rounded-2xl bg-[#0A0A0A] border border-[#292929] animate-pulse" />
        </div>
      </div>
    );
  }

  if (restrictedInfo) {
    return (
      <div className="max-w-xl mx-auto mt-10 p-8 rounded-2xl bg-[#0A0A0A] border border-[#292929] text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-[#141414] border border-[#292929] flex items-center justify-center mx-auto text-white">
          <Lock size={22} />
        </div>

        {restrictedInfo.minimal && (
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-2">
              <h1 className="text-lg font-bold text-white">
                {restrictedInfo.minimal.displayName}
              </h1>
              <RoleBadge role={restrictedInfo.minimal.role} size="sm" />
            </div>
            <div className="text-xs font-mono text-[#707070]">
              @{restrictedInfo.minimal.username}
            </div>
          </div>
        )}

        <p className="text-sm text-[#A0A0A0]">{restrictedInfo.reason}</p>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {!user &&
            restrictedInfo.minimal?.privacy?.profileVisibility === 'members' && (
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors"
              >
                <LogIn size={14} />
                <span>Sign In to View</span>
              </Link>
            )}
          <Link
            href="/members"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs text-white transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Back to Community</span>
          </Link>
        </div>
      </div>
    );
  }

  if (notFoundError || !profile) {
    return (
      <div className="max-w-xl mx-auto mt-10 p-8 rounded-2xl bg-[#0A0A0A] border border-[#292929] text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-[#141414] border border-[#292929] flex items-center justify-center mx-auto text-[#707070]">
          <UserX size={22} />
        </div>
        <h1 className="text-xl font-bold text-white">Profile Not Found</h1>
        <p className="text-xs sm:text-sm text-[#A0A0A0]">
          No AniScroll member matched &ldquo;{identifier}&rdquo;.
        </p>
        <div className="pt-2">
          <Link
            href="/members"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Browse Members Directory</span>
          </Link>
        </div>
      </div>
    );
  }

  return <ProfileView profile={profile} isOwnProfile={isOwner} />;
}
