'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Trash2,
  UserX,
  Ban,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getAdminAuthHeaders } from '@/lib/admin/admin-auth';
import { ModerationReportDoc } from '@/lib/admin/admin-firestore';
import { AdminStatusBadge, StatusTone } from '@/components/admin/ui/AdminStatusBadge';
import { AdminConfirmModal } from '@/components/admin/ui/AdminConfirmModal';

type ReportStatusFilter = 'all' | 'open' | 'in_review' | 'resolved' | 'dismissed';

function statusToTone(status: string): StatusTone {
  if (status === 'resolved') return 'operational';
  if (status === 'in_review') return 'degraded';
  if (status === 'open') return 'outage';
  return 'pending';
}

export default function AdminModerationQueuePage() {
  const { effectiveRole } = useAuth();
  const isOwner = effectiveRole === 'owner';

  const [reports, setReports] = useState<ModerationReportDoc[]>([]);
  const [counts, setCounts] = useState({
    all: 0,
    open: 0,
    in_review: 0,
    resolved: 0,
    dismissed: 0,
  });
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>('all');
  const [targetTypeFilter, setTargetTypeFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<ModerationReportDoc | null>(null);
  const [resolutionStatus, setResolutionStatus] = useState<
    'open' | 'in_review' | 'resolved' | 'dismissed'
  >('resolved');
  const [resolutionNote, setResolutionNote] = useState('');
  const [moderateUserAction, setModerateUserAction] = useState<
    '' | 'disable' | 'ban' | 'enable'
  >('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModerationReportDoc | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadReports = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      const params = new URLSearchParams({
        status: statusFilter,
        targetType: targetTypeFilter,
      });
      const res = await fetch(`/api/admin/moderation?${params.toString()}`, {
        headers,
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Failed to load moderation queue (${res.status})`);
      }
      setCounts(data.counts || { all: 0, open: 0, in_review: 0, resolved: 0, dismissed: 0 });
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, targetTypeFilter]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const openInspector = (rep: ModerationReportDoc) => {
    setSelectedReport(rep);
    setResolutionStatus(rep.status === 'open' ? 'resolved' : rep.status);
    setResolutionNote(rep.resolutionNote || '');
    setModerateUserAction('');
  };

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReport) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/moderation', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          reportId: selectedReport.id,
          status: resolutionStatus,
          resolutionNote,
          ...(moderateUserAction ? { moderateUserAction } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Failed to update report (${res.status})`);
      }
      showToast(`Report ${selectedReport.id} updated (${resolutionStatus}).`);
      setSelectedReport(null);
      await loadReports();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Moderation update failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/moderation', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'delete_report',
          reportId: deleteTarget.id,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Failed to delete report (${res.status})`);
      }
      showToast(`Deleted report ${deleteTarget.id}.`);
      setDeleteTarget(null);
      if (selectedReport?.id === deleteTarget.id) {
        setSelectedReport(null);
      }
      await loadReports();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Delete failed');
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

      {/* Header */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-[#707070]">
            Trust, Safety &amp; Community Reports
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2 mt-0.5">
            <ShieldCheck size={19} />
            <span>Moderation Queue ({counts.open} Open)</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Review member, anime, and episode reports with role-enforced user moderation controls.
          </p>
        </div>

        <button
          type="button"
          onClick={loadReports}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Refresh Queue</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Filters */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(
            [
              { id: 'all', label: `All (${counts.all})` },
              { id: 'open', label: `Open (${counts.open})` },
              { id: 'in_review', label: `In Review (${counts.in_review})` },
              { id: 'resolved', label: `Resolved (${counts.resolved})` },
              { id: 'dismissed', label: `Dismissed (${counts.dismissed})` },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg font-mono transition-colors cursor-pointer ${
                statusFilter === f.id
                  ? 'bg-white text-black font-bold'
                  : 'bg-[#141414] border border-[#292929] text-[#A0A0A0] hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <select
          value={targetTypeFilter}
          onChange={(e) => setTargetTypeFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs font-mono text-white focus:outline-none focus:border-white"
        >
          <option value="all">All Target Types</option>
          <option value="user">User Reports</option>
          <option value="anime">Anime Reports</option>
          <option value="episode">Episode Reports</option>
          <option value="other">Other</option>
        </select>
      </div>

      {/* Main Split View */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-[#0A0A0A] border border-[#292929] rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-12 flex justify-center">
              <Loader2 size={24} className="animate-spin text-white" />
            </div>
          ) : reports.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <div className="text-sm font-bold text-white">Moderation Queue Clear</div>
              <p className="text-xs text-[#A0A0A0]">
                No reports match the active filter criteria.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#292929]">
              {reports.map((rep) => {
                const isSelected = selectedReport?.id === rep.id;
                return (
                  <div
                    key={rep.id}
                    onClick={() => openInspector(rep)}
                    className={`p-4 cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#141414]' : 'hover:bg-[#141414]/40'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#292929] font-mono text-[10px] uppercase text-white">
                          {rep.targetType}
                        </span>
                        <span className="text-xs font-bold text-white truncate">
                          {rep.targetName || rep.targetId}
                        </span>
                      </div>
                      <AdminStatusBadge
                        tone={statusToTone(rep.status)}
                        label={rep.status.replace('_', ' ')}
                      />
                    </div>

                    <div className="text-xs text-[#D4D4D4] mt-1.5 font-medium">{rep.reason}</div>
                    {rep.details && (
                      <div className="text-[11px] text-[#707070] mt-1 line-clamp-2">
                        {rep.details}
                      </div>
                    )}

                    <div className="mt-2.5 flex items-center justify-between text-[10px] font-mono text-[#707070]">
                      <span>Reporter: {rep.reporterLabel || rep.reporterUid}</span>
                      <span>
                        {rep.resolvedAt
                          ? `Updated ${new Date(rep.resolvedAt).toLocaleString()}`
                          : 'Pending review'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Detail / Action Panel */}
        <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4 h-fit">
          {!selectedReport ? (
            <div className="py-10 text-center text-xs text-[#707070]">
              Select a report on the left to inspect details and take moderation action.
            </div>
          ) : (
            <form onSubmit={handleResolveSubmit} className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] font-mono uppercase text-[#707070]">
                    Report #{selectedReport.id}
                  </div>
                  <h3 className="text-sm font-bold text-white mt-0.5">
                    {selectedReport.targetName || selectedReport.targetId}
                  </h3>
                </div>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(selectedReport)}
                    className="p-1.5 rounded-lg bg-[#141414] border border-[#292929] text-red-400 hover:border-red-500/50 cursor-pointer"
                    title="Delete report (Owner only)"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              <div className="p-3 rounded-xl bg-[#141414] border border-[#292929] space-y-1.5 text-xs">
                <div className="font-semibold text-white">{selectedReport.reason}</div>
                <p className="text-[#A0A0A0] leading-relaxed">
                  {selectedReport.details || 'No extra details provided.'}
                </p>
                <div className="text-[10px] font-mono text-[#707070] pt-1">
                  Target ID: {selectedReport.targetId}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono uppercase text-[#707070] mb-1">
                  Resolution Status
                </label>
                <select
                  value={resolutionStatus}
                  onChange={(e) =>
                    setResolutionStatus(
                      e.target.value as 'open' | 'in_review' | 'resolved' | 'dismissed'
                    )
                  }
                  className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs font-mono text-white focus:outline-none focus:border-white"
                >
                  <option value="open">Open</option>
                  <option value="in_review">In Review</option>
                  <option value="resolved">Resolved</option>
                  <option value="dismissed">Dismissed</option>
                </select>
              </div>

              {selectedReport.targetType === 'user' && (
                <div>
                  <label className="block text-[11px] font-mono uppercase text-[#707070] mb-1.5">
                    Chained Account Action (Optional)
                  </label>
                  <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono">
                    <button
                      type="button"
                      onClick={() =>
                        setModerateUserAction(moderateUserAction === 'disable' ? '' : 'disable')
                      }
                      className={`inline-flex items-center justify-center gap-1 py-2 px-2 rounded-lg border cursor-pointer ${
                        moderateUserAction === 'disable'
                          ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold'
                          : 'bg-[#141414] border-[#292929] text-[#A0A0A0]'
                      }`}
                    >
                      <UserX size={12} />
                      <span>Disable</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setModerateUserAction(moderateUserAction === 'ban' ? '' : 'ban')
                      }
                      className={`inline-flex items-center justify-center gap-1 py-2 px-2 rounded-lg border cursor-pointer ${
                        moderateUserAction === 'ban'
                          ? 'bg-red-500/20 border-red-400 text-red-200 font-bold'
                          : 'bg-[#141414] border-[#292929] text-[#A0A0A0]'
                      }`}
                    >
                      <Ban size={12} />
                      <span>Ban</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setModerateUserAction(moderateUserAction === 'enable' ? '' : 'enable')
                      }
                      className={`inline-flex items-center justify-center gap-1 py-2 px-2 rounded-lg border cursor-pointer ${
                        moderateUserAction === 'enable'
                          ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 font-bold'
                          : 'bg-[#141414] border-[#292929] text-[#A0A0A0]'
                      }`}
                    >
                      <UserCheck size={12} />
                      <span>Restore</span>
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-mono uppercase text-[#707070] mb-1">
                  Resolution Note
                </label>
                <textarea
                  rows={3}
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="Document findings and moderation decision..."
                  className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs cursor-pointer disabled:opacity-50"
              >
                {submitting ? 'Applying Decision...' : 'Save Moderation Decision'}
              </button>
            </form>
          )}
        </div>
      </div>

      <AdminConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete Moderation Report"
        description={`Permanently delete report ${deleteTarget?.id || ''}? This action cannot be undone.`}
        confirmLabel="Delete Report"
        destructive
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
