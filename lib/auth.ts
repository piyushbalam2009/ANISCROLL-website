import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import {
  upsertUserProfileDoc,
  CloudUserProfile,
} from './firestore';

export function formatAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code || '';
  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email address already exists.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Invalid email or password. Please check your credentials and try again.';
    case 'auth/too-many-requests':
      return 'Too many unsuccessful attempts. Please wait a moment and try again.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in popup was closed before completing authentication.';
    case 'auth/cancelled-popup-request':
      return 'Another sign-in popup is already open.';
    case 'auth/popup-blocked':
      return 'Sign-in popup was blocked by your browser. Please allow popups for this site.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled in the Firebase Console yet. Enable it under Authentication > Sign-in method.';
    case 'auth/network-request-failed':
      return 'Network error occurred. Please check your internet connection.';
    default:
      if (error instanceof Error && error.message) {
        return error.message;
      }
      return 'Authentication failed. Please try again.';
  }
}

export async function registerWithEmail(
  displayName: string,
  email: string,
  password: string
): Promise<{ user: User; profile: CloudUserProfile }> {
  const cleanName = displayName.trim() || email.split('@')[0] || 'AniScroll Member';
  const cleanEmail = email.trim();

  const credential = await createUserWithEmailAndPassword(
    auth,
    cleanEmail,
    password
  );
  await updateProfile(credential.user, { displayName: cleanName });

  const profile = await upsertUserProfileDoc({
    uid: credential.user.uid,
    displayName: cleanName,
    email: credential.user.email || cleanEmail,
    photoURL: credential.user.photoURL || '',
    provider: 'password',
    migrationCompleted: false,
  });

  return { user: credential.user, profile };
}

export async function loginWithEmail(
  email: string,
  password: string
): Promise<{ user: User; profile: CloudUserProfile }> {
  const cleanEmail = email.trim();
  const credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
  const u = credential.user;

  const profile = await upsertUserProfileDoc({
    uid: u.uid,
    displayName: u.displayName || u.email?.split('@')[0] || 'AniScroll Member',
    email: u.email || cleanEmail,
    photoURL: u.photoURL || '',
    provider: 'password',
  });

  return { user: u, profile };
}

export async function loginWithGoogle(): Promise<{
  user: User;
  profile: CloudUserProfile;
}> {
  const credential = await signInWithPopup(auth, googleProvider);
  const u = credential.user;

  const profile = await upsertUserProfileDoc({
    uid: u.uid,
    displayName: u.displayName || u.email?.split('@')[0] || 'AniScroll Member',
    email: u.email || 'user@aniscroll.app',
    photoURL: u.photoURL || '',
    provider: 'google',
  });

  return { user: u, profile };
}

export async function sendPasswordReset(email: string): Promise<void> {
  const cleanEmail = email.trim();
  await sendPasswordResetEmail(auth, cleanEmail);
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}
