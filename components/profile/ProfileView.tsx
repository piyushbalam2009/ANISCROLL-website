'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  User,
  Calendar,
  Edit3,
  Check,
  X,
  Settings,
  LogOut,
  Bookmark,
  History,
  CheckCircle2,
  Heart,
  Plus,
  Search,
  Lock,
  Globe,
  Users as UsersIcon,
  ExternalLink,
  Mail,
  Camera,
  Loader2,
  Play,
  Flag,
} from 'lucide-react';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { useAuth } from '@/hooks/useAuth';
import {
  FavouriteAnimeItem,
  PublicUserProfile,
} from '@/lib/profile-privacy';
import { WatchHistoryEntry, WatchlistEntry } from '@/types/streaming';
import { HoshikaAnimeItem } from '@/types/anime';

interface ProfileViewProps {
  profile: PublicUserProfile;
  isOwnProfile?: boolean;
  email?: string;
  provider?: 'password' | 'google';
  liveWatchlist?: WatchlistEntry[];
  liveHistory?: WatchHistoryEntry[];
  onOpenAvatarModal?: () => void;
  onUpdateProfile?: (patch: {
    displayName?: string;
    bio?: string;
    favouriteAnime?: FavouriteAnimeItem[];
  }) => Promise<unknown>;
  onSignOut?: () => Promise<void>;
}

