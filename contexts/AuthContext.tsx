'use client';

import React, { createContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, updateProfile, User } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import {
  CloudUserProfile,
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

export interface AuthContextValue {
  user: User | null;
  profile: CloudUserProfile | null;
  adminRecord: AdminRecord | null;
  isAdmin: boolean;
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

  const refreshAdminRecord = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setAdminRecord(null);
      return;
    }
    const resolved = await resolveClientAdminRecord(currentUser);
    setAdminRecord(resolved);
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

        if (isMounted) {
          setProfile(cloudProfile);
          setAdminRecord(resolvedAdmin);
          setAdminLoading(false);
        }

        await migrateLocalDataToFirestore(firebaseUser.uid, cloudProfile);

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

  const updateUserDisplayName = useCallback(
    async (displayName: string) => {
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      const cleanName = displayName.trim();
      if (!cleanName) return;

      await updateProfile(currentUser, { displayName: cleanName });
      const isGoogle = currentUser.providerData.some(
        (p) => p.providerId === 'google.com'
      );
      const updatedProfile = await upsertUserProfileDoc({
        uid: currentUser.uid,
        displayName: cleanName,
        email: currentUser.email || 'user@aniscroll.app',
        photoURL: currentUser.photoURL || '',
        provider: isGoogle ? 'google' : 'password',
      });
      setProfile(updatedProfile);
    },
    []
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        adminRecord,
        isAdmin: Boolean(adminRecord && adminRecord.status === 'active'),
        loading,
        adminLoading,
        signUpWithEmail,
        signInWithEmail,
        signInWithGoogle,
        resetPassword,
        signOutUser,
        updateUserDisplayName,
        refreshAdminRecord,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
