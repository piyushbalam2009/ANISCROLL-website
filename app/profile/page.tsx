'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useWatchHistory } from '@/hooks/useWatchHistory';
import { toPublicUserProfile } from '@/lib/profile-privacy';
import { ProfileView } from '@/components/profile/ProfileView';
import {
  AnimeAvatarGalleryModal,
  AvatarSelectionPayload,
} from '@/components/profile/AnimeAvatarGalleryModal';
import { CheckCircle2 } from 'lucide-react';

export default function ProfilePage() {
  const router = useRouter();
  const {
    user,
    profile,
    effectiveRole,
    signOutUser,
    updateUserProfile,
  } = useAuth();
  const { watchlist, mounted: watchlistMounted } = useWatchlist();
  const { history, mounted: historyMounted } = useWatchHistory();

  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const publicViewProfile = useMemo(() => {
    return toPublicUserProfile(
      {
        uid: profile?.uid || user?.uid || 'member',
        displayName:
          profile?.displayName ||
          user?.displayName ||
          user?.email?.split('@')[0] ||
          'AniScroll Member',
        username: profile?.username,
        bio: profile?.bio || '',
        email: profile?.email || user?.email || '',
        photoURL: profile?.photoURL || user?.photoURL || '',
        avatarCharacterId: profile?.avatarCharacterId ?? null,
        avatarCharacterName: profile?.avatarCharacterName ?? null,
        avatarAnimeName: profile?.avatarAnimeName ?? null,
        role: effectiveRole,
        status: profile?.status || 'active',
        privacy: profile?.privacy,
        favouriteAnime: profile?.favouriteAnime || [],
        stats: profile?.stats,
        recentActivity: profile?.recentActivity || [],
        createdAt: profile?.createdAt || user?.metadata?.creationTime,
      },
      effectiveRole
    );
  }, [profile, user, effectiveRole]);

  const handleConfirmAvatar = async (selection: AvatarSelectionPayload) => {
    await updateUserProfile({
      photoURL: selection.photoURL,
      avatarCharacterId: selection.avatarCharacterId ?? null,
      avatarCharacterName: selection.avatarCharacterName ?? null,
      avatarAnimeName: selection.avatarAnimeName ?? null,
    });
    showToast(
      selection.avatarCharacterName
        ? `Avatar updated to ${selection.avatarCharacterName}.`
        : 'Profile picture updated.'
    );
  };

  const handleUpdateProfile = async (patch: {
    displayName?: string;
    bio?: string;
    favouriteAnime?: typeof publicViewProfile.favouriteAnime;
  }) => {
    await updateUserProfile(patch);
    showToast('Profile updated.');
  };

  const handleSignOut = async () => {
    await signOutUser();
    router.push('/');
  };

  return (
    <ProtectedRoute>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-white text-black font-bold text-xs shadow-2xl flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>{toast}</span>
        </div>
      )}

      <ProfileView
        profile={publicViewProfile}
        isOwnProfile
        email={profile?.email || user?.email || ''}
        provider={profile?.provider || 'password'}
        liveWatchlist={watchlistMounted ? watchlist : undefined}
        liveHistory={historyMounted ? history : undefined}
        onOpenAvatarModal={() => setAvatarModalOpen(true)}
        onUpdateProfile={handleUpdateProfile}
        onSignOut={handleSignOut}
      />

      <AnimeAvatarGalleryModal
        isOpen={avatarModalOpen}
        onClose={() => setAvatarModalOpen(false)}
        currentPhotoURL={publicViewProfile.photoURL}
        onConfirmAvatar={handleConfirmAvatar}
      />
    </ProtectedRoute>
  );
}
