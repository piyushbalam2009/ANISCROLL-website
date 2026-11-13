'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Megaphone,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  Loader2,
  Eye,
  Send,
  Archive,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getAdminAuthHeaders, hasAdminPermission } from '@/lib/admin/admin-auth';
import { AnnouncementFirestoreDoc } from '@/lib/admin/admin-firestore';
import { AdminConfirmModal } from '@/components/admin/ui/AdminConfirmModal';

export default function AdminAnnouncementsPage() {
  const { adminRecord } = useAuth();
  const canManage = hasAdminPermission(adminRecord, 'manageAnnouncements');

  const [announcements, setAnnouncements] = useState<AnnouncementFirestoreDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<'feature' | 'maintenance' | 'notice' | 'alert'>(
    'feature'
  );
  const [status, setStatus] = useState<
    'draft' | 'published' | 'scheduled' | 'archived'
  >('published');
  const [priority, setPriority] = useState<'normal' | 'high'>('normal');
  const [dismissible, setDismissible] = useState(true);
  const [ctaText, setCtaText] = useState('');
  const [ctaLink, setCtaLink] = useState('');
  const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 16));
  const [expiresAt, setExpiresAt] = useState('');

  const [deleteTarget, setDeleteTarget] =
    useState<AnnouncementFirestoreDoc | null>(null);
  const [deleting, setDeleting] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/announcements', { headers });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setAnnouncements(data.announcements || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnnouncements();
  }, [loadAnnouncements]);

  const resetForm = () => {
    setEditingId(undefined);
    setTitle('');
    setMessage('');
    setType('feature');
    setStatus('published');
    setPriority('normal');
    setDismissible(true);
    setCtaText('');
    setCtaLink('');
    setStartsAt(new Date().toISOString().slice(0, 16));
    setExpiresAt('');
  };

  const handleEdit = (item: AnnouncementFirestoreDoc) => {
    setEditingId(item.id);
    setTitle(item.title);
    setMessage(item.message);
    setType(item.type);
    setStatus(item.status);
    setPriority(item.priority === 'high' ? 'high' : 'normal');
    setDismissible(item.dismissible);
    setCtaText(item.ctaText || '');
    setCtaLink(item.ctaLink || '');
    setStartsAt(
      item.startsAt
        ? item.startsAt.slice(0, 16)
        : new Date().toISOString().slice(0, 16)
    );
    setExpiresAt(item.expiresAt ? item.expiresAt.slice(0, 16) : '');
  };

  const saveAnnouncementPayload = async (
    payload: Partial<AnnouncementFirestoreDoc> & { title: string; message: string }
  ) => {
    const headers = await getAdminAuthHeaders();
    const res = await fetch('/api/admin/announcements', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok || !data?.announcement) {
      throw new Error(data?.error || 'Failed to save announcement.');
    }
    return data.announcement as AnnouncementFirestoreDoc;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !title.trim() || !message.trim()) return;
    setSaving(true);
    try {
      const saved = await saveAnnouncementPayload({
        id: editingId,
        title: title.trim(),
        message: message.trim(),
        type,
        status,
        priority,
        dismissible,
        ctaText: ctaText.trim(),
        ctaLink: ctaLink.trim(),
        startsAt: startsAt ? new Date(startsAt).toISOString() : new Date().toISOString(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : '',
      });

      setAnnouncements((prev) => {
        const exists = prev.some((a) => a.id === saved.id);
        if (exists) {
          return prev.map((a) => (a.id === saved.id ? saved : a));
        }
        return [saved, ...prev];
      });

      resetForm();
      showToast(
        editingId ? 'Updated announcement.' : 'Created and saved announcement.'
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to save announcement.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleQuickStatus = async (
    item: AnnouncementFirestoreDoc,
    nextStatus: 'published' | 'archived'
  ) => {
    if (!canManage) return;
    try {
      const saved = await saveAnnouncementPayload({
        ...item,
        status: nextStatus,
      });
      setAnnouncements((prev) =>
        prev.map((a) => (a.id === saved.id ? saved : a))
      );
      showToast(`Announcement "${item.title}" marked as ${nextStatus}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update status.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !canManage) return;
    setDeleting(true);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch(
        `/api/admin/announcements?id=${encodeURIComponent(
          deleteTarget.id
        )}&title=${encodeURIComponent(deleteTarget.title)}`,
        { method: 'DELETE', headers }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to delete announcement.');
      }
      setAnnouncements((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      showToast(`Deleted announcement "${deleteTarget.title}".`);
      setDeleteTarget(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete announcement.');
    } finally {
      setDeleting(false);
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

      <AdminConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete Announcement"
        description={
          deleteTarget
            ? `Permanently delete announcement "${deleteTarget.title}"? Users will no longer see this banner.`
            : ''
        }
        confirmLabel="Delete Announcement"
        destructive
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />

      {/* Header */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
            <Megaphone size={20} />
            <span>Global Announcements & Maintenance Notices</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Create, prioritize, schedule, archive, and publish site-wide banners displayed across AniScroll.
          </p>
        </div>
      </div>

      {/* Live Preview Banner */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-4 space-y-2.5">
        <div className="flex items-center gap-2 text-xs font-mono uppercase text-[#A0A0A0]">
          <Eye size={13} />
          <span>Live Banner Preview</span>
        </div>
        <div className="bg-[#141414] border border-[#292929] rounded-lg px-4 py-2.5 text-xs text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {priority === 'high' && (
              <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 font-mono font-bold text-[10px] uppercase shrink-0">
                HIGH PRIORITY
              </span>
            )}
            <span className="px-2 py-0.5 rounded bg-white text-black font-mono font-bold text-[10px] uppercase tracking-wider shrink-0">
              {type}
            </span>
            <span className="font-bold text-white truncate">
              {title || 'New 1080p Simultaneous Simulcast Servers Live'}:
            </span>
            <span className="text-[#A0A0A0] truncate">
              {message ||
                'Experience ultra-low latency HLS playback and Fanart.tv HD logos across all seasonal anime.'}
            </span>
          </div>
          <span className="text-[10px] font-mono uppercase text-[#707070] shrink-0">
            {status}
          </span>
        </div>
      </div>

      {/* Composer Form */}
      {canManage && (
        <form
          onSubmit={handleSubmit}
          className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Plus size={15} />
              <span>
                {editingId ? 'Edit Announcement' : 'Create New Announcement'}
              </span>
            </h3>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs font-mono text-[#A0A0A0] hover:text-white cursor-pointer"
              >
                Cancel Edit
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                Headline Title
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Scheduled Maintenance or New Feature Update"
                className="w-full px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs text-white placeholder-[#707070] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                Banner Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none"
              >
                <option value="feature">Feature</option>
                <option value="maintenance">Maintenance</option>
                <option value="notice">Notice</option>
                <option value="alert">Alert</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none"
                >
                  <option value="published">Published</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as 'normal' | 'high')}
                  className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none"
                >
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
              Announcement Message
            </label>
            <textarea
              required
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write a concise announcement message..."
              className="w-full px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs text-white placeholder-[#707070] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1">
                CTA Button Text (Optional)
              </label>
              <input
                type="text"
                value={ctaText}
                onChange={(e) => setCtaText(e.target.value)}
                placeholder="e.g., Explore Now"
                className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white placeholder-[#707070] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1">
                CTA Target Link (Optional)
              </label>
              <input
                type="text"
                value={ctaLink}
                onChange={(e) => setCtaLink(e.target.value)}
                placeholder="e.g., /trending"
                className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white placeholder-[#707070] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1">
                Start Date & Time
              </label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1">
                Expiration (Optional)
              </label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
              <input
                type="checkbox"
                checked={dismissible}
                onChange={(e) => setDismissible(e.target.checked)}
                className="accent-white"
              />
              <span>Allow users to dismiss this banner</span>
            </label>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              <span>
                {editingId ? 'Save Changes' : 'Publish / Save Announcement'}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* Existing Announcements List */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-white">
          All Announcements ({announcements.length})
        </h3>

        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 size={20} className="animate-spin text-white" />
          </div>
        ) : announcements.length === 0 ? (
          <div className="text-xs text-[#707070] py-6 text-center">
            No announcements published yet. Use the form above to broadcast a platform notice.
          </div>
        ) : (
          <div className="space-y-3">
            {announcements.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-xl bg-[#141414] border border-[#292929] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-white text-black font-mono text-[10px] font-bold uppercase">
                      {item.status}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-black border border-[#292929] font-mono text-[10px] text-white uppercase">
                      {item.type}
                    </span>
                    {item.priority === 'high' && (
                      <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200 font-mono text-[10px] font-bold uppercase">
                        HIGH
                      </span>
                    )}
                    <span className="text-xs font-bold text-white">
                      {item.title}
                    </span>
                  </div>
                  <p className="text-xs text-[#A0A0A0]">{item.message}</p>
                  <div className="text-[11px] font-mono text-[#707070]">
                    By {item.createdByEmail} • Starts:{' '}
                    {new Date(item.startsAt).toLocaleString()}
                  </div>
                </div>

                {canManage && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {item.status !== 'published' && (
                      <button
                        type="button"
                        onClick={() => handleQuickStatus(item, 'published')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white text-black font-bold text-xs cursor-pointer"
                      >
                        <Send size={12} />
                        <span>Publish</span>
                      </button>
                    )}
                    {item.status !== 'archived' && (
                      <button
                        type="button"
                        onClick={() => handleQuickStatus(item, 'archived')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black border border-[#292929] hover:border-white text-xs text-[#A0A0A0] hover:text-white cursor-pointer"
                      >
                        <Archive size={12} />
                        <span>Archive</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleEdit(item)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-black border border-[#292929] hover:border-white text-xs text-white cursor-pointer"
                    >
                      <Edit3 size={12} />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(item)}
                      className="p-1.5 rounded-lg bg-black border border-[#292929] text-[#A0A0A0] hover:text-white hover:border-white cursor-pointer"
                      aria-label={`Delete ${item.title}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
