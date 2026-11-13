'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Users,
  Search,
  Ban,
  CheckCircle2,
  Trash2,
  ShieldAlert,
  Loader2,
  RefreshCw,
  UserCheck,
  User,
  ExternalLink,
  Shield,
  X,
  AlertTriangle,
  Eye,
  Bookmark,
  History,
  Flag,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getAdminAuthHeaders, hasAdminPermission } from '@/lib/admin/admin-auth';
import {
  BOOTSTRAPPED_OWNER_EMAIL,
  BOOTSTRAPPED_OWNER_UID,
} from '@/lib/admin/admin-permissions';
import {
  AdminManagedUserRecord,
  listManagedUsers,
} from '@/lib/admin/admin-firestore';
import {
  ROLE_DEFINITIONS,
  USER_ROLE_RANK,
  UserRole,
  canActorAssignRole,
  canActorModerateUser,
  getAssignableRolesForActor,
  normalizeUserRole,
  resolveEffectiveUserRole,
} from '@/lib/roles';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { AdminPagination } from '@/components/admin/ui/AdminPagination';
import { AdminConfirmModal } from '@/components/admin/ui/AdminConfirmModal';

interface ManagedUserRow extends AdminManagedUserRecord {
  role: UserRole;
  joinedDateLabel: string;
}

interface UserDetailPayload {
  user: {
    uid: string;
    displayName: string;
    username: string;
    bio: string;
    email?: string;
    photoURL: string;
    role: UserRole;
    status: string;
    provider: string;
    joinedAt: string;
    lastSignInTime: string;
    emailVerified: boolean | null;
    stats?: {
      watchedEpisodes?: number;
      watchlistCount?: number;
      completedCount?: number;
    } | null;
  };
  relatedReports: Array<Record<string, any>>;
  watchDataAvailable: boolean;
  watchlistCount: number;
  watchHistoryCount: number;
  continueWatchingCount: number;
  recentWatchHistory: Array<Record<string, any>>;
  watchlistSample: Array<Record<string, any>>;
}

