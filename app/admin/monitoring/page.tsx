'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Server,
  RefreshCw,
  Loader2,
  Clock,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { getAdminAuthHeaders } from '@/lib/admin/admin-auth';
import { AdminStatusBadge, StatusTone } from '@/components/admin/ui/AdminStatusBadge';
import { AdminBarChart } from '@/components/admin/ui/AdminChart';

interface ServiceHealthProbe {
  id: string;
  name: string;
  category: 'metadata' | 'streaming' | 'artwork' | 'storage' | 'database';
  endpoint: string;
  status: 'operational' | 'degraded' | 'outage';
  responseTimeMs: number;
  statusCode: number;
  errorMessage: string;
  checkedAt: string;
}

interface ProviderTelemetryRow {
  provider: string;
  requests: number;
  errors: number;
  errorRatePct: number;
  cacheHitRatePct: number;
  p50Ms: number | null;
  p95Ms: number | null;
  lastError: string | null;
}

interface MonitoringResponse {
  ok: boolean;
  checkedAt: string;
  probes: ServiceHealthProbe[];
  providerTelemetry: ProviderTelemetryRow[];
  environment: {
    fanartConfigured: boolean;
    supabaseConfigured: boolean;
    firebaseAdminConfigured: boolean;
  };
}

function mapTone(status: string): StatusTone {
  if (status === 'operational') return 'operational';
  if (status === 'degraded') return 'degraded';
  return 'outage';
}

