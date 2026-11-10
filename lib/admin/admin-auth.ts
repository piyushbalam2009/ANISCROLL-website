import { User } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import {
  AdminRecord,
  AdminPermissions,
  DEFAULT_ROLE_PERMISSIONS,
  buildOwnerAdminRecord,
  hasAdminPermission,
  isBootstrappedOwnerIdentity,
} from './admin-permissions';

/**
  * Resolves the AdminRecord for a Firebase Auth user.
  * Automatically bootstraps the Owner record in /admins/{uid} when the primary owner
  * (balampiyush2009@gmail.com) logs in via Google or Email/Password.
  */
export async function resolveClientAdminRecord(user: User | null): Promise<AdminRecord | null> {
  if (!user) return null;

  const email = (user.email || '').trim().toLowerCase();
  const isBootstrapOwner = isBootstrappedOwnerIdentity(user.uid, email);
  const adminRef = doc(db, 'admins', user.uid);

  try {
    const snap = await getDoc(adminRef);
    const nowIso = new Date().toISOString();

    if (snap.exists()) {
      const data = snap.data() as AdminRecord;
      if (data.status !== 'active' && !isBootstrapOwner) {
        return null;
      }

      // Update lastLogin timestamp silently if owner or active admin
      try {
        if (isBootstrapOwner && data.role === 'owner') {
          await updateDoc(adminRef, {
            lastLogin: nowIso,
            updatedAt: serverTimestamp(),
          });
        }
      } catch {
        // Non-fatal if update is skipped
      }

      return {
        ...data,
        role: isBootstrapOwner ? 'owner' : data.role,
        permissions: isBootstrapOwner
          ? { ...DEFAULT_ROLE_PERMISSIONS.owner }
          : data.permissions || DEFAULT_ROLE_PERMISSIONS[data.role] || DEFAULT_ROLE_PERMISSIONS.analyst,
        status: 'active',
      };
    }

    // If not yet in /admins/{uid}, bootstrap the primary Owner record
    if (isBootstrapOwner) {
      const ownerRecord = buildOwnerAdminRecord(user.uid, email, user.displayName);
      try {
        await setDoc(adminRef, {
          ...ownerRecord,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn('Owner record bootstrap write warning (granting owner access anyway):', err);
      }
      return ownerRecord;
    }

    // Verify via server API for invited or secondary admins
    const token = await user.getIdToken();
    const res = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      return null;
    }

    const payload = await res.json();
    return payload.admin || null;
  } catch (error) {
    if (isBootstrapOwner) {
      return buildOwnerAdminRecord(user.uid, email, user.displayName);
    }
    console.error('Failed to resolve admin record:', error);
    return null;
  }
}

export async function getAdminAuthHeaders(): Promise<Record<string, string>> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { 'Content-Type': 'application/json' };
  }
  const token = await currentUser.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export { hasAdminPermission };
export type { AdminRecord, AdminPermissions };
