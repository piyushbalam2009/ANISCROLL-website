'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { onAuthStateChanged, updateProfile, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import {
  CloudUserProfile,
  ensurePublicProfileSync,
  getUserProfileDoc,
  syncUserActivityProjection,
  upsertUserProfileDoc,
} from '@/lib/firestore';
import {
  registerWithEmail,
  loginWithEmail,
  loginWithGoogle,
  sendPasswordReset,
  logoutUser,
} from '@/lib/auth';
import {
  buildPublicActivityProjection,
  migrateLocalDataToFirestore,
  subscribeToUserCloudData,
} from '@/lib/sync';
import {
  AdminRecord,
  resolveClientAdminRecord,
} from '@/lib/admin/admin-auth';
import {
  buildOwnerAdminRecord,
  isBootstrappedOwnerIdentity,
} from '@/lib/admin/admin-permissions';
import { resolveEffectiveUserRole, UserRole } from '@/lib/roles';
import { FavouriteAnimeItem, UserPrivacySettings } from '@/lib/profile-privacy';
import { getWatchHistory, getWatchlist } from '@/lib/storage';

export interface ProfileUpdatePatch {
  displayName?: string;
  username?: string;
  bio?: string;
  photoURL?: string;
  avatarCharacterId?: number | null;
  avatarCharacterName?: string | null;
  avatarAnimeName?: string | null;
  privacy?: UserPrivacySettings;
  favouriteAnime?: FavouriteAnimeItem[];
}

