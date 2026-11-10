'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  UserPlus,
  Trash2,
  CheckCircle2,
  Loader2,
  Lock,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  AdminPermissions,
  AdminRecord,
  AdminRole,
  BOOTSTRAPPED_OWNER_EMAIL,
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_LABELS,
  hasAdminPermission,
} from '@/lib/admin/admin-permissions';
import {
  listAllAdmins,
  removeAdminRecord,
  saveAdminRecord,
} from '@/lib/admin/admin-firestore';

const PERMISSION_KEYS: { key: keyof AdminPermissions; label: string }[] = [
  { key: 'manageAdmins', label: 'Manage Admins' },
  { key: 'manageUsers', label: 'Manage Users' },
  { key: 'manageArtwork', label: 'Manage Artwork' },
  { key: 'uploadLogos', label: 'Upload Logos' },
  { key: 'deleteLogos', label: 'Delete Logos' },
  { key: 'manageAnime', label: 'Manage Anime' },
  { key: 'manageAnnouncements', label: 'Announcements' },
  { key: 'manageSettings', label: 'Site Settings' },
  { key: 'viewAnalytics', label: 'View Analytics' },
  { key: 'viewLogs', label: 'View Audit Logs' },
];

export default function AdminManagementPage() {
  const { adminRecord, user: currentUser } = useAuth();
  const isOwner =
    adminRecord?.role === 'owner' ||
    hasAdminPermission(adminRecord, 'manageAdmins');

  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [newUid, setNewUid] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<AdminRole>('administrator');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadAdmins = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listAllAdmins();
      if (adminRecord && !list.some((a) => a.uid === adminRecord.uid)) {
        list.unshift(adminRecord);
      }
      setAdmins(list);
    } finally {
      setLoading(false);
    }
  }, [adminRecord]);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner || !newUid.trim() || !newEmail.trim()) return;
    setSaving(true);
    try {
      const saved = await saveAdminRecord({
        uid: newUid.trim(),
        email: newEmail.trim().toLowerCase(),
        displayName: newName.trim() || newEmail.split('@')[0] || 'Admin',
        role: newRole,
        permissions: { ...DEFAULT_ROLE_PERMISSIONS[newRole] },
        status: 'active',
      });
      setAdmins((prev) => {
        const exists = prev.some((a) => a.uid === saved.uid);
        if (exists) return prev.map((a) => (a.uid === saved.uid ? saved : a));
        return [...prev, saved];
      });
      setNewUid('');
      setNewEmail('');
      setNewName('');
      showToast(`Granted ${newRole.toUpperCase()} access to ${saved.email}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add administrator.');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (target: AdminRecord, role: AdminRole) => {
    if (!isOwner) return;
    if (
      target.email.toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL &&
      role !== 'owner'
    ) {
      showToast('The primary Owner account role cannot be downgraded.');
      return;
    }

    try {
      const saved = await saveAdminRecord({
        uid: target.uid,
        email: target.email,
        displayName: target.displayName,
        role,
        permissions: { ...DEFAULT_ROLE_PERMISSIONS[role] },
        status: target.status,
      });
      setAdmins((prev) => prev.map((a) => (a.uid === saved.uid ? saved : a)));
      showToast(`Updated ${target.email} role to ${role.toUpperCase()}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update role.');
    }
  };

  const handleTogglePermission = async (
    target: AdminRecord,
    permKey: keyof AdminPermissions
  ) => {
    if (!isOwner || target.role === 'owner') return;
    const nextPerms: AdminPermissions = {
      ...target.permissions,
      [permKey]: !target.permissions[permKey],
    };

    try {
      const saved = await saveAdminRecord({
        uid: target.uid,
        email: target.email,
        displayName: target.displayName,
        role: target.role,
        permissions: nextPerms,
        status: target.status,
      });
      setAdmins((prev) => prev.map((a) => (a.uid === saved.uid ? saved : a)));
      showToast(`Updated ${permKey} permission for ${target.email}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Permission update failed.');
    }
  };

  const handleRevokeAdmin = async (target: AdminRecord) => {
    if (!isOwner) return;
    if (
      target.uid === currentUser?.uid ||
      target.email.toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL
    ) {
      showToast('Cannot revoke the primary Owner or your active session.');
      return;
    }

    try {
      await removeAdminRecord(target.uid, target.email);
      setAdmins((prev) => prev.filter((a) => a.uid !== target.uid));
      showToast(`Revoked administrator access for ${target.email}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to revoke admin.');
    }
  };

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
            <ShieldCheck size={20} />
            <span>Administrator Access & Role-Based Permissions (RBAC)</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Manage Owner, Administrator, Content Editor, and Analyst roles stored in Firestore `/admins`.
          </p>
        </div>

        <span className="px-3 py-1.5 rounded-lg bg-[#141414] border border-[#292929] font-mono text-xs text-white">
          Primary Owner: {BOOTSTRAPPED_OWNER_EMAIL}
        </span>
      </div>

      {/* Role Reference Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {(['owner', 'administrator', 'editor', 'analyst'] as const).map((r) => {
          const meta = ROLE_LABELS[r];
          return (
            <div
              key={r}
              className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-4 space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">{meta.label}</span>
                <span className="px-1.5 py-0.5 rounded bg-white text-black font-mono text-[9px] font-bold uppercase">
                  {r}
                </span>
              </div>
              <p className="text-[11px] text-[#A0A0A0] leading-relaxed">
                {meta.description}
              </p>
            </div>
          );
        })}
      </div>

      {/* Owner-Only Add Administrator Form */}
      {isOwner ? (
        <form
          onSubmit={handleAddAdmin}
          className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4"
        >
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <UserPlus size={15} />
            <span>Add / Authorize Administrator Account</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1">
                Firebase Auth UID
              </label>
              <input
                type="text"
                required
                value={newUid}
                onChange={(e) => setNewUid(e.target.value)}
                placeholder="Paste user's Firebase UID..."
                className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs text-white placeholder-[#707070] focus:outline-none font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1">
                Email Address
              </label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs text-white placeholder-[#707070] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Editor / Admin Name"
                className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs text-white placeholder-[#707070] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1">
                Assigned Role
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as AdminRole)}
                  className="flex-1 px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none"
                >
                  <option value="administrator">Administrator</option>
                  <option value="editor">Content Editor</option>
                  <option value="analyst">Viewer / Analyst</option>
                  <option value="owner">Co-Owner</option>
                </select>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                >
                  {saving ? 'Adding...' : 'Authorize'}
                </button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        <div className="p-4 rounded-xl bg-[#0A0A0A] border border-[#292929] flex items-center gap-2.5 text-xs text-[#A0A0A0]">
          <Lock size={14} className="text-white" />
          <span>
            Only the Primary Owner can add, modify, or revoke administrator accounts.
          </span>
        </div>
      )}

      {/* Active Administrators & Granular Permission Matrix */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-white">
          Registered Administrators ({admins.length})
        </h3>

        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 size={20} className="animate-spin text-white" />
          </div>
        ) : (
          <div className="space-y-4">
            {admins.map((adm) => (
              <div
                key={adm.uid}
                className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">
                        {adm.displayName}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white text-black font-mono text-[10px] font-bold uppercase">
                        {adm.role}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-black border border-[#292929] font-mono text-[10px] text-[#A0A0A0] uppercase">
                        {adm.status}
                      </span>
                    </div>
                    <div className="text-xs font-mono text-[#A0A0A0] mt-0.5">
                      {adm.email} • UID: <span className="text-white">{adm.uid}</span>
                    </div>
                  </div>

                  {isOwner && (
                    <div className="flex items-center gap-2">
                      <select
                        value={adm.role}
                        disabled={
                          adm.email.toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL
                        }
                        onChange={(e) =>
                          handleRoleChange(adm, e.target.value as AdminRole)
                        }
                        className="px-3 py-1.5 rounded-lg bg-black border border-[#292929] text-xs text-white font-mono focus:outline-none disabled:opacity-50"
                      >
                        <option value="owner">Owner</option>
                        <option value="administrator">Administrator</option>
                        <option value="editor">Content Editor</option>
                        <option value="analyst">Viewer / Analyst</option>
                      </select>

                      {adm.email.toLowerCase() !== BOOTSTRAPPED_OWNER_EMAIL &&
                        adm.uid !== currentUser?.uid && (
                          <button
                            type="button"
                            onClick={() => handleRevokeAdmin(adm)}
                            className="p-2 rounded-lg bg-black border border-[#292929] text-[#A0A0A0] hover:text-white hover:border-white cursor-pointer"
                            title="Revoke administrator access"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                    </div>
                  )}
                </div>

                {/* Granular Permissions Toggles */}
                <div className="pt-2 border-t border-[#292929] flex flex-wrap items-center gap-2">
                  {PERMISSION_KEYS.map((perm) => {
                    const enabled =
                      adm.role === 'owner' || Boolean(adm.permissions?.[perm.key]);
                    return (
                      <button
                        key={perm.key}
                        type="button"
                        disabled={!isOwner || adm.role === 'owner'}
                        onClick={() => handleTogglePermission(adm, perm.key)}
                        className={`px-2.5 py-1 rounded-md font-mono text-[10px] border transition-colors ${
                          enabled
                            ? 'bg-white text-black border-white font-bold'
                            : 'bg-black text-[#707070] border-[#292929]'
                        } ${
                          isOwner && adm.role !== 'owner'
                            ? 'cursor-pointer hover:border-white'
                            : 'cursor-default'
                        }`}
                      >
                        {perm.label}: {enabled ? 'ON' : 'OFF'}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