function formatCreatedAt(raw: unknown): string {
  if (!raw) return '—';
  let d: Date | null = null;
  if (typeof raw === 'string') {
    d = new Date(raw);
  } else if (typeof (raw as any)?.toDate === 'function') {
    d = (raw as any).toDate();
  } else if (typeof (raw as any)?.seconds === 'number') {
    d = new Date((raw as any).seconds * 1000);
  }
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const PAGE_SIZE = 25;

export default function AdminUsersPage() {
  const { adminRecord, user: currentUser, effectiveRole } = useAuth();
  const canManageUsers = hasAdminPermission(adminRecord, 'manageUsers');
  const isMod = effectiveRole === 'mod';

  const [users, setUsers] = useState<ManagedUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'disabled' | 'banned'
  >('all');
  const [roleFilter, setRoleFilter] = useState<
    'all' | 'owner' | 'admin' | 'mod' | 'member'
  >('all');
  const [sortBy, setSortBy] = useState<'role' | 'name' | 'recent'>('role');
  const [page, setPage] = useState(1);

  const [toast, setToast] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUserRow | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    target: ManagedUserRow;
    nextRole: UserRole;
  } | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const [drawerDetail, setDrawerDetail] = useState<UserDetailPayload | null>(null);
  const [loadingDrawer, setLoadingDrawer] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAdminAuthHeaders();
      const [firestoreUsers, apiRes] = await Promise.all([
        listManagedUsers().catch(() => []),
        fetch('/api/admin/users', { headers })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);

      const merged = new Map<string, ManagedUserRow>();

      for (const u of firestoreUsers) {
        const resolvedRole = resolveEffectiveUserRole({
          uid: u.uid,
          email: u.email,
          profileRole: u.role,
        });
        merged.set(u.uid, {
          ...u,
          role: resolvedRole,
          joinedDateLabel: formatCreatedAt(u.createdAt),
        });
      }

      if (Array.isArray(apiRes?.users)) {
        for (const au of apiRes.users) {
          const existing = merged.get(au.uid);
          const resolvedRole = resolveEffectiveUserRole({
            uid: au.uid,
            email: existing?.email || au.email || null,
            profileRole: au.role || existing?.role,
          });
          const createdRaw = existing?.createdAt || au.createdAt;
          merged.set(au.uid, {
            uid: au.uid,
            displayName:
              existing?.displayName || au.displayName || 'AniScroll Member',
            username: au.username || existing?.username || '',
            email: existing?.email || au.email || '',
            photoURL: au.photoURL || existing?.photoURL || '',
            provider: existing?.provider || au.provider || 'password',
            status:
              existing?.status || (au.disabled ? 'disabled' : au.status || 'active'),
            role: resolvedRole,
            createdAt: createdRaw,
            joinedDateLabel: formatCreatedAt(createdRaw),
          });
        }
      }

      if (currentUser && !merged.has(currentUser.uid)) {
        merged.set(currentUser.uid, {
          uid: currentUser.uid,
          displayName: currentUser.displayName || 'Administrator',
          username: '',
          email: currentUser.email || '',
          photoURL: currentUser.photoURL || '',
          provider: 'google',
          status: 'active',
          role: effectiveRole,
          createdAt: currentUser.metadata?.creationTime,
          joinedDateLabel: formatCreatedAt(currentUser.metadata?.creationTime),
        });
      }

      setUsers(Array.from(merged.values()));
    } catch (error) {
      console.error('Failed to load managed users:', error);
    } finally {
      setLoading(false);
    }
  }, [currentUser, effectiveRole]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openUserDrawer = async (uid: string) => {
    setLoadingDrawer(true);
    setDrawerDetail(null);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch(`/api/admin/users/${encodeURIComponent(uid)}`, {
        headers,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to load user details.');
      }
      setDrawerDetail(data as UserDetailPayload);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load user details.');
    } finally {
      setLoadingDrawer(false);
    }
  };

  const handleConfirmRoleChange = async () => {
    if (!pendingRoleChange || savingRole) return;
    const { target, nextRole } = pendingRoleChange;

    setSavingRole(true);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'set_role',
          uid: target.uid,
          role: nextRole,
          email: target.email,
          displayName: target.displayName,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to update user role.');
      }

      setUsers((prev) =>
        prev.map((u) => (u.uid === target.uid ? { ...u, role: nextRole } : u))
      );
      setPendingRoleChange(null);
      showToast(
        `Updated ${target.displayName} role to ${ROLE_DEFINITIONS[nextRole].label}.`
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Role update rejected.');
    } finally {
      setSavingRole(false);
    }
  };

  const handleStatusChange = async (
    target: ManagedUserRow,
    nextStatus: 'active' | 'disabled' | 'banned'
  ) => {
    if (!canManageUsers || !currentUser) return;
    const action: 'enable' | 'disable' | 'ban' =
      nextStatus === 'active'
        ? 'enable'
        : nextStatus === 'disabled'
        ? 'disable'
        : 'ban';
    const modCheck = canActorModerateUser({
      actorRole: effectiveRole,
      actorUid: currentUser.uid,
      targetUid: target.uid,
      targetEmail: target.email,
      targetCurrentRole: target.role,
      action,
    });

    if (!modCheck.allowed) {
      showToast(modCheck.reason || 'Action not allowed.');
      return;
    }

    setBusyUid(target.uid);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, uid: target.uid }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to update user status.');
      }

      setUsers((prev) =>
        prev.map((u) =>
          u.uid === target.uid ? { ...u, status: nextStatus } : u
        )
      );
      showToast(
        `Updated ${target.displayName} status to ${nextStatus.toUpperCase()}.`
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to update user status.'
      );
    } finally {
      setBusyUid(null);
    }
  };

  const handleDeleteUser = async () => {
    const target = deleteTarget;
    if (!target || !canManageUsers || !currentUser) return;
    const modCheck = canActorModerateUser({
      actorRole: effectiveRole,
      actorUid: currentUser.uid,
      targetUid: target.uid,
      targetEmail: target.email,
      targetCurrentRole: target.role,
      action: 'delete',
    });

    if (!modCheck.allowed) {
      showToast(modCheck.reason || 'Cannot delete this account.');
      setDeleteTarget(null);
      return;
    }

    setBusyUid(target.uid);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'delete', uid: target.uid }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to delete user.');
      }

      setUsers((prev) => prev.filter((u) => u.uid !== target.uid));
      setDeleteTarget(null);
      showToast(`Deleted user account ${target.displayName}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete user.');
    } finally {
      setBusyUid(null);
    }
  };

  const filteredUsers = useMemo(() => {
    const filtered = users.filter((u) => {
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        u.email.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        (u.username || '').toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q)
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        return a.displayName.localeCompare(b.displayName);
      }
      if (sortBy === 'recent') {
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      }
      const rankDiff = USER_ROLE_RANK[b.role] - USER_ROLE_RANK[a.role];
      if (rankDiff !== 0) return rankDiff;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [users, statusFilter, roleFilter, searchQuery, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedUsers = filteredUsers.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-white text-black font-bold text-xs shadow-2xl flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>{toast}</span>
        </div>
      )}

      <AdminConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete User Account"
        description={
          deleteTarget
            ? `Permanently delete Firestore profile and Firebase Auth account for ${deleteTarget.displayName} (${deleteTarget.email || deleteTarget.uid})? This action cannot be undone.`
            : ''
        }
        confirmLabel="Delete Account"
        destructive
        loading={Boolean(deleteTarget && busyUid === deleteTarget.uid)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteUser}
      />

      {/* Role Change Confirmation Modal */}
      {pendingRoleChange && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (!savingRole) setPendingRoleChange(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[#0A0A0A] border border-[#292929] p-6 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-white text-black flex items-center justify-center shrink-0">
                  <Shield size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Confirm Role Change
                  </h3>
                  <p className="text-xs text-[#707070]">
                    Authoritative role update
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingRoleChange(null)}
                disabled={savingRole}
                className="p-1.5 rounded-lg text-[#707070] hover:text-white cursor-pointer"
                aria-label="Cancel role change"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#A0A0A0]">Target Account</span>
                <span className="font-bold text-white truncate">
                  {pendingRoleChange.target.displayName}
                </span>
              </div>
              {pendingRoleChange.target.email && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#A0A0A0]">Email</span>
                  <span className="font-mono text-white truncate">
                    {pendingRoleChange.target.email}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#222222]">
                <span className="text-[#A0A0A0]">Current Role</span>
                <RoleBadge role={pendingRoleChange.target.role} size="sm" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#A0A0A0]">New Role</span>
                <RoleBadge role={pendingRoleChange.nextRole} size="sm" />
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#141414] border border-[#292929] flex items-start gap-2.5 text-xs text-[#A0A0A0]">
              <AlertTriangle size={15} className="text-white shrink-0 mt-0.5" />
              <span>{ROLE_DEFINITIONS[pendingRoleChange.nextRole].description}</span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingRoleChange(null)}
                disabled={savingRole}
                className="px-4 py-2 rounded-xl border border-[#292929] text-xs text-[#A0A0A0] hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRoleChange}
                disabled={savingRole}
                className="px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {savingRole ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Updating...</span>
                  </>
                ) : (
                  <span>Confirm Role Update</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
            <Users size={20} />
            <span>User Directory & Moderation</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            {isMod
              ? 'Inspect member profiles and moderate member accounts (disable, ban, or restore).'
              : 'Manage Member, Mod, Admin, and Owner roles, inspect user activity, and moderate account access.'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <RoleBadge role={effectiveRole} size="md" />
          <button
            type="button"
            onClick={loadUsers}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh Users</span>
          </button>
        </div>
      </div>

      {/* Search, Role Filter, Status Filter, Sort */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-4 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#707070]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search by display name, @username, email, or UID..."
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs sm:text-sm text-white placeholder-[#707070] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl bg-[#141414] border border-[#292929] p-1 text-xs">
              {(['all', 'owner', 'admin', 'mod', 'member'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRoleFilter(r);
                    setPage(1);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg font-medium uppercase font-mono transition-colors cursor-pointer ${
                    roleFilter === r
                      ? 'bg-white text-black font-bold'
                      : 'text-[#A0A0A0] hover:text-white'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            <div className="inline-flex rounded-xl bg-[#141414] border border-[#292929] p-1 text-xs">
              {(['all', 'active', 'disabled', 'banned'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    setStatusFilter(st);
                    setPage(1);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg font-medium uppercase font-mono transition-colors cursor-pointer ${
                    statusFilter === st
                      ? 'bg-white text-black font-bold'
                      : 'text-[#A0A0A0] hover:text-white'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value as 'role' | 'name' | 'recent');
                setPage(1);
              }}
              aria-label="Sort users"
              className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs font-mono text-white focus:outline-none"
            >
              <option value="role">Sort: Role</option>
              <option value="name">Sort: Name</option>
              <option value="recent">Sort: Joined</option>
            </select>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center space-y-3">
            <Loader2 size={24} className="animate-spin text-white" />
            <div className="text-xs font-mono uppercase tracking-wider text-[#A0A0A0]">
              Querying Cloud Firestore User Profiles...
            </div>
          </div>
        ) : pagedUsers.length === 0 ? (
          <div className="p-10 text-center text-xs text-[#A0A0A0]">
            No user accounts matched the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#292929] bg-[#141414]/60 text-[11px] font-mono uppercase text-[#A0A0A0]">
                  <th className="py-3 px-4">User Identity</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Provider</th>
                  <th className="py-3 px-4">Joined</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#292929] text-xs">
                {pagedUsers.map((u) => {
                  const isTargetBootstrappedOwner =
                    u.uid === BOOTSTRAPPED_OWNER_UID ||
                    u.email.toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL;
                  const isSelf = u.uid === currentUser?.uid;
                  const assignableRoles = getAssignableRolesForActor(
                    effectiveRole,
                    u.role,
                    { isTargetBootstrappedOwner, isSelf }
                  );
                  const canChangeThisRole =
                    !isMod &&
                    canManageUsers &&
                    assignableRoles.length > 0 &&
                    !(isTargetBootstrappedOwner && u.role === 'owner') &&
                    !(isSelf && effectiveRole !== 'owner') &&
                    !(isSelf && assignableRoles.length <= 1);

                  const canModerate =
                    canManageUsers &&
                    canActorModerateUser({
                      actorRole: effectiveRole,
                      actorUid: currentUser?.uid || '',
                      targetUid: u.uid,
                      targetEmail: u.email,
                      targetCurrentRole: u.role,
                      action: u.status === 'active' ? 'disable' : 'enable',
                    }).allowed;

                  const canDelete =
                    !isMod &&
                    canManageUsers &&
                    canActorModerateUser({
                      actorRole: effectiveRole,
                      actorUid: currentUser?.uid || '',
                      targetUid: u.uid,
                      targetEmail: u.email,
                      targetCurrentRole: u.role,
                      action: 'delete',
                    }).allowed;

                  return (
                    <tr
                      key={u.uid}
                      className="hover:bg-[#141414]/40 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <div className="relative w-10 h-10 rounded-xl bg-[#141414] border border-[#292929] overflow-hidden flex items-center justify-center text-xs font-bold text-white shrink-0">
                            {u.photoURL ? (
                              <ResilientImage
                                src={u.photoURL}
                                alt={u.displayName}
                                fill
                                sizes="40px"
                                className="object-cover object-top"
                                fallback={<User size={15} />}
                              />
                            ) : (
                              <User size={15} />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Link
                                href={`/profile/${u.username || u.uid}`}
                                className="font-bold text-white hover:underline truncate inline-flex items-center gap-1"
                              >
                                <span>{u.displayName}</span>
                                <ExternalLink size={11} className="text-[#707070]" />
                              </Link>
                            </div>
                            <div className="text-[11px] font-mono text-[#A0A0A0] truncate">
                              {u.username ? `@${u.username} · ` : ''}
                              {isMod ? u.uid : u.email || u.uid}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <RoleBadge role={u.role} size="sm" />
                          {canChangeThisRole && (
                            <select
                              aria-label={`Change role for ${u.displayName}`}
                              value={u.role}
                              onChange={(e) => {
                                const next = normalizeUserRole(e.target.value);
                                if (next === u.role) return;
                                const check = canActorAssignRole({
                                  actorRole: effectiveRole,
                                  actorUid: currentUser?.uid || '',
                                  targetUid: u.uid,
                                  targetEmail: u.email,
                                  targetCurrentRole: u.role,
                                  targetNextRole: next,
                                });
                                if (!check.allowed) {
                                  showToast(check.reason || 'Role change forbidden.');
                                  return;
                                }
                                setPendingRoleChange({ target: u, nextRole: next });
                              }}
                              className="px-2 py-1 rounded-lg bg-[#141414] border border-[#292929] hover:border-white/40 text-[11px] font-mono text-white focus:outline-none cursor-pointer"
                            >
                              {assignableRoles.map((r) => (
                                <option key={r} value={r}>
                                  {ROLE_DEFINITIONS[r].label}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#292929] font-mono text-[10px] text-white uppercase">
                          {u.provider}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-mono text-[11px] text-[#A0A0A0] whitespace-nowrap">
                        {u.joinedDateLabel}
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase ${
                            u.status === 'active'
                              ? 'bg-white text-black'
                              : 'bg-[#141414] border border-white/40 text-white'
                          }`}
                        >
                          {u.status}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openUserDrawer(u.uid)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-xs text-white cursor-pointer"
                            aria-label={`Inspect ${u.displayName}`}
                          >
                            <Eye size={12} />
                            <span>Inspect</span>
                          </button>

                          {canModerate &&
                            (u.status !== 'active' ? (
                              <button
                                type="button"
                                disabled={busyUid === u.uid}
                                onClick={() => handleStatusChange(u, 'active')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white text-black font-bold text-xs cursor-pointer disabled:opacity-50"
                              >
                                <UserCheck size={12} />
                                <span>Restore</span>
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  disabled={busyUid === u.uid}
                                  onClick={() => handleStatusChange(u, 'disabled')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-xs text-white cursor-pointer disabled:opacity-50"
                                >
                                  <ShieldAlert size={12} />
                                  <span>Disable</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={busyUid === u.uid}
                                  onClick={() => handleStatusChange(u, 'banned')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-xs text-white cursor-pointer disabled:opacity-50"
                                >
                                  <Ban size={12} />
                                  <span>Ban</span>
                                </button>
                              </>
                            ))}

                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(u)}
                              className="p-1.5 rounded-lg bg-[#141414] border border-[#292929] text-[#A0A0A0] hover:text-white hover:border-white cursor-pointer"
                              title="Delete user profile"
                              aria-label={`Delete ${u.displayName}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AdminPagination
        page={safePage}
        totalPages={totalPages}
        totalItems={filteredUsers.length}
        pageSize={PAGE_SIZE}
        onPageChange={(next) => setPage(next)}
      />

      {/* User Detail Slide-Over Drawer */}
      {(loadingDrawer || drawerDetail) && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => !loadingDrawer && setDrawerDetail(null)}
        >
          <div
            className="w-full max-w-lg h-full overflow-y-auto bg-[#0A0A0A] border-l border-[#292929] p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#292929] pb-4">
              <div>
                <div className="text-[11px] font-mono uppercase text-[#707070]">
                  User Profile Inspector
                </div>
                <h3 className="text-base font-bold text-white">
                  {drawerDetail?.user?.displayName || 'Loading Account...'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDrawerDetail(null)}
                className="p-2 rounded-lg bg-[#141414] border border-[#292929] text-[#A0A0A0] hover:text-white cursor-pointer"
                aria-label="Close user inspector"
              >
                <X size={16} />
              </button>
            </div>

            {loadingDrawer ? (
              <div className="py-12 flex justify-center">
                <Loader2 size={24} className="animate-spin text-white" />
              </div>
            ) : drawerDetail ? (
              <div className="space-y-5 text-xs">
                <div className="flex items-center gap-4 p-4 rounded-xl bg-[#141414] border border-[#292929]">
                  <div className="relative w-14 h-14 rounded-xl overflow-hidden bg-black border border-[#292929] shrink-0 flex items-center justify-center">
                    {drawerDetail.user.photoURL ? (
                      <ResilientImage
                        src={drawerDetail.user.photoURL}
                        alt={drawerDetail.user.displayName}
                        fill
                        sizes="56px"
                        className="object-cover"
                      />
                    ) : (
                      <User size={20} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white text-sm">
                        {drawerDetail.user.displayName}
                      </span>
                      <RoleBadge role={drawerDetail.user.role} size="sm" />
                    </div>
                    <div className="font-mono text-[11px] text-[#A0A0A0] truncate">
                      {drawerDetail.user.username ? `@${drawerDetail.user.username} · ` : ''}
                      {drawerDetail.user.email || drawerDetail.user.uid}
                    </div>
                    <div className="font-mono text-[10px] text-[#707070]">
                      UID: {drawerDetail.user.uid}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 font-mono text-[11px]">
                  <div className="p-3 rounded-xl bg-[#141414] border border-[#292929]">
                    <div className="text-[#707070] uppercase text-[10px]">Status</div>
                    <div className="text-white font-bold uppercase mt-0.5">
                      {drawerDetail.user.status}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#141414] border border-[#292929]">
                    <div className="text-[#707070] uppercase text-[10px]">Auth Provider</div>
                    <div className="text-white font-bold uppercase mt-0.5">
                      {drawerDetail.user.provider}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#141414] border border-[#292929]">
                    <div className="text-[#707070] uppercase text-[10px]">Joined</div>
                    <div className="text-white mt-0.5">
                      {formatCreatedAt(drawerDetail.user.joinedAt)}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-[#141414] border border-[#292929]">
                    <div className="text-[#707070] uppercase text-[10px]">Last Sign-In</div>
                    <div className="text-white mt-0.5">
                      {drawerDetail.user.lastSignInTime
                        ? formatCreatedAt(drawerDetail.user.lastSignInTime)
                        : '—'}
                    </div>
                  </div>
                </div>

                {!isMod && (
                  <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-3">
                    <div className="font-mono uppercase text-[11px] text-[#A0A0A0] flex items-center gap-1.5">
                      <History size={13} />
                      <span>Cloud Watch & Library Telemetry</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center font-mono">
                      <div className="p-2.5 rounded-lg bg-[#0A0A0A] border border-[#292929]">
                        <div className="text-lg font-black text-white tabular-nums">
                          {drawerDetail.watchlistCount ||
                            drawerDetail.user.stats?.watchlistCount ||
                            0}
                        </div>
                        <div className="text-[10px] text-[#707070]">Watchlist</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-[#0A0A0A] border border-[#292929]">
                        <div className="text-lg font-black text-white tabular-nums">
                          {drawerDetail.watchHistoryCount ||
                            drawerDetail.user.stats?.watchedEpisodes ||
                            0}
                        </div>
                        <div className="text-[10px] text-[#707070]">History</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-[#0A0A0A] border border-[#292929]">
                        <div className="text-lg font-black text-white tabular-nums">
                          {drawerDetail.continueWatchingCount || 0}
                        </div>
                        <div className="text-[10px] text-[#707070]">In Progress</div>
                      </div>
                    </div>

                    {drawerDetail.recentWatchHistory.length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-[#292929]">
                        <div className="text-[10px] font-mono uppercase text-[#707070]">
                          Recent Watch History
                        </div>
                        {drawerDetail.recentWatchHistory.slice(0, 5).map((h, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between text-[11px] text-[#D4D4D4]"
                          >
                            <span className="truncate">
                              {h.animeTitle || h.title || `Anime #${h.hoshikaId}`}
                            </span>
                            <span className="font-mono text-[#707070] shrink-0">
                              Ep {h.episodeNumber || 1}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {drawerDetail.watchlistSample.length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-[#292929]">
                        <div className="text-[10px] font-mono uppercase text-[#707070] flex items-center gap-1">
                          <Bookmark size={11} />
                          <span>Watchlist Sample</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {drawerDetail.watchlistSample.slice(0, 8).map((w, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded bg-[#0A0A0A] border border-[#292929] text-[10px] text-white"
                            >
                              {w.title || `#${w.hoshikaId}`}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-2">
                  <div className="font-mono uppercase text-[11px] text-[#A0A0A0] flex items-center gap-1.5">
                    <Flag size={13} />
                    <span>Related Moderation Reports ({drawerDetail.relatedReports.length})</span>
                  </div>
                  {drawerDetail.relatedReports.length === 0 ? (
                    <div className="text-[11px] text-[#707070]">
                      No reports filed by or against this user.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {drawerDetail.relatedReports.map((rep, i) => (
                        <div
                          key={rep.id || i}
                          className="p-2.5 rounded-lg bg-[#0A0A0A] border border-[#292929] flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-white truncate">
                              {rep.reason}
                            </div>
                            <div className="text-[10px] font-mono text-[#707070]">
                              Status: {rep.status}
                            </div>
                          </div>
                          <Link
                            href="/admin/moderation"
                            className="text-[11px] font-mono text-white underline shrink-0"
                          >
                            Review
                          </Link>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