export interface AuthContextValue {
  user: User | null;
  profile: CloudUserProfile | null;
  adminRecord: AdminRecord | null;
  effectiveRole: UserRole;
  isAdmin: boolean;
  isModerator: boolean;
  loading: boolean;
  adminLoading: boolean;
  signUpWithEmail: (
    displayName: string,
    email: string,
    password: string
  ) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  updateUserDisplayName: (displayName: string) => Promise<void>;
  updateUserProfile: (patch: ProfileUpdatePatch) => Promise<CloudUserProfile>;
  refreshProfile: () => Promise<void>;
  refreshAdminRecord: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined
);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<CloudUserProfile | null>(null);
  const [adminRecord, setAdminRecord] = useState<AdminRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [adminLoading, setAdminLoading] = useState<boolean>(true);

  const effectiveRole: UserRole = useMemo(
    () =>
      resolveEffectiveUserRole({
        uid: user?.uid || profile?.uid,
        email: user?.email || profile?.email,
        profileRole: profile?.role,
        adminRecord,
      }),
    [user?.uid, user?.email, profile?.uid, profile?.email, profile?.role, adminRecord]
  );

  const refreshAdminRecord = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setAdminRecord(null);
      return;
    }
    const resolved = await resolveClientAdminRecord(currentUser);
    setAdminRecord(resolved);
  }, []);

  const refreshProfile = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setProfile(null);
      return;
    }
    const fresh = await getUserProfileDoc(currentUser.uid).catch(() => null);
    if (fresh) {
      setProfile(fresh);
    }
  }, []);

  useEffect(() => {
    let unsubCloudData: (() => void) | null = null;
    let isMounted = true;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (unsubCloudData) {
        unsubCloudData();
        unsubCloudData = null;
      }

      if (!firebaseUser) {
        if (isMounted) {
          setUser(null);
          setProfile(null);
          setAdminRecord(null);
          setLoading(false);
          setAdminLoading(false);
        }
        return;
      }

      if (isMounted) {
        setUser(firebaseUser);
        if (isBootstrappedOwnerIdentity(firebaseUser.uid, firebaseUser.email)) {
          setAdminRecord(
            buildOwnerAdminRecord(
              firebaseUser.uid,
              firebaseUser.email || 'balampiyush2009@gmail.com',
              firebaseUser.displayName
            )
          );
          setAdminLoading(false);
        } else {
          setAdminLoading(true);
        }
      }

      try {
        const isGoogle = firebaseUser.providerData.some(
          (p) => p.providerId === 'google.com'
        );

        const [cloudProfile, resolvedAdmin] = await Promise.all([
          upsertUserProfileDoc({
            uid: firebaseUser.uid,
            displayName:
              firebaseUser.displayName ||
              firebaseUser.email?.split('@')[0] ||
              'AniScroll Member',
            email: firebaseUser.email || 'user@aniscroll.app',
            photoURL: firebaseUser.photoURL || '',
            provider: isGoogle ? 'google' : 'password',
          }),
          resolveClientAdminRecord(firebaseUser),
        ]);

        const computedRole = resolveEffectiveUserRole({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          profileRole: cloudProfile.role,
          adminRecord: resolvedAdmin,
        });

        await ensurePublicProfileSync(cloudProfile, computedRole);

        if (isMounted) {
          setProfile({ ...cloudProfile, role: computedRole });
          setAdminRecord(resolvedAdmin);
          setAdminLoading(false);
        }

        await migrateLocalDataToFirestore(firebaseUser.uid, cloudProfile);

        // Project initial watchlist/history stats into publicProfiles
        const proj = buildPublicActivityProjection(
          getWatchlist(),
          getWatchHistory()
        );
        syncUserActivityProjection({
          uid: firebaseUser.uid,
          ...proj,
        }).catch(() => {});

        if (isMounted) {
          unsubCloudData = subscribeToUserCloudData(firebaseUser.uid);
        }
      } catch (err) {
        console.error('Error initializing cloud user session:', err);
        if (isMounted) {
          setAdminLoading(false);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribeAuth();
      if (unsubCloudData) {
        unsubCloudData();
      }
    };
  }, []);

  // Keep public activity stats updated when watchlist or watch history updates
  useEffect(() => {
    if (!user?.uid) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleSync = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const proj = buildPublicActivityProjection(
          getWatchlist(),
          getWatchHistory()
        );
        syncUserActivityProjection({
          uid: user.uid,
          ...proj,
        }).catch(() => {});
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                stats: proj.stats,
                recentActivity: proj.recentActivity,
              }
            : prev
        );
      }, 1200);
    };

    window.addEventListener('aniscroll_watchlist_updated', scheduleSync);
    window.addEventListener('aniscroll_history_updated', scheduleSync);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('aniscroll_watchlist_updated', scheduleSync);
      window.removeEventListener('aniscroll_history_updated', scheduleSync);
    };
  }, [user?.uid]);

  const signUpWithEmail = useCallback(
    async (displayName: string, email: string, password: string) => {
      const { user: newUser, profile: newProfile } = await registerWithEmail(
        displayName,
        email,
        password
      );
      setUser(newUser);
      setProfile(newProfile);
      const resolvedAdmin = await resolveClientAdminRecord(newUser);
      setAdminRecord(resolvedAdmin);
    },
    []
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      const { user: loggedInUser, profile: userProfile } = await loginWithEmail(
        email,
        password
      );
      setUser(loggedInUser);
      setProfile(userProfile);
      const resolvedAdmin = await resolveClientAdminRecord(loggedInUser);
      setAdminRecord(resolvedAdmin);
    },
    []
  );

  const signInWithGoogle = useCallback(async () => {
    const { user: googleUser, profile: userProfile } = await loginWithGoogle();
    setUser(googleUser);
    setProfile(userProfile);
    const resolvedAdmin = await resolveClientAdminRecord(googleUser);
    setAdminRecord(resolvedAdmin);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordReset(email);
  }, []);

  const signOutUser = useCallback(async () => {
    await logoutUser();
    setUser(null);
    setProfile(null);
    setAdminRecord(null);
  }, []);

  const updateUserProfile = useCallback(
    async (patch: ProfileUpdatePatch): Promise<CloudUserProfile> => {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Authentication required to update profile.');
      }

      const token = await currentUser.getIdToken();
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.profile) {
        throw new Error(data?.error || 'Failed to update profile.');
      }

      // Sync Firebase Auth profile displayName/photoURL when applicable
      const authPatch: { displayName?: string; photoURL?: string } = {};
      if (patch.displayName && data.profile.displayName) {
        authPatch.displayName = data.profile.displayName;
      }
      if (patch.photoURL !== undefined) {
        authPatch.photoURL = data.profile.photoURL || '';
      }
      if (Object.keys(authPatch).length > 0) {
        await updateProfile(currentUser, authPatch).catch(() => {});
      }

      const updated: CloudUserProfile = data.profile;
      setProfile(updated);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('aniscroll_profile_updated', { detail: updated })
        );
      }
      return updated;
    },
    []
  );

  const updateUserDisplayName = useCallback(
    async (displayName: string) => {
      const cleanName = displayName.trim();
      if (!cleanName) return;
      await updateUserProfile({ displayName: cleanName });
    },
    [updateUserProfile]
  );

  const isAdmin = Boolean(
    adminRecord &&
      adminRecord.status === 'active' &&
      (effectiveRole === 'owner' ||
        effectiveRole === 'admin' ||
        effectiveRole === 'mod')
  );
  const isModerator =
    effectiveRole === 'mod' ||
    effectiveRole === 'admin' ||
    effectiveRole === 'owner';

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        adminRecord,
        effectiveRole,
        isAdmin,
        isModerator,
        loading,
        adminLoading,
        signUpWithEmail,
        signInWithEmail,
        signInWithGoogle,
        resetPassword,
        signOutUser,
        updateUserDisplayName,
        updateUserProfile,
        refreshProfile,
        refreshAdminRecord,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

