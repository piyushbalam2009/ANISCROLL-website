'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Settings as SettingsIcon,
  Play,
  Palette,
  CheckCircle2,
  User,
  Shield,
  KeyRound,
  Camera,
  Loader2,
  Copy,
  Check,
  LogOut,
  ExternalLink,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { UserPreferences } from '@/types/streaming';
import {
  getUserPreferences,
  saveUserPreferences,
  DEFAULT_PREFERENCES,
} from '@/lib/storage';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/hooks/useAuth';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { RoleBadge } from '@/components/ui/RoleBadge';
import {
  AnimeAvatarGalleryModal,
  AvatarSelectionPayload,
} from '@/components/profile/AnimeAvatarGalleryModal';
import {
  DEFAULT_PRIVACY_SETTINGS,
  ProfileVisibility,
  UserPrivacySettings,
  validateUsername,
} from '@/lib/profile-privacy';

type SettingsSection = 'profile' | 'appearance' | 'privacy' | 'playback' | 'account';

const SECTIONS: { id: SettingsSection; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'playback', label: 'Playback', icon: Play },
  { id: 'account', label: 'Account', icon: KeyRound },
];

export default function SettingsPage() {
  const router = useRouter();
  const {
    user,
    profile,
    effectiveRole,
    updateUserProfile,
    resetPassword,
    signOutUser,
  } = useAuth();

  const [activeSection, setActiveSection] = useState<SettingsSection>('profile');
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [savedNotification, setSavedNotification] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Profile form state
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);

  // Privacy state
  const [privacy, setPrivacy] = useState<UserPrivacySettings>(
    DEFAULT_PRIVACY_SETTINGS
  );
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  // Account state
  const [copiedUid, setCopiedUid] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);

  const showSaved = (msg: string) => {
    setSavedNotification(msg);
    setTimeout(() => setSavedNotification(null), 2600);
  };

  useEffect(() => {
    setMounted(true);
    setPrefs(getUserPreferences());

    const handleUpdate = () => setPrefs(getUserPreferences());
    window.addEventListener('aniscroll_preferences_updated', handleUpdate);
    return () =>
      window.removeEventListener('aniscroll_preferences_updated', handleUpdate);
  }, []);

  useEffect(() => {
    if (!profile && !user) return;
    setDisplayName(
      profile?.displayName ||
        user?.displayName ||
        user?.email?.split('@')[0] ||
        ''
    );
    setUsername(profile?.username || '');
    setBio(profile?.bio || '');
    setPrivacy(profile?.privacy || DEFAULT_PRIVACY_SETTINGS);
  }, [profile, user]);

  const updatePreference = <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    const updated = saveUserPreferences({ [key]: value });
    setPrefs(updated);
    if (key === 'defaultAudio' && typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem('aniscroll_user_selected_audio_v1');
      } catch {
        // Ignore storage errors
      }
    }
    showSaved('Preferences synced to Cloud');
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);

    if (!displayName.trim()) {
      setProfileError('Display name cannot be empty.');
      return;
    }

    if (username.trim()) {
      const check = validateUsername(username);
      if (!check.valid) {
        setProfileError(check.error || 'Invalid username.');
        return;
      }
    }

    setSavingProfile(true);
    try {
      await updateUserProfile({
        displayName: displayName.trim(),
        username: username.trim() || undefined,
        bio: bio.trim(),
      });
      showSaved('Profile saved');
    } catch (err) {
      setProfileError(
        err instanceof Error ? err.message : 'Unable to save profile.'
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const handleConfirmAvatar = async (selection: AvatarSelectionPayload) => {
    await updateUserProfile({
      photoURL: selection.photoURL,
      avatarCharacterId: selection.avatarCharacterId ?? null,
      avatarCharacterName: selection.avatarCharacterName ?? null,
      avatarAnimeName: selection.avatarAnimeName ?? null,
    });
    showSaved('Anime avatar updated');
  };

  const handlePrivacyUpdate = async (next: UserPrivacySettings) => {
    setPrivacy(next);
    setSavingPrivacy(true);
    try {
      await updateUserProfile({ privacy: next });
      showSaved('Privacy settings saved');
    } catch (err) {
      setProfileError(
        err instanceof Error ? err.message : 'Unable to save privacy settings.'
      );
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleCopyUid = () => {
    if (!user?.uid) return;
    navigator.clipboard.writeText(user.uid).catch(() => {});
    setCopiedUid(true);
    setTimeout(() => setCopiedUid(false), 2000);
  };

  const handlePasswordReset = async () => {
    const email = profile?.email || user?.email;
    if (!email) return;
    setSendingReset(true);
    setResetError(null);
    setResetSent(false);
    try {
      await resetPassword(email);
      setResetSent(true);
    } catch (err) {
      setResetError(
        err instanceof Error ? err.message : 'Unable to send password reset email.'
      );
    } finally {
      setSendingReset(false);
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
    router.push('/');
  };

  const photoURL = profile?.photoURL || user?.photoURL || '';
  const currentEmail = profile?.email || user?.email || '';
  const provider = profile?.provider || 'password';
  const usernamePreview = validateUsername(username);

  return (
    <ProtectedRoute>
      {!mounted ? (
        <div className="space-y-6 max-w-5xl pb-16">
          <div className="h-8 w-48 bg-[#141414] rounded-lg animate-pulse" />
          <div className="space-y-4">
            <div className="h-44 bg-[#141414] rounded-2xl animate-pulse" />
            <div className="h-44 bg-[#141414] rounded-2xl animate-pulse" />
          </div>
        </div>
      ) : (
        <div className="space-y-6 max-w-5xl pb-20">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#292929]">
            <div className="flex items-center gap-3">
              <SettingsIcon size={22} className="text-white" />
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  Settings & Account
                </h1>
                <p className="text-xs text-[#707070]">
                  Customize your AniScroll profile, anime avatar, privacy controls, and playback defaults.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {savedNotification && (
                <div className="flex items-center gap-1.5 text-xs text-black font-bold bg-white px-3 py-1.5 rounded-lg shadow-lg">
                  <CheckCircle2 size={14} />
                  <span>{savedNotification}</span>
                </div>
              )}
              <Link
                href="/profile"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-xs font-medium text-white transition-colors"
              >
                <span>View Profile</span>
                <ExternalLink size={13} />
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Section Navigation */}
            <aside className="lg:col-span-3 flex lg:flex-col gap-1.5 overflow-x-auto no-scrollbar pb-1 lg:pb-0">
              {SECTIONS.map((sec) => {
                const Icon = sec.icon;
                const active = activeSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setActiveSection(sec.id)}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer border ${
                      active
                        ? 'bg-white text-black border-white shadow-sm'
                        : 'bg-[#0A0A0A] text-[#A0A0A0] border-[#292929] hover:text-white hover:border-[#404040]'
                    }`}
                  >
                    <Icon size={15} />
                    <span>{sec.label}</span>
                  </button>
                );
              })}
            </aside>

            {/* Section Content */}
            <div className="lg:col-span-9 space-y-6">
              {/* 1. PROFILE SECTION */}
              {activeSection === 'profile' && (
                <section className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-6">
                  <div className="flex items-center justify-between pb-3 border-b border-[#292929]">
                    <div>
                      <h2 className="text-base font-bold text-white">
                        Public Profile & Avatar
                      </h2>
                      <p className="text-xs text-[#707070] mt-0.5">
                        Manage how your profile appears across AniScroll.
                      </p>
                    </div>
                    <RoleBadge role={effectiveRole} size="sm" />
                  </div>

                  {/* Avatar Picker Row */}
                  <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="relative w-16 h-16 rounded-2xl bg-black border border-white/20 overflow-hidden flex items-center justify-center font-bold text-lg text-white shrink-0">
                        {photoURL ? (
                          <ResilientImage
                            src={photoURL}
                            alt={displayName || 'Avatar'}
                            fill
                            sizes="64px"
                            className="object-cover object-top"
                            fallback={<User size={24} />}
                          />
                        ) : (
                          <User size={24} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white">
                          Profile Picture
                        </div>
                        <div className="text-xs text-[#A0A0A0] truncate">
                          {profile?.avatarCharacterName
                            ? `${profile.avatarCharacterName}${
                                profile.avatarAnimeName
                                  ? ` · ${profile.avatarAnimeName}`
                                  : ''
                              }`
                            : 'Choose from thousands of popular anime characters'}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setAvatarModalOpen(true)}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors cursor-pointer shrink-0"
                    >
                      <Camera size={14} />
                      <span>Choose Anime Avatar</span>
                    </button>
                  </div>

                  {/* Display Name, Username, Bio Form */}
                  <form onSubmit={handleSaveProfile} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-white mb-1.5">
                          Display Name
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={120}
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          className="w-full h-10 px-3.5 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-sm text-white focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-white mb-1.5">
                          Unique @username
                        </label>
                        <div className="relative">
                          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-[#707070]">
                            @
                          </span>
                          <input
                            type="text"
                            maxLength={24}
                            value={username}
                            onChange={(e) =>
                              setUsername(
                                e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')
                              )
                            }
                            placeholder="your_handle"
                            className="w-full h-10 pl-8 pr-3.5 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-sm font-mono text-white focus:outline-none"
                          />
                        </div>
                        {username && !usernamePreview.valid && (
                          <p className="text-[11px] text-[#A0A0A0] mt-1">
                            {usernamePreview.error}
                          </p>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-semibold text-white">
                          Bio
                        </label>
                        <span className="text-[11px] font-mono text-[#707070]">
                          {bio.length}/300
                        </span>
                      </div>
                      <textarea
                        rows={3}
                        maxLength={300}
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder="Share what anime you're watching or your favourite series..."
                        className="w-full p-3.5 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-sm text-white placeholder-[#707070] focus:outline-none resize-none"
                      />
                    </div>

                    {profileError && (
                      <div className="p-3 rounded-xl bg-[#141414] border border-white/30 text-xs text-white flex items-center gap-2">
                        <AlertCircle size={15} />
                        <span>{profileError}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                      {profile?.username && (
                        <Link
                          href={`/profile/${profile.username}`}
                          className="text-xs text-[#A0A0A0] hover:text-white underline inline-flex items-center gap-1"
                        >
                          <span>Public link: /profile/{profile.username}</span>
                          <ExternalLink size={12} />
                        </Link>
                      )}
                      <button
                        type="submit"
                        disabled={savingProfile}
                        className="px-5 py-2.5 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ml-auto"
                      >
                        {savingProfile ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            <span>Saving Profile...</span>
                          </>
                        ) : (
                          <span>Save Profile Changes</span>
                        )}
                      </button>
                    </div>
                  </form>
                </section>
              )}

              {/* 2. APPEARANCE SECTION */}
              {activeSection === 'appearance' && (
                <section className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-6">
                  <div className="flex items-center gap-2 pb-3 border-b border-[#292929]">
                    <Palette size={18} className="text-white" />
                    <h2 className="text-base font-bold text-white">
                      Appearance & Interface
                    </h2>
                  </div>

                  <div className="space-y-4 divide-y divide-[#292929]">
                    <div className="flex items-center justify-between pt-2 first:pt-0">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          Sidebar Navigation Mode
                        </div>
                        <div className="text-xs text-[#707070] mt-0.5">
                          Expand labels or collapse sidebar to compact icon-only rail.
                        </div>
                      </div>
                      <div className="flex items-center bg-[#141414] border border-[#292929] rounded-lg p-0.5">
                        <button
                          type="button"
                          onClick={() => updatePreference('sidebarCollapsed', false)}
                          className={`px-3 py-1.5 text-xs rounded font-medium transition-colors cursor-pointer ${
                            !prefs.sidebarCollapsed
                              ? 'bg-white text-black font-semibold'
                              : 'text-[#A0A0A0] hover:text-white'
                          }`}
                        >
                          Expanded
                        </button>
                        <button
                          type="button"
                          onClick={() => updatePreference('sidebarCollapsed', true)}
                          className={`px-3 py-1.5 text-xs rounded font-medium transition-colors cursor-pointer ${
                            prefs.sidebarCollapsed
                              ? 'bg-white text-black font-semibold'
                              : 'text-[#A0A0A0] hover:text-white'
                          }`}
                        >
                          Collapsed
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-4">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          Anime Card Density
                        </div>
                        <div className="text-xs text-[#707070] mt-0.5">
                          Switch between standard spacious cards or compact grids.
                        </div>
                      </div>
                      <div className="flex items-center bg-[#141414] border border-[#292929] rounded-lg p-0.5">
                        <button
                          type="button"
                          onClick={() => updatePreference('compactCards', false)}
                          className={`px-3 py-1.5 text-xs rounded font-medium transition-colors cursor-pointer ${
                            !prefs.compactCards
                              ? 'bg-white text-black font-semibold'
                              : 'text-[#A0A0A0] hover:text-white'
                          }`}
                        >
                          Standard
                        </button>
                        <button
                          type="button"
                          onClick={() => updatePreference('compactCards', true)}
                          className={`px-3 py-1.5 text-xs rounded font-medium transition-colors cursor-pointer ${
                            prefs.compactCards
                              ? 'bg-white text-black font-semibold'
                              : 'text-[#A0A0A0] hover:text-white'
                          }`}
                        >
                          Compact
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-4">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          Color Theme
                        </div>
                        <div className="text-xs text-[#707070] mt-0.5">
                          AniScroll signature pure monochrome black & white aesthetic.
                        </div>
                      </div>
                      <span className="text-xs font-mono text-white bg-[#141414] border border-[#292929] px-3 py-1.5 rounded-lg">
                        Pure Monochrome
                      </span>
                    </div>
                  </div>
                </section>
              )}

              {/* 3. PRIVACY SECTION */}
              {activeSection === 'privacy' && (
                <section className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-6">
                  <div className="flex items-center justify-between pb-3 border-b border-[#292929]">
                    <div className="flex items-center gap-2">
                      <Shield size={18} className="text-white" />
                      <div>
                        <h2 className="text-base font-bold text-white">
                          Profile Visibility & Privacy
                        </h2>
                        <p className="text-xs text-[#707070] mt-0.5">
                          Control who can view your profile, statistics, watchlist, and activity.
                        </p>
                      </div>
                    </div>
                    {savingPrivacy && (
                      <Loader2 size={16} className="animate-spin text-white" />
                    )}
                  </div>

                  <div className="space-y-5">
                    <div>
                      <div className="text-sm font-semibold text-white mb-2">
                        Who Can View Your Profile
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {(
                          [
                            {
                              id: 'public',
                              label: 'Public',
                              desc: 'Anyone can view your profile & stats.',
                            },
                            {
                              id: 'members',
                              label: 'Members Only',
                              desc: 'Only signed-in AniScroll accounts.',
                            },
                            {
                              id: 'private',
                              label: 'Private',
                              desc: 'Hidden from directory & public links.',
                            },
                          ] as { id: ProfileVisibility; label: string; desc: string }[]
                        ).map((opt) => {
                          const active = privacy.profileVisibility === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() =>
                                handlePrivacyUpdate({
                                  ...privacy,
                                  profileVisibility: opt.id,
                                })
                              }
                              className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                                active
                                  ? 'bg-white text-black border-white'
                                  : 'bg-[#141414] text-white border-[#292929] hover:border-white/40'
                              }`}
                            >
                              <div className="text-xs font-bold flex items-center justify-between">
                                <span>{opt.label}</span>
                                {opt.id === 'private' && <Lock size={12} />}
                              </div>
                              <div
                                className={`text-[11px] mt-1 ${
                                  active ? 'text-black/75' : 'text-[#707070]'
                                }`}
                              >
                                {opt.desc}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-4 divide-y divide-[#292929] pt-2">
                      <div className="flex items-center justify-between pt-3 first:pt-0">
                        <div>
                          <div className="text-sm font-semibold text-white">
                            Show Watch History
                          </div>
                          <div className="text-xs text-[#707070] mt-0.5">
                            Display recently watched episodes on your public profile.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handlePrivacyUpdate({
                              ...privacy,
                              showWatchHistory: !privacy.showWatchHistory,
                            })
                          }
                          className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                            privacy.showWatchHistory
                              ? 'bg-white justify-end'
                              : 'bg-[#292929] justify-start'
                          }`}
                          aria-label="Toggle show watch history"
                        >
                          <div
                            className={`w-4 h-4 rounded-full ${
                              privacy.showWatchHistory ? 'bg-black' : 'bg-[#707070]'
                            }`}
                          />
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-4">
                        <div>
                          <div className="text-sm font-semibold text-white">
                            Show Watchlist & Favourite Anime
                          </div>
                          <div className="text-xs text-[#707070] mt-0.5">
                            Allow visitors to see your pinned favourites and watchlist totals.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handlePrivacyUpdate({
                              ...privacy,
                              showWatchlist: !privacy.showWatchlist,
                            })
                          }
                          className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                            privacy.showWatchlist
                              ? 'bg-white justify-end'
                              : 'bg-[#292929] justify-start'
                          }`}
                          aria-label="Toggle show watchlist"
                        >
                          <div
                            className={`w-4 h-4 rounded-full ${
                              privacy.showWatchlist ? 'bg-black' : 'bg-[#707070]'
                            }`}
                          />
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-4">
                        <div>
                          <div className="text-sm font-semibold text-white">
                            Show Watch Activity & Episode Count
                          </div>
                          <div className="text-xs text-[#707070] mt-0.5">
                            Share episode counts and recent streaming activity on your profile.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handlePrivacyUpdate({
                              ...privacy,
                              showActivity: !privacy.showActivity,
                            })
                          }
                          className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                            privacy.showActivity
                              ? 'bg-white justify-end'
                              : 'bg-[#292929] justify-start'
                          }`}
                          aria-label="Toggle show activity"
                        >
                          <div
                            className={`w-4 h-4 rounded-full ${
                              privacy.showActivity ? 'bg-black' : 'bg-[#707070]'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* 4. PLAYBACK SECTION */}
              {activeSection === 'playback' && (
                <section className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-6">
                  <div className="flex items-center gap-2 pb-3 border-b border-[#292929]">
                    <Play size={18} className="text-white" />
                    <h2 className="text-base font-bold text-white">
                      Video Player & AniSkip Playback
                    </h2>
                  </div>

                  <div className="space-y-4 divide-y divide-[#292929]">
                    {/* Default Audio */}
                    <div className="flex items-center justify-between pt-2 first:pt-0">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          Default Audio Mode
                        </div>
                        <div className="text-xs text-[#707070] mt-0.5">
                          Preferred audio track when both Sub and Dub streams exist.
                        </div>
                      </div>
                      <div className="flex items-center bg-[#141414] border border-[#292929] rounded-lg p-0.5">
                        <button
                          type="button"
                          data-testid="settings-default-audio-sub"
                          aria-pressed={prefs.defaultAudio === 'sub'}
                          onClick={() => updatePreference('defaultAudio', 'sub')}
                          className={`px-3 py-1 text-xs rounded font-medium transition-colors cursor-pointer ${
                            prefs.defaultAudio === 'sub'
                              ? 'bg-white text-black font-semibold'
                              : 'text-[#A0A0A0] hover:text-white'
                          }`}
                        >
                          SUB
                        </button>
                        <button
                          type="button"
                          data-testid="settings-default-audio-dub"
                          aria-pressed={prefs.defaultAudio === 'dub'}
                          onClick={() => updatePreference('defaultAudio', 'dub')}
                          className={`px-3 py-1 text-xs rounded font-medium transition-colors cursor-pointer ${
                            prefs.defaultAudio === 'dub'
                              ? 'bg-white text-black font-semibold'
                              : 'text-[#A0A0A0] hover:text-white'
                          }`}
                        >
                          DUB
                        </button>
                      </div>
                    </div>

                    {/* Default Quality */}
                    <div className="flex items-center justify-between pt-4">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          Default Video Quality
                        </div>
                        <div className="text-xs text-[#707070] mt-0.5">
                          Preferred HLS resolution when starting an episode.
                        </div>
                      </div>
                      <div className="flex items-center bg-[#141414] border border-[#292929] rounded-lg p-0.5">
                        {(['auto', '1080p', '720p', '480p'] as const).map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => updatePreference('defaultQuality', q)}
                            className={`px-2.5 py-1 text-xs rounded font-mono uppercase transition-colors cursor-pointer ${
                              prefs.defaultQuality === q
                                ? 'bg-white text-black font-bold'
                                : 'text-[#A0A0A0] hover:text-white'
                            }`}
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Auto-Play Next */}
                    <div className="flex items-center justify-between pt-4">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          Auto-Play Next Episode
                        </div>
                        <div className="text-xs text-[#707070] mt-0.5">
                          Automatically transition to the next episode when current finishes.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          updatePreference('autoPlayNext', !prefs.autoPlayNext)
                        }
                        className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                          prefs.autoPlayNext
                            ? 'bg-white justify-end'
                            : 'bg-[#292929] justify-start'
                        }`}
                        aria-label="Toggle auto-play next episode"
                      >
                        <div
                          className={`w-4 h-4 rounded-full ${
                            prefs.autoPlayNext ? 'bg-black' : 'bg-[#707070]'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Auto-Skip Intro */}
                    <div className="flex items-center justify-between pt-4">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          Auto-Skip Opening Theme (AniSkip)
                        </div>
                        <div className="text-xs text-[#707070] mt-0.5">
                          Jump past opening sequences automatically when AniSkip timestamps exist.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          updatePreference('autoSkipIntro', !prefs.autoSkipIntro)
                        }
                        className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                          prefs.autoSkipIntro
                            ? 'bg-white justify-end'
                            : 'bg-[#292929] justify-start'
                        }`}
                        aria-label="Toggle auto-skip opening"
                      >
                        <div
                          className={`w-4 h-4 rounded-full ${
                            prefs.autoSkipIntro ? 'bg-black' : 'bg-[#707070]'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Auto-Skip Outro */}
                    <div className="flex items-center justify-between pt-4">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          Auto-Skip Ending Theme (AniSkip)
                        </div>
                        <div className="text-xs text-[#707070] mt-0.5">
                          Jump past ending credits automatically when AniSkip timestamps exist.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          updatePreference('autoSkipOutro', !prefs.autoSkipOutro)
                        }
                        className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                          prefs.autoSkipOutro
                            ? 'bg-white justify-end'
                            : 'bg-[#292929] justify-start'
                        }`}
                        aria-label="Toggle auto-skip ending"
                      >
                        <div
                          className={`w-4 h-4 rounded-full ${
                            prefs.autoSkipOutro ? 'bg-black' : 'bg-[#707070]'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {/* 5. ACCOUNT SECTION */}
              {activeSection === 'account' && (
                <section className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-6">
                  <div className="flex items-center justify-between pb-3 border-b border-[#292929]">
                    <div className="flex items-center gap-2">
                      <KeyRound size={18} className="text-white" />
                      <h2 className="text-base font-bold text-white">
                        Account & Security
                      </h2>
                    </div>
                    <RoleBadge role={effectiveRole} size="sm" />
                  </div>

                  <div className="space-y-4 divide-y divide-[#292929]">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 first:pt-0">
                      <div>
                        <div className="text-xs font-mono uppercase text-[#707070]">
                          Account Email
                        </div>
                        <div className="text-sm font-semibold text-white mt-0.5">
                          {currentEmail}
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-[#141414] border border-[#292929] text-[11px] font-mono uppercase text-[#A0A0A0] self-start sm:self-center">
                        {provider === 'google' ? 'Google OAuth' : 'Email & Password'}
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-4">
                      <div className="min-w-0">
                        <div className="text-xs font-mono uppercase text-[#707070]">
                          User ID
                        </div>
                        <div className="text-xs font-mono text-[#A0A0A0] truncate mt-0.5">
                          {user?.uid}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyUid}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-xs text-white transition-colors cursor-pointer self-start sm:self-center"
                      >
                        {copiedUid ? <Check size={13} /> : <Copy size={13} />}
                        <span>{copiedUid ? 'Copied UID' : 'Copy UID'}</span>
                      </button>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          Password Reset
                        </div>
                        <div className="text-xs text-[#707070] mt-0.5">
                          {provider === 'google'
                            ? 'Your account signs in via Google OAuth. Manage your password in Google Account settings.'
                            : 'Send a secure Firebase password reset link to your email address.'}
                        </div>
                      </div>
                      {provider !== 'google' && (
                        <button
                          type="button"
                          onClick={handlePasswordReset}
                          disabled={sendingReset}
                          className="px-4 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                        >
                          {sendingReset
                            ? 'Sending...'
                            : 'Send Password Reset Email'}
                        </button>
                      )}
                    </div>

                    {resetSent && (
                      <div className="pt-4">
                        <div className="p-3 rounded-xl bg-[#141414] border border-white/30 text-xs text-white flex items-center gap-2">
                          <CheckCircle2 size={15} />
                          <span>
                            Password reset email sent to {currentEmail}. Check your inbox.
                          </span>
                        </div>
                      </div>
                    )}

                    {resetError && (
                      <div className="pt-4">
                        <div className="p-3 rounded-xl bg-[#141414] border border-white/30 text-xs text-white flex items-center gap-2">
                          <AlertCircle size={15} />
                          <span>{resetError}</span>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-4">
                      <div>
                        <div className="text-sm font-semibold text-white">
                          Sign Out
                        </div>
                        <div className="text-xs text-[#707070] mt-0.5">
                          End your active AniScroll session on this browser.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors cursor-pointer"
                      >
                        <LogOut size={14} />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>

          <AnimeAvatarGalleryModal
            isOpen={avatarModalOpen}
            onClose={() => setAvatarModalOpen(false)}
            currentPhotoURL={photoURL}
            onConfirmAvatar={handleConfirmAvatar}
          />
        </div>
      )}
    </ProtectedRoute>
  );
}