export default function AdminMonitoringPage() {
  const [data, setData] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningSuite, setRunningSuite] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadMonitoring = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/monitoring?probe=true', {
        headers,
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Failed to load system probes (${res.status})`);
      }
      setData(json as MonitoringResponse);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Monitoring probe failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMonitoring();
  }, [loadMonitoring]);

  const handleRunAndRecordSuite = async () => {
    setRunningSuite(true);
    setErrorMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/monitoring', {
        method: 'POST',
        headers,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Probe suite failed (${res.status})`);
      }
      setData((prev) =>
        prev
          ? { ...prev, checkedAt: json.checkedAt, probes: json.probes }
          : ({
              ok: true,
              checkedAt: json.checkedAt,
              probes: json.probes,
              providerTelemetry: [],
              environment: {
                fanartConfigured: false,
                supabaseConfigured: false,
                firebaseAdminConfigured: false,
              },
            } as MonitoringResponse)
      );
      const degraded = (json.probes as ServiceHealthProbe[]).filter(
        (p) => p.status !== 'operational'
      ).length;
      showToast(
        degraded === 0
          ? 'All upstream services passed health probes.'
          : `Probe suite completed (${degraded} degraded/outage events logged).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to run probe suite');
    } finally {
      setRunningSuite(false);
    }
  };

  const probes = data?.probes || [];
  const latencyChartData = probes.map((p) => ({
    label: p.id.toUpperCase(),
    value: p.responseTimeMs,
  }));

  const operationalCount = probes.filter((p) => p.status === 'operational').length;

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
            Real-Time Infrastructure &amp; API Availability
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2 mt-0.5">
            <Server size={19} />
            <span>API &amp; System Health Monitoring</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Live probes for Hoshika, AniList, MegaPlay, ZokoAnime, AniSkip, Fanart.tv CDN, Firestore REST, and Supabase Storage.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs font-mono tabular-nums">
            Operational:{' '}
            <span className="font-bold text-white">
              {probes.length > 0 ? `${operationalCount}/${probes.length}` : '—'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleRunAndRecordSuite}
            disabled={runningSuite || loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={runningSuite ? 'animate-spin' : ''} />
            <span>{runningSuite ? 'Running Suite...' : 'Run Live Probe Suite'}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Environment Readiness Flags (Booleans only, zero secrets) */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-bold text-white">
          <ShieldCheck size={16} />
          <span>Server Integration Readiness</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#141414] border border-[#292929]">
            <span className="text-[#A0A0A0]">Fanart API Key:</span>
            <AdminStatusBadge
              tone={data?.environment?.fanartConfigured ? 'operational' : 'degraded'}
              label={data?.environment?.fanartConfigured ? 'Configured' : 'Fallback'}
            />
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#141414] border border-[#292929]">
            <span className="text-[#A0A0A0]">Supabase Storage:</span>
            <AdminStatusBadge
              tone={data?.environment?.supabaseConfigured ? 'operational' : 'degraded'}
              label={data?.environment?.supabaseConfigured ? 'Configured' : 'Unconfigured'}
            />
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#141414] border border-[#292929]">
            <span className="text-[#A0A0A0]">Firebase Admin SDK:</span>
            <AdminStatusBadge
              tone={data?.environment?.firebaseAdminConfigured ? 'operational' : 'degraded'}
              label={data?.environment?.firebaseAdminConfigured ? 'Configured' : 'REST Fallback'}
            />
          </div>
        </div>
      </div>

      {/* Latency Bar Chart */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Upstream Endpoint Latency (ms)</h3>
          {data?.checkedAt && (
            <span className="text-[11px] font-mono text-[#707070]">
              Checked {new Date(data.checkedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        <AdminBarChart
          data={latencyChartData}
          primaryLabel="Latency"
          valueSuffix="ms"
          emptyMessage={loading ? 'Running probes...' : 'Data unavailable'}
        />
      </div>

      {/* Service Grid */}
      {loading ? (
        <div className="p-12 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex justify-center">
          <Loader2 size={24} className="animate-spin text-white" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {probes.map((probe) => (
            <div
              key={probe.id}
              className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-4 flex flex-col justify-between gap-3"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono uppercase text-[#707070]">
                    {probe.category}
                  </span>
                  <AdminStatusBadge tone={mapTone(probe.status)} label={probe.status} />
                </div>
                <h3 className="text-sm font-bold text-white">{probe.name}</h3>
                <div className="p-2 rounded-lg bg-[#141414] border border-[#292929] font-mono text-[10px] text-[#A0A0A0] truncate">
                  {probe.endpoint}
                </div>
                {probe.errorMessage && (
                  <div className="text-[11px] font-mono text-amber-300 truncate flex items-center gap-1">
                    <AlertTriangle size={11} className="shrink-0" />
                    <span className="truncate">{probe.errorMessage}</span>
                  </div>
                )}
              </div>

              <div className="pt-2.5 border-t border-[#292929] flex items-center justify-between text-[11px] font-mono tabular-nums">
                <span className="inline-flex items-center gap-1 text-[#A0A0A0]">
                  <Clock size={11} />
                  {probe.responseTimeMs}ms
                </span>
                <span className="text-white font-bold">HTTP {probe.statusCode || 'ERR'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Provider Telemetry Table */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-white">Runtime Provider Telemetry</h3>
        {!data?.providerTelemetry?.length ? (
          <div className="py-6 text-center text-xs font-mono text-[#707070]">Data unavailable</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#292929] text-[11px] font-mono uppercase text-[#707070]">
                  <th className="py-2.5 px-3">Provider</th>
                  <th className="py-2.5 px-3">Requests</th>
                  <th className="py-2.5 px-3">Errors</th>
                  <th className="py-2.5 px-3">Error Rate</th>
                  <th className="py-2.5 px-3">Cache Hit</th>
                  <th className="py-2.5 px-3">p50</th>
                  <th className="py-2.5 px-3">p95</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#292929] font-mono tabular-nums">
                {data.providerTelemetry.map((row) => (
                  <tr key={row.provider}>
                    <td className="py-2.5 px-3 font-bold text-white uppercase">{row.provider}</td>
                    <td className="py-2.5 px-3 text-white">{row.requests}</td>
                    <td className="py-2.5 px-3 text-[#A0A0A0]">{row.errors}</td>
                    <td className="py-2.5 px-3 text-[#A0A0A0]">{row.errorRatePct}%</td>
                    <td className="py-2.5 px-3 text-[#A0A0A0]">{row.cacheHitRatePct}%</td>
                    <td className="py-2.5 px-3 text-white">
                      {row.p50Ms !== null ? `${row.p50Ms}ms` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-white">
                      {row.p95Ms !== null ? `${row.p95Ms}ms` : '—'}
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
