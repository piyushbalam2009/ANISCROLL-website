'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { useRouter } from 'next/navigation';
import {
  User,
  Bookmark,
  History,
  PlayCircle,
  Settings,
  ShieldCheck,
  LogOut,
  Check,
  Edit3,
  Mail,
} from 'lucide-react';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useWatchHistory } from '@/hooks/useWatchHistory';
import { useContinueWatching } from '@/hooks/useContinueWatching';

export default function ProfilePage() {
  const router = useRouter();
  const { user, profile, signOutUser, updateUserDisplayName } = useAuth();
  const { watchlist, mounted: watchlistMounted } = useWatchlist();
  const { history, mounted: historyMounted } = useWatchHistory();
  const { items: continueItems, mounted: cwMounted } = useContinueWatching();

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  const displayName =
    profile?.displayName ||
    user?.displayName ||
    user?.email?.split('@')[0] ||
    'AniScroll Member';
  const email = profile?.email || user?.email || '';
  const photoURL = profile?.photoURL || user?.photoURL || '';
  const provider = profile?.provider || 'password';

  const startEditing = () => {
    setNameInput(displayName);
    setIsEditingName(true);
  };

  const saveDisplayName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    setSavingName(true);
    try {
      await updateUserDisplayName(nameInput.trim());
      setIsEditingName(false);
    } finally {
      setSavingName(false);
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
    router.push('/');
  };

  return (
    <ProtectedRoute>
      <div className="space-y-8 max-w-4xl pb-20">
        {/* Profile Header */}
        <div className="p-6 md:p-8 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col sm:flex-row items-center sm:items-start gap-6 text-center sm:text-left">
          <div className="relative w-20 h-20 rounded-2xl bg-white text-black flex items-center justify-center font-bold text-2xl shadow-xl shrink-0 overflow-hidden border border-white/20">
            <ResilientImage
              src={photoURL}
              alt={displayName}
              fill
              sizes="80px"
              className="object-cover"
              fallback={<User size={36} />}
            />
          </div>

          <div className="flex-1 space-y-2">
            {isEditingName ? (
              <form
                onSubmit={saveDisplayName}
                className="flex flex-wrap items-center justify-center sm:justify-start gap-2"
              >
                <input
                  type="text"
                  maxLength={120}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="h-9 px-3 rounded-lg bg-[#141414] border border-white/40 text-sm text-white focus:outline-none"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={savingName}
                  className="h-9 px-3 rounded-lg bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors flex items-center gap-1"
                >
                  <Check size={14} />
                  <span>{savingName ? 'Saving...' : 'Save'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingName(false)}
                  className="h-9 px-2.5 text-xs text-[#A0A0A0] hover:text-white"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  {displayName}
                </h1>
                <button
                  type="button"
                  onClick={startEditing}
                  className="p-1.5 rounded-lg text-[#A0A0A0] hover:text-white hover:bg-[#141414] transition-colors"
                  title="Edit Display Name"
                  aria-label="Edit Display Name"
                >
                  <Edit3 size={14} />
                </button>
                <span className="text-[10px] font-mono uppercase bg-[#141414] border border-[#292929] text-white px-2 py-0.5 rounded">
                  {provider === 'google' ? 'Google Account' : 'Email Account'}
                </span>
              </div>
            )}

            {email && (
              <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs text-[#A0A0A0]">
                <Mail size={13} className="text-[#707070]" />
                <span>{email}</span>
              </div>
            )}

            <p className="text-xs text-[#707070]">
              Your watchlist, continue watching queue, watch history, and playback preferences are synced in real time with Cloud Firestore.
            </p>

            <div className="pt-3 flex flex-wrap items-center justify-center sm:justify-start gap-3">
              <Link
                href="/settings"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors"
              >
                <Settings size={14} />
                <span>Edit Preferences</span>
              </Link>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#292929] text-xs text-[#A0A0A0] hover:text-white hover:border-white transition-colors"
              >
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link
            href="/watchlist"
            className="p-5 rounded-2xl bg-[#0A0A0A] border border-[#292929] hover:border-[#404040] hover:bg-[#141414] transition-all group"
          >
            <div className="flex items-center justify-between text-[#707070] mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">
                Saved in Watchlist
              </span>
              <Bookmark size={18} className="group-hover:text-white transition-colors" />
            </div>
            <div className="text-3xl font-black text-white font-mono">
              {watchlistMounted ? watchlist.length : '--'}
            </div>
            <span className="text-[11px] text-[#A0A0A0] mt-1 block">
              Click to manage titles
            </span>
          </Link>

          <Link
            href="/history"
            className="p-5 rounded-2xl bg-[#0A0A0A] border border-[#292929] hover:border-[#404040] hover:bg-[#141414] transition-all group"
          >
            <div className="flex items-center justify-between text-[#707070] mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">
                Episodes Streamed
              </span>
              <History size={18} className="group-hover:text-white transition-colors" />
            </div>
            <div className="text-3xl font-black text-white font-mono">
              {historyMounted ? history.length : '--'}
            </div>
            <span className="text-[11px] text-[#A0A0A0] mt-1 block">
              View complete playback log
            </span>
          </Link>

          <Link
            href="/continue-watching"
            className="p-5 rounded-2xl bg-[#0A0A0A] border border-[#292929] hover:border-[#404040] hover:bg-[#141414] transition-all group"
          >
            <div className="flex items-center justify-between text-[#707070] mb-2">
              <span className="text-xs font-medium uppercase tracking-wider">
                Continue Watching
              </span>
              <PlayCircle size={18} className="group-hover:text-white transition-colors" />
            </div>
            <div className="text-3xl font-black text-white font-mono">
              {cwMounted ? continueItems.length : '--'}
            </div>
            <span className="text-[11px] text-[#A0A0A0] mt-1 block">
              Resume in-progress series
            </span>
          </Link>
        </div>

        {/* Cloud Sync Architecture Info */}
        <div className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-3 text-xs text-[#A0A0A0] leading-relaxed">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <ShieldCheck size={16} />
            <span>Cloud Firestore & Streaming Architecture</span>
          </h3>
          <p>
            <strong className="text-white">AniScroll</strong> combines official Hoshika REST API v1 for catalog metadata, Fanart.tv v3.2 for cinematic artwork and transparent logos, AniList GraphQL for ID matching, AniScroll high-speed HLS video streaming, and AniSkip v2 for opening and ending skip detection.
          </p>
          <p>
            Your account data is protected by strict owner-only Cloud Firestore security rules and synchronized across all signed-in devices.
          </p>
        </div>
      </div>
    </ProtectedRoute>
  );
}
