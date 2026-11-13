'use client';

import React, { useState, useEffect, useCallback } from 'react';
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

interface ManagedUserRow extends AdminManagedUserRecord {
  role: UserRole;
  joinedDateLabel: string;
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

export default function AdminUsersPage() {
  const { adminRecord, user: currentUser, effectiveRole } = useAuth();
  const canManageUsers = hasAdminPermission(adminRecord, 'manageUsers');

  const [users, setUsers] = useState<ManagedUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'disabled' | 'banned'
  >('all');
  const [roleFilter, setRoleFilter] = useState<
    'all' | 'owner' | 'admin' | 'mod' | 'member'
  >('all');

  const [toast, setToast] = useState<string | null>(null);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);

  // Explicit confirmation modal state for role changes
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    target: ManagedUserRow;
    nextRole: UserRole;
  } | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);

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

      const sorted = Array.from(merged.values()).sort((a, b) => {
        const rankDiff = USER_ROLE_RANK[b.role] - USER_ROLE_RANK[a.role];
        if (rankDiff !== 0) return rankDiff;
        return a.displayName.localeCompare(b.displayName);
      });

      setUsers(sorted);
    } catch (error) {
      console.error('Failed to load managed users:', error);
    } finally {
      setLoading(false);
    }
  }, [currentUser, effectiveRole]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

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
        body: JSON.stringify({
          action,
          uid: target.uid,
        }),
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

  const handleDeleteUser = async (target: ManagedUserRow) => {
    if (!canManageUsers || !currentUser) return;
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
      setConfirmDeleteUid(null);
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
      setConfirmDeleteUid(null);
      showToast(`Deleted user account ${target.displayName}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete user.');
    } finally {
      setBusyUid(null);
    }
  };

  const filteredUsers = users.filter((u) => {
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

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-white text-black font-bold text-xs shadow-2xl flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>{toast}</span>
        </div>
      )}

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
            <span>User Directory & Role Management</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Manage Member, Mod, Admin, and Owner roles, view member profiles, and moderate account access.
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

      {/* Search, Role Filter, Status Filter */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#707070]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
                  onClick={() => setRoleFilter(r)}
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
                  onClick={() => setStatusFilter(st)}
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
        ) : filteredUsers.length === 0 ? (
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
                {filteredUsers.map((u) => {
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
                              {u.email || u.uid}
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
                        {canModerate || canDelete ? (
                          <div className="inline-flex items-center justify-end gap-2">
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
                                    onClick={() =>
                                      handleStatusChange(u, 'disabled')
                                    }
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

                            {canDelete &&
                              (confirmDeleteUid === u.uid ? (
                                <button
                                  type="button"
                                  disabled={busyUid === u.uid}
                                  onClick={() => handleDeleteUser(u)}
                                  className="px-2.5 py-1.5 rounded-lg bg-white text-black font-bold text-xs cursor-pointer disabled:opacity-50"
                                >
                                  Confirm Delete
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteUid(u.uid)}
                                  className="p-1.5 rounded-lg bg-[#141414] border border-[#292929] text-[#A0A0A0] hover:text-white hover:border-white cursor-pointer"
                                  title="Delete user profile"
                                >
                                  <Trash2 size={13} />
                                </button>
                              ))}
                          </div>
                        ) : (
                          <span className="text-[11px] font-mono text-[#707070]">
                            Protected
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
