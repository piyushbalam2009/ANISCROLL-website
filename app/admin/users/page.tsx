'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getAdminAuthHeaders, hasAdminPermission } from '@/lib/admin/admin-auth';
import {
  AdminManagedUserRecord,
  deleteManagedUserAccount,
  listManagedUsers,
  updateManagedUserStatus,
} from '@/lib/admin/admin-firestore';

export default function AdminUsersPage() {
  const { adminRecord, user: currentUser } = useAuth();
  const canManageUsers = hasAdminPermission(adminRecord, 'manageUsers');

  const [users, setUsers] = useState<AdminManagedUserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled' | 'banned'>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);

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

      const merged = new Map<string, AdminManagedUserRecord>();
      for (const u of firestoreUsers) {
        merged.set(u.uid, u);
      }

      if (Array.isArray(apiRes?.users)) {
        for (const au of apiRes.users) {
          const existing = merged.get(au.uid);
          merged.set(au.uid, {
            uid: au.uid,
            displayName: existing?.displayName || au.displayName || 'AniScroll User',
            email: existing?.email || au.email || '',
            photoURL: existing?.photoURL || au.photoURL || '',
            provider: existing?.provider || au.provider || 'password',
            status:
              existing?.status || (au.disabled ? 'disabled' : 'active'),
            role: existing?.role || 'user',
            createdAt: existing?.createdAt || au.createdAt,
          });
        }
      }

      // Ensure current logged-in admin is always visible in the table
      if (currentUser && !merged.has(currentUser.uid)) {
        merged.set(currentUser.uid, {
          uid: currentUser.uid,
          displayName: currentUser.displayName || 'Administrator',
          email: currentUser.email || '',
          photoURL: currentUser.photoURL || '',
          provider: 'google',
          status: 'active',
          role: adminRecord?.role === 'owner' ? 'owner' : 'admin',
        });
      }

      setUsers(Array.from(merged.values()));
    } catch (error) {
      console.error('Failed to load managed users:', error);
    } finally {
      setLoading(false);
    }
  }, [currentUser, adminRecord]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleStatusChange = async (
    target: AdminManagedUserRecord,
    nextStatus: 'active' | 'disabled' | 'banned'
  ) => {
    if (!canManageUsers) return;
    if (target.uid === currentUser?.uid) {
      showToast('You cannot disable or ban your own active administrator session.');
      return;
    }

    try {
      const headers = await getAdminAuthHeaders();
      await Promise.all([
        updateManagedUserStatus(target.uid, target.email, nextStatus),
        fetch('/api/admin/users', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            action: nextStatus === 'active' ? 'enable' : nextStatus,
            uid: target.uid,
          }),
        }),
      ]);

      setUsers((prev) =>
        prev.map((u) => (u.uid === target.uid ? { ...u, status: nextStatus } : u))
      );
      showToast(`Updated ${target.email} status to ${nextStatus.toUpperCase()}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update user status.');
    }
  };

  const handleDeleteUser = async (target: AdminManagedUserRecord) => {
    if (!canManageUsers) return;
    if (target.uid === currentUser?.uid) {
      showToast('You cannot delete your own administrator account.');
      return;
    }

    try {
      const headers = await getAdminAuthHeaders();
      await Promise.all([
        deleteManagedUserAccount(target.uid, target.email),
        fetch('/api/admin/users', {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'delete', uid: target.uid }),
        }),
      ]);
      setUsers((prev) => prev.filter((u) => u.uid !== target.uid));
      setConfirmDeleteUid(null);
      showToast(`Deleted user account ${target.email}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete user.');
    }
  };

  const filteredUsers = users.filter((u) => {
    if (statusFilter !== 'all' && u.status !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      u.displayName.toLowerCase().includes(q) ||
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

      {/* Header */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
            <Users size={20} />
            <span>User Directory & Account Moderation</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Inspect cloud-synced user profiles, authentication providers, and moderate account access.
          </p>
        </div>

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

      {/* Search & Status Filters */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-3 text-[#707070]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search users by email, display name, or Firebase UID..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs sm:text-sm text-white placeholder-[#707070] focus:outline-none"
          />
        </div>

        <div className="inline-flex rounded-xl bg-[#141414] border border-[#292929] p-1 text-xs">
          {(['all', 'active', 'disabled', 'banned'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg font-medium uppercase font-mono transition-colors cursor-pointer ${
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
            No user accounts matched the current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#292929] bg-[#141414]/60 text-[11px] font-mono uppercase text-[#A0A0A0]">
                  <th className="py-3 px-4">User Identity</th>
                  <th className="py-3 px-4">UID</th>
                  <th className="py-3 px-4">Provider</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Moderation Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#292929] text-xs">
                {filteredUsers.map((u) => (
                  <tr key={u.uid} className="hover:bg-[#141414]/40 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-white">{u.displayName}</div>
                      <div className="text-[11px] font-mono text-[#A0A0A0]">
                        {u.email}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-[11px] text-[#707070]">
                      {u.uid}
                    </td>

                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#292929] font-mono text-[10px] text-white uppercase">
                        {u.provider}
                      </span>
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
                      {canManageUsers ? (
                        <div className="inline-flex items-center justify-end gap-2">
                          {u.status !== 'active' ? (
                            <button
                              type="button"
                              onClick={() => handleStatusChange(u, 'active')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white text-black font-bold text-xs cursor-pointer"
                            >
                              <UserCheck size={12} />
                              <span>Restore</span>
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handleStatusChange(u, 'disabled')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-xs text-white cursor-pointer"
                              >
                                <ShieldAlert size={12} />
                                <span>Disable</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStatusChange(u, 'banned')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#141414] border border-[#292929] hover:border-white text-xs text-white cursor-pointer"
                              >
                                <Ban size={12} />
                                <span>Ban</span>
                              </button>
                            </>
                          )}

                          {confirmDeleteUid === u.uid ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(u)}
                              className="px-2.5 py-1.5 rounded-lg bg-white text-black font-bold text-xs cursor-pointer"
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
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] font-mono text-[#707070]">
                          Read-Only
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