function formatJoinDate(iso: string): string {
  if (!iso) return 'Member';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Member';
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatActivityTime(ts: number): string {
  if (!ts) return 'Recently';
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function ProfileView({
  profile,
  isOwnProfile = false,
  email,
  provider,
  liveWatchlist,
  liveHistory,
  onOpenAvatarModal,
  onUpdateProfile,
  onSignOut,
}: ProfileViewProps) {
  const [editingHeader, setEditingHeader] = useState(false);
  const [nameInput, setNameInput] = useState(profile.displayName);
  const [bioInput, setBioInput] = useState(profile.bio);
  const [savingHeader, setSavingHeader] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);

  // Favourite anime picker modal/drawer state (owner only)
  const [showFavPicker, setShowFavPicker] = useState(false);
  const [favSearchQuery, setFavSearchQuery] = useState('');
  const [favSearchResults, setFavSearchResults] = useState<HoshikaAnimeItem[]>([]);
  const [searchingFavs, setSearchingFavs] = useState(false);
  const [savingFavs, setSavingFavs] = useState(false);

  // Report user modal state (non-owner visitors)
  const { user: authUser } = useAuth();
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('Harassment or abusive behavior');
  const [reportDetails, setReportDetails] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);
  const [reportStatusMsg, setReportStatusMsg] = useState<string | null>(null);

  const initials = (profile.displayName || 'AS').slice(0, 2).toUpperCase();

  // Compute live owner stats & recent activity when on own profile
  const stats = useMemo(() => {
    if (isOwnProfile && liveWatchlist && liveHistory) {
      const completedCount = liveWatchlist.filter(
        (w) => w.status === 'completed'
      ).length;
      return {
        watchedEpisodes: liveHistory.length,
        watchlistCount: liveWatchlist.length,
        completedCount,
      };
    }
    return profile.stats;
  }, [isOwnProfile, liveWatchlist, liveHistory, profile.stats]);

  const recentActivity = useMemo(() => {
    if (isOwnProfile && liveHistory && liveHistory.length > 0) {
      const seen = new Set<string>();
      const list = [];
      for (const h of liveHistory) {
        const key = `${h.hoshikaId}_${h.episodeNumber}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({
          hoshikaId: h.hoshikaId,
          title: h.animeTitle || h.title || `Anime #${h.hoshikaId}`,
          coverImage: h.animeCover || h.coverImage,
          episodeNumber: h.episodeNumber || 1,
          timestamp: h.timestamp || 0,
        });
        if (list.length >= 12) break;
      }
      return list;
    }
    return profile.recentActivity || [];
  }, [isOwnProfile, liveHistory, profile.recentActivity]);

  const startEditingHeader = () => {
    setNameInput(profile.displayName);
    setBioInput(profile.bio || '');
    setHeaderError(null);
    setEditingHeader(true);
  };

  const handleSaveHeader = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpdateProfile || !nameInput.trim()) return;
    setSavingHeader(true);
    setHeaderError(null);
    try {
      await onUpdateProfile({
        displayName: nameInput.trim(),
        bio: bioInput.trim(),
      });
      setEditingHeader(false);
    } catch (err) {
      setHeaderError(
        err instanceof Error ? err.message : 'Unable to save profile details.'
      );
    } finally {
      setSavingHeader(false);
    }
  };

  const handleSearchFavouriteAnime = async (q: string) => {
    setFavSearchQuery(q);
    if (!q.trim()) {
      setFavSearchResults([]);
      return;
    }
    setSearchingFavs(true);
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q.trim())}&limit=8`
      );
      const data = await res.json();
      setFavSearchResults(Array.isArray(data?.results) ? data.results : []);
    } catch {
      setFavSearchResults([]);
    } finally {
      setSearchingFavs(false);
    }
  };

  const handleToggleFavourite = async (item: FavouriteAnimeItem) => {
    if (!onUpdateProfile || savingFavs) return;
    const exists = profile.favouriteAnime.some(
      (f) => f.hoshikaId === item.hoshikaId
    );
    const next = exists
      ? profile.favouriteAnime.filter((f) => f.hoshikaId !== item.hoshikaId)
      : [item, ...profile.favouriteAnime].slice(0, 12);

    setSavingFavs(true);
    try {
      await onUpdateProfile({ favouriteAnime: next });
    } finally {
      setSavingFavs(false);
    }
  };

  const visibilityIcon =
    profile.privacy.profileVisibility === 'private' ? (
      <Lock size={12} />
    ) : profile.privacy.profileVisibility === 'members' ? (
      <UsersIcon size={12} />
    ) : (
      <Globe size={12} />
    );

  const visibilityLabel =
    profile.privacy.profileVisibility === 'private'
      ? 'Private'
      : profile.privacy.profileVisibility === 'members'
      ? 'Members Only'
      : 'Public';

  const canSeeWatchlist =
    isOwnProfile || profile.privacy.showWatchlist;
  const canSeeActivity =
    isOwnProfile ||
    (profile.privacy.showWatchHistory && profile.privacy.showActivity);

  const handleSubmitUserReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser) {
      setReportStatusMsg('Please sign in to submit a report.');
      return;
    }
    setSubmittingReport(true);
    setReportStatusMsg(null);
    try {
      const token = await authUser.getIdToken();
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          targetType: 'user',
          targetId: profile.uid,
          targetName: `${profile.displayName} (@${profile.username})`,
          reason: reportReason,
          details: reportDetails,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to submit report');
      }
      setReportStatusMsg('Report submitted to moderation queue.');
      setReportDetails('');
      setTimeout(() => {
        setReportOpen(false);
        setReportStatusMsg(null);
      }, 1500);
    } catch (err) {
      setReportStatusMsg(err instanceof Error ? err.message : 'Unable to submit report.');
    } finally {
      setSubmittingReport(false);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl pb-20">
      {/* Main Profile Header Card */}
      <div className="p-6 sm:p-8 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 text-center sm:text-left">
          {/* Avatar */}
          <div className="relative group shrink-0">
            <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-2xl bg-[#141414] border border-white/25 overflow-hidden flex items-center justify-center text-2xl font-black text-white shadow-2xl">
              {profile.photoURL ? (
                <ResilientImage
                  src={profile.photoURL}
                  alt={profile.displayName}
                  fill
                  sizes="112px"
                  className="object-cover object-top"
                  fallback={<span>{initials}</span>}
                />
              ) : (
                <span>{initials}</span>
              )}
            </div>

            {isOwnProfile && onOpenAvatarModal && (
              <button
                type="button"
                onClick={onOpenAvatarModal}
                className="absolute -bottom-2 -right-2 px-2.5 py-1.5 rounded-xl bg-white text-black hover:bg-neutral-200 text-[10px] font-bold shadow-xl flex items-center gap-1 cursor-pointer transition-transform active:scale-95"
                title="Change anime avatar"
              >
                <Camera size={12} />
                <span>Avatar</span>
              </button>
            )}
          </div>

          {/* Identity & Bio */}
          <div className="flex-1 min-w-0 w-full space-y-3">
            {editingHeader ? (
              <form onSubmit={handleSaveHeader} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-mono uppercase text-[#707070] mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      maxLength={120}
                      required
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-[#141414] border border-white/40 text-sm text-white focus:outline-none"
                    />
                  </div>
                  <div className="flex items-end">
                    <Link
                      href="/settings"
                      className="text-xs text-[#A0A0A0] hover:text-white underline pb-2.5"
                    >
                      Edit @username & privacy in Settings →
                    </Link>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-mono uppercase text-[#707070] mb-1">
                    Bio ({bioInput.length}/300)
                  </label>
                  <textarea
                    rows={3}
                    maxLength={300}
                    value={bioInput}
                    onChange={(e) => setBioInput(e.target.value)}
                    placeholder="Tell other anime fans about your favorite genres or series..."
                    className="w-full p-3 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs sm:text-sm text-white placeholder-[#707070] focus:outline-none resize-none"
                  />
                </div>

                {headerError && (
                  <div className="text-xs text-white bg-[#141414] border border-white/30 px-3 py-2 rounded-lg">
                    {headerError}
                  </div>
                )}

                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <button
                    type="submit"
                    disabled={savingHeader}
                    className="px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {savingHeader ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Check size={14} />
                    )}
                    <span>{savingHeader ? 'Saving...' : 'Save Profile'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingHeader(false)}
                    className="px-3.5 py-2 rounded-xl border border-[#292929] text-xs text-[#A0A0A0] hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                  <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                    {profile.displayName}
                  </h1>
                  <RoleBadge role={profile.role} size="md" />
                  {isOwnProfile && onUpdateProfile && (
                    <button
                      type="button"
                      onClick={startEditingHeader}
                      className="p-1.5 rounded-lg bg-[#141414] border border-[#292929] text-[#A0A0A0] hover:text-white hover:border-white/40 transition-colors cursor-pointer"
                      title="Edit display name & bio"
                      aria-label="Edit display name & bio"
                    >
                      <Edit3 size={14} />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1.5 text-xs text-[#A0A0A0]">
                  <span className="font-mono text-white/90">@{profile.username}</span>
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar size={13} className="text-[#707070]" />
                    <span>Joined {formatJoinDate(profile.joinedAt)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#141414] border border-[#292929] text-[10px] font-mono uppercase text-[#A0A0A0]">
                    {visibilityIcon}
                    <span>{visibilityLabel}</span>
                  </span>
                  {profile.avatarCharacterName && (
                    <span className="text-[11px] text-[#707070]">
                      Avatar: <span className="text-[#A0A0A0]">{profile.avatarCharacterName}</span>
                      {profile.avatarAnimeName ? ` · ${profile.avatarAnimeName}` : ''}
                    </span>
                  )}
                </div>

                {isOwnProfile && email && (
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-[#707070]">
                    <span className="inline-flex items-center gap-1.5">
                      <Mail size={13} />
                      <span>{email}</span>
                    </span>
                    {provider && (
                      <span className="px-1.5 py-0.5 rounded bg-[#141414] border border-[#292929] text-[10px] font-mono uppercase text-[#A0A0A0]">
                        {provider === 'google' ? 'Google' : 'Email'}
                      </span>
                    )}
                  </div>
                )}

                <p className="text-xs sm:text-sm text-[#A0A0A0] leading-relaxed max-w-2xl">
                  {profile.bio ||
                    (isOwnProfile
                      ? 'No bio yet. Add a short introduction or pick your favourite anime below.'
                      : 'AniScroll community member.')}
                </p>

                {/* Action Row */}
                <div className="pt-2 flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                  {isOwnProfile ? (
                    <>
                      {onOpenAvatarModal && (
                        <button
                          type="button"
                          onClick={onOpenAvatarModal}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors cursor-pointer"
                        >
                          <Camera size={14} />
                          <span>Choose Anime Avatar</span>
                        </button>
                      )}
                      <Link
                        href="/settings"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white transition-colors"
                      >
                        <Settings size={14} />
                        <span>Settings & Privacy</span>
                      </Link>
                      <Link
                        href={`/profile/${profile.username || profile.uid}`}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white/50 text-xs font-medium text-[#A0A0A0] hover:text-white transition-colors"
                      >
                        <ExternalLink size={14} />
                        <span>Public View</span>
                      </Link>
                      <Link
                        href="/members"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white/50 text-xs font-medium text-[#A0A0A0] hover:text-white transition-colors"
                      >
                        <UsersIcon size={14} />
                        <span>Community</span>
                      </Link>
                      {onSignOut && (
                        <button
                          type="button"
                          onClick={onSignOut}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#292929] text-xs text-[#A0A0A0] hover:text-white hover:border-white transition-colors cursor-pointer"
                        >
                          <LogOut size={14} />
                          <span>Sign Out</span>
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <Link
                        href="/members"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white transition-colors"
                      >
                        <UsersIcon size={14} />
                        <span>Browse Members</span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setReportStatusMsg(null);
                          setReportOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white/50 text-xs font-medium text-[#A0A0A0] hover:text-white transition-colors cursor-pointer"
                      >
                        <Flag size={13} />
                        <span>Report User</span>
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Watch Statistics Row */}
      {stats ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl bg-[#0A0A0A] border border-[#292929]">
            <div className="flex items-center justify-between text-[#707070] mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">
                Watchlist Titles
              </span>
              <Bookmark size={18} />
            </div>
            <div className="text-3xl font-black text-white font-mono">
              {stats.watchlistCount}
            </div>
            <span className="text-[11px] text-[#707070] mt-1 block">
              {isOwnProfile ? (
                <Link href="/watchlist" className="hover:text-white underline">
                  Manage your watchlist →
                </Link>
              ) : (
                'Saved anime series'
              )}
            </span>
          </div>

          <div className="p-5 rounded-2xl bg-[#0A0A0A] border border-[#292929]">
            <div className="flex items-center justify-between text-[#707070] mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">
                Episodes Watched
              </span>
              <History size={18} />
            </div>
            <div className="text-3xl font-black text-white font-mono">
              {stats.watchedEpisodes}
            </div>
            <span className="text-[11px] text-[#707070] mt-1 block">
              {isOwnProfile ? (
                <Link href="/history" className="hover:text-white underline">
                  View watch history →
                </Link>
              ) : (
                'Total streamed episodes'
              )}
            </span>
          </div>

          <div className="p-5 rounded-2xl bg-[#0A0A0A] border border-[#292929]">
            <div className="flex items-center justify-between text-[#707070] mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">
                Completed Series
              </span>
              <CheckCircle2 size={18} />
            </div>
            <div className="text-3xl font-black text-white font-mono">
              {stats.completedCount}
            </div>
            <span className="text-[11px] text-[#707070] mt-1 block">
              Finished series in watchlist
            </span>
          </div>
        </div>
      ) : (
        <div className="p-5 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex items-center gap-3 text-xs text-[#707070]">
          <Lock size={15} />
          <span>Watch statistics are hidden by this user&apos;s privacy settings.</span>
        </div>
      )}

      {/* Favourite Anime Showcase */}
      <section className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Heart size={17} className="text-white" />
            <h2 className="text-base font-bold text-white">Favourite Anime</h2>
            <span className="text-xs font-mono text-[#707070]">
              ({canSeeWatchlist ? profile.favouriteAnime.length : 'Hidden'})
            </span>
          </div>

          {isOwnProfile && onUpdateProfile && (
            <button
              type="button"
              onClick={() => setShowFavPicker((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white transition-colors cursor-pointer"
            >
              {showFavPicker ? <X size={13} /> : <Plus size={13} />}
              <span>{showFavPicker ? 'Done' : 'Add Favourite'}</span>
            </button>
          )}
        </div>

        {/* Owner Inline Favourite Picker */}
        {isOwnProfile && showFavPicker && (
          <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-4">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#707070]"
              />
              <input
                type="text"
                value={favSearchQuery}
                onChange={(e) => handleSearchFavouriteAnime(e.target.value)}
                placeholder="Search anime to pin to your profile..."
                className="w-full h-9 pl-9 pr-3 rounded-lg bg-[#0A0A0A] border border-[#292929] focus:border-white text-xs text-white placeholder-[#707070] focus:outline-none"
              />
            </div>

            {searchingFavs ? (
              <div className="py-4 flex justify-center">
                <Loader2 size={18} className="animate-spin text-white" />
              </div>
            ) : favSearchResults.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {favSearchResults.map((anime) => {
                  const id = anime.shortId;
                  const title =
                    anime.titleEnglish ||
                    anime.titleRomaji ||
                    anime.titleLocalized ||
                    `Anime #${id}`;
                  const isAdded = profile.favouriteAnime.some(
                    (f) => f.hoshikaId === id
                  );
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() =>
                        handleToggleFavourite({
                          hoshikaId: id,
                          title,
                          coverImage: anime.coverImage || undefined,
                          format: anime.format || undefined,
                          seasonYear: anime.seasonYear ?? undefined,
                        })
                      }
                      className={`p-2 rounded-lg border text-left flex items-center gap-3 transition-colors cursor-pointer ${
                        isAdded
                          ? 'bg-white text-black border-white'
                          : 'bg-[#0A0A0A] text-white border-[#292929] hover:border-white/50'
                      }`}
                    >
                      <div className="relative w-9 h-12 rounded overflow-hidden shrink-0 bg-[#1B1B1B]">
                        <ResilientImage
                          src={anime.coverImage}
                          alt={title}
                          fill
                          sizes="36px"
                          className="object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{title}</div>
                        <div className="text-[10px] opacity-70">
                          {anime.format || 'TV'}
                          {anime.seasonYear ? ` · ${anime.seasonYear}` : ''}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded border border-current shrink-0">
                        {isAdded ? 'Added' : 'Pin'}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : liveWatchlist && liveWatchlist.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[11px] font-mono uppercase text-[#707070]">
                  Quick Pick From Your Watchlist
                </div>
                <div className="flex flex-wrap gap-2">
                  {liveWatchlist.slice(0, 12).map((w) => {
                    const isAdded = profile.favouriteAnime.some(
                      (f) => f.hoshikaId === w.hoshikaId
                    );
                    return (
                      <button
                        key={w.hoshikaId}
                        type="button"
                        onClick={() =>
                          handleToggleFavourite({
                            hoshikaId: w.hoshikaId,
                            title: w.title,
                            coverImage: w.coverImage,
                            format: w.format,
                            seasonYear: w.seasonYear,
                          })
                        }
                        className={`px-3 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                          isAdded
                            ? 'bg-white text-black border-white font-semibold'
                            : 'bg-[#0A0A0A] text-[#A0A0A0] border-[#292929] hover:text-white'
                        }`}
                      >
                        {isAdded ? '✓ ' : '+ '}
                        {w.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {!canSeeWatchlist ? (
          <div className="py-6 flex items-center gap-2 text-xs text-[#707070]">
            <Lock size={14} />
            <span>Favourite anime are hidden by this user&apos;s privacy settings.</span>
          </div>
        ) : profile.favouriteAnime.length === 0 ? (
          <p className="text-xs text-[#707070] py-2">
            {isOwnProfile
              ? 'Pin up to 12 favourite anime series to showcase on your profile.'
              : 'No favourite anime pinned yet.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {profile.favouriteAnime.map((anime) => (
              <div key={anime.hoshikaId} className="group relative">
                <Link
                  href={`/anime/${anime.hoshikaId}`}
                  prefetch={false}
                  className="block rounded-xl overflow-hidden bg-[#141414] border border-[#292929] hover:border-white/60 transition-colors"
                >
                  <div className="relative aspect-[3/4] bg-[#070707]">
                    <ResilientImage
                      src={anime.coverImage}
                      alt={anime.title}
                      fill
                      sizes="160px"
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                  <div className="p-2">
                    <div className="text-xs font-semibold text-white truncate">
                      {anime.title}
                    </div>
                    {(anime.format || anime.seasonYear) && (
                      <div className="text-[10px] text-[#707070] truncate">
                        {anime.format || 'TV'}
                        {anime.seasonYear ? ` · ${anime.seasonYear}` : ''}
                      </div>
                    )}
                  </div>
                </Link>
                {isOwnProfile && onUpdateProfile && (
                  <button
                    type="button"
                    onClick={() => handleToggleFavourite(anime)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/80 border border-white/30 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    title="Remove from favourites"
                    aria-label={`Remove ${anime.title} from favourites`}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recently Watched Anime */}
      <section className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Play size={16} className="text-white" />
            <h2 className="text-base font-bold text-white">Recently Watched</h2>
          </div>
          {isOwnProfile && (
            <Link
              href="/history"
              className="text-xs text-[#A0A0A0] hover:text-white underline"
            >
              Full History →
            </Link>
          )}
        </div>

        {!canSeeActivity ? (
          <div className="py-6 flex items-center gap-2 text-xs text-[#707070]">
            <Lock size={14} />
            <span>Watch activity is hidden by this user&apos;s privacy settings.</span>
          </div>
        ) : recentActivity.length === 0 ? (
          <p className="text-xs text-[#707070] py-2">
            {isOwnProfile
              ? 'Start watching any episode and your recent activity will appear here.'
              : 'No recent public watch activity.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentActivity.slice(0, 6).map((act) => (
              <Link
                key={`${act.hoshikaId}_${act.episodeNumber}`}
                href={`/anime/${act.hoshikaId}`}
                prefetch={false}
                className="p-3 rounded-xl bg-[#141414] border border-[#292929] hover:border-white/50 transition-colors flex items-center gap-3 group"
              >
                <div className="relative w-12 h-16 rounded-lg overflow-hidden bg-black shrink-0 border border-[#292929]">
                  <ResilientImage
                    src={act.coverImage}
                    alt={act.title}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white truncate group-hover:underline">
                    {act.title}
                  </div>
                  <div className="text-[11px] font-mono text-[#A0A0A0] mt-0.5">
                    Episode {act.episodeNumber}
                  </div>
                  <div className="text-[10px] text-[#707070] mt-0.5">
                    {formatActivityTime(act.timestamp)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Report User Modal */}
      {reportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-user-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#0A0A0A] border border-[#292929] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 id="report-user-modal-title" className="text-sm font-bold text-white flex items-center gap-2">
                <Flag size={15} />
                <span>Report @{profile.username}</span>
              </h3>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="p-1.5 rounded-lg text-[#707070] hover:text-white hover:bg-[#141414] cursor-pointer"
                aria-label="Close report dialog"
              >
                <X size={15} />
              </button>
            </div>

            {!authUser ? (
              <div className="space-y-3 text-xs text-[#A0A0A0]">
                <p>You must be signed in to submit a community moderation report.</p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    className="px-4 py-2 rounded-xl bg-[#141414] border border-[#292929] text-white cursor-pointer"
                  >
                    Close
                  </button>
                  <Link
                    href="/login"
                    className="px-4 py-2 rounded-xl bg-white text-black font-bold"
                  >
                    Sign In
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmitUserReport} className="space-y-3.5">
                <div>
                  <label className="block text-[11px] font-mono uppercase text-[#707070] mb-1">
                    Reason
                  </label>
                  <select
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white"
                  >
                    <option value="Harassment or abusive behavior">
                      Harassment or abusive behavior
                    </option>
                    <option value="Spam or automated abuse">
                      Spam or automated abuse
                    </option>
                    <option value="Inappropriate profile content">
                      Inappropriate profile content
                    </option>
                    <option value="Impersonation">Impersonation</option>
                    <option value="Other policy violation">Other policy violation</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-mono uppercase text-[#707070] mb-1">
                    Additional Details (Optional)
                  </label>
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                    placeholder="Provide helpful context for moderators..."
                    className="w-full p-3 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white resize-none"
                  />
                </div>

                {reportStatusMsg && (
                  <div className="p-2.5 rounded-lg bg-[#141414] border border-[#292929] text-xs text-white">
                    {reportStatusMsg}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setReportOpen(false)}
                    className="px-4 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-[#A0A0A0] hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingReport}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs cursor-pointer disabled:opacity-50"
                  >
                    {submittingReport && <Loader2 size={13} className="animate-spin" />}
                    <span>Submit Report</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
