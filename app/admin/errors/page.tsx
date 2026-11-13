'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertOctagon,
  RefreshCw,
  Loader2,
  Trash2,
  Search,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getAdminAuthHeaders } from '@/lib/admin/admin-auth';
import { SeverityBadge } from '@/components/admin/ui/AdminStatusBadge';
import { AdminConfirmModal } from '@/components/admin/ui/AdminConfirmModal';

interface ErrorLogRow {
  id: string;
  source: 'firestore' | 'runtime';
  severity: 'info' | 'warning' | 'error' | 'critical';
  category: string;
  provider: string;
  endpoint: string;
  code: string;
  statusCode: number | null;
  message: string;
  timestamp: string;
}

export default function AdminErrorsPage() {
  const { effectiveRole } = useAuth();
  const isOwner = effectiveRole === 'owner';
  const isMod = effectiveRole === 'mod';

  const [logs, setLogs] = useState<ErrorLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState('all');
  const [category, setCategory] = useState('all');
  const [provider, setProvider] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ErrorLogRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadErrors = useCallback(async () => {
    if (isMod) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      const params = new URLSearchParams({ severity, category, provider });
      if (searchQuery.trim()) {
        params.set('q', searchQuery.trim());
      }
      const res = await fetch(`/api/admin/errors?${params.toString()}`, {
        headers,
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Failed to load error logs (${res.status})`);
      }
      setLogs(Array.isArray(json.logs) ? json.logs : []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load error logs');
    } finally {
      setLoading(false);
    }
  }, [isMod, severity, category, provider, searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadErrors();
    }, 200);
    return () => clearTimeout(timer);
  }, [loadErrors]);

  const handleDeleteEntry = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/errors', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'delete', id: deleteTarget.id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to delete error log');
      }
      showToast(`Deleted error log ${deleteTarget.id}.`);
      setDeleteTarget(null);
      await loadErrors();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    setBusy(true);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/errors', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'clear' }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to clear error logs');
      }
      showToast(`Cleared ${json.deletedCount ?? 0} stored error logs.`);
      setConfirmClear(false);
      await loadErrors();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Clear failed');
    } finally {
      setBusy(false);
    }
  };

  if (isMod) {
    return (
      <div className="p-8 rounded-2xl bg-[#0A0A0A] border border-[#292929] max-w-xl mx-auto mt-8 text-center space-y-3">
        <div className="w-11 h-11 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto">
          <ShieldAlert size={20} />
        </div>
        <h2 className="text-base font-bold text-white">403 — Restricted to Admin &amp; Owner</h2>
        <p className="text-xs text-[#A0A0A0]">
          System error logs and diagnostic payloads are restricted to Administrator and Owner roles.
        </p>
      </div>
    );
  }

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
            Redacted Server &amp; Upstream Error Telemetry
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2 mt-0.5">
            <AlertOctagon size={19} />
            <span>System &amp; API Error Logs ({logs.length})</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Combined Firestore `/errorLogs` and in-memory runtime error events with automatic token/secret redaction.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isOwner && logs.some((l) => l.source === 'firestore') && (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-500/10 border border-red-500/30 hover:border-red-400 text-xs font-bold text-red-300 cursor-pointer"
            >
              <Trash2 size={13} />
              <span>Clear Stored Logs</span>
            </button>
          )}
          <button
            type="button"
            onClick={loadErrors}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Filters */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-[#707070]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search message, endpoint, code..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white"
          />
        </div>

        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs font-mono text-white focus:outline-none focus:border-white"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs font-mono text-white focus:outline-none focus:border-white"
        >
          <option value="all">All Categories</option>
          <option value="api">API</option>
          <option value="stream">Stream</option>
          <option value="artwork">Artwork</option>
          <option value="auth">Auth</option>
          <option value="database">Database</option>
          <option value="system">System</option>
        </select>

        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs font-mono text-white focus:outline-none focus:border-white"
        >
          <option value="all">All Providers</option>
          <option value="megaplay">MegaPlay</option>
          <option value="zokoanime">ZokoAnime</option>
          <option value="hoshika">Hoshika</option>
          <option value="anilist">AniList</option>
          <option value="fanart">Fanart.tv</option>
          <option value="aniskip">AniSkip</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center">
            <Loader2 size={24} className="animate-spin text-white" />
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <div className="text-sm font-bold text-white">No Error Logs Found</div>
            <p className="text-xs text-[#A0A0A0]">
              No stored or runtime errors match your active filters.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#292929]">
            {logs.map((log) => {
              const expanded = selectedId === log.id;
              return (
                <div key={log.id} className="p-4 space-y-2 hover:bg-[#141414]/30">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={log.severity} />
                      <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#292929] font-mono text-[10px] uppercase text-white">
                        {log.category}
                      </span>
                      <span className="font-mono text-xs font-bold text-white uppercase">
                        {log.provider}
                      </span>
                      {log.statusCode && (
                        <span className="font-mono text-[11px] text-[#A0A0A0]">
                          HTTP {log.statusCode}
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-[#707070] uppercase">
                        [{log.source}]
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-[#707070]">
                        {log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedId(expanded ? null : log.id)}
                        className="px-2.5 py-1 rounded-lg bg-[#141414] border border-[#292929] text-[11px] font-mono text-white hover:border-white cursor-pointer"
                      >
                        {expanded ? 'Hide' : 'Inspect'}
                      </button>
                      {isOwner && log.source === 'firestore' && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(log)}
                          className="p-1.5 rounded-lg bg-[#141414] border border-[#292929] text-red-400 hover:border-red-500/40 cursor-pointer"
                          title="Delete entry (Owner only)"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-[#D4D4D4] font-medium">{log.message}</div>

                  {expanded && (
                    <div className="p-3 rounded-xl bg-[#050505] border border-[#292929] font-mono text-[11px] text-[#A0A0A0] space-y-1">
                      <div>ID: {log.id}</div>
                      <div>Endpoint: {log.endpoint || '—'}</div>
                      <div>Code: {log.code || '—'}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AdminConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete Error Log Entry"
        description={`Remove stored error log ${deleteTarget?.id || ''}?`}
        confirmLabel="Delete Entry"
        destructive
        loading={busy}
        onConfirm={handleDeleteEntry}
        onCancel={() => setDeleteTarget(null)}
      />

      <AdminConfirmModal
        open={confirmClear}
        title="Clear All Stored Error Logs?"
        description="This permanently removes all persisted documents in Firestore /errorLogs. Runtime memory telemetry resets automatically on restart."
        confirmLabel="Clear Stored Logs"
        destructive
        loading={busy}
        onConfirm={handleClearAll}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
