'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Server,
  Loader2,
} from 'lucide-react';
import { getAdminAuthHeaders } from '@/lib/admin/admin-auth';
import {
  StreamingMonitorLogEntry,
  listStreamingMonitorLogs,
  recordStreamingMonitorLog,
} from '@/lib/admin/admin-firestore';

interface LiveProbe {
  provider: 'aniscroll' | 'hoshika' | 'anilist' | 'aniskip' | 'fanart';
  name: string;
  description: string;
  endpoint: string;
  status: 'operational' | 'degraded' | 'outage';
  responseTimeMs: number;
  statusCode: number;
  errorMessage: string;
  checkedAt: string;
}

export default function AdminStreamingMonitorPage() {
  const [probes, setProbes] = useState<LiveProbe[]>([]);
  const [historyLogs, setHistoryLogs] = useState<StreamingMonitorLogEntry[]>([]);
  const [fanartKeyConfigured, setFanartKeyConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);

  const runLiveDiagnostics = useCallback(async (persistToFirestore = false) => {
    setProbing(true);
    try {
      const headers = await getAdminAuthHeaders();
      const [res, existingLogs] = await Promise.all([
        fetch('/api/admin/streaming', { headers }),
        listStreamingMonitorLogs(30).catch(() => []),
      ]);

      if (res.ok) {
        const data = await res.json();
        const liveProbes: LiveProbe[] = data.probes || [];
        setProbes(liveProbes);
        setFanartKeyConfigured(Boolean(data.fanartApiKeyConfigured));

        if (persistToFirestore) {
          for (const p of liveProbes) {
            await recordStreamingMonitorLog({
              provider: p.provider,
              endpoint: p.endpoint,
              status: p.status,
              responseTimeMs: p.responseTimeMs,
              statusCode: p.statusCode,
              errorMessage: p.errorMessage,
              checkedAt: p.checkedAt,
            }).catch(() => {});
          }
          const refreshedLogs = await listStreamingMonitorLogs(30).catch(() => []);
          setHistoryLogs(refreshedLogs);
        } else {
          setHistoryLogs(existingLogs);
        }
      }
    } catch (error) {
      console.error('Streaming diagnostics probe failed:', error);
    } finally {
      setLoading(false);
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    runLiveDiagnostics(false);
  }, [runLiveDiagnostics]);

  const avgLatency =
    probes.length > 0
      ? Math.round(
          probes.reduce((acc, p) => acc + p.responseTimeMs, 0) / probes.length
        )
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-[#707070]">
            Upstream API & HLS Telemetry
          </div>
          <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2 mt-0.5">
            <Activity size={20} />
            <span>Streaming & Metadata Provider Health Monitor</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-1">
            Live server-side latency and status probes for Hoshika, AniScroll HLS, AniList GraphQL, AniSkip, and Fanart.tv.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs font-mono">
            Avg Latency:{' '}
            <span className="font-bold text-white tabular-nums">
              {avgLatency}ms
            </span>
          </div>

          <button
            type="button"
            onClick={() => runLiveDiagnostics(true)}
            disabled={probing}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={probing ? 'animate-spin' : ''} />
            <span>{probing ? 'Probing Providers...' : 'Run & Log Health Check'}</span>
          </button>
        </div>
      </div>

      {/* Provider Health Cards */}
      {loading ? (
        <div className="p-12 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col items-center justify-center space-y-3">
          <Loader2 size={24} className="animate-spin text-white" />
          <div className="text-xs font-mono uppercase tracking-wider text-[#A0A0A0]">
            Executing Live Upstream Probes...
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {probes.map((probe) => (
            <div
              key={probe.provider}
              className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Server size={15} className="text-white" />
                    <h3 className="text-sm font-bold text-white">{probe.name}</h3>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase inline-flex items-center gap-1 ${
                      probe.status === 'operational'
                        ? 'bg-white text-black'
                        : 'bg-[#141414] border border-white/40 text-white'
                    }`}
                  >
                    {probe.status === 'operational' ? (
                      <CheckCircle2 size={11} />
                    ) : probe.status === 'degraded' ? (
                      <AlertTriangle size={11} />
                    ) : (
                      <XCircle size={11} />
                    )}
                    {probe.status}
                  </span>
                </div>

                <p className="text-xs text-[#A0A0A0] leading-relaxed">
                  {probe.description}
                </p>

                <div className="p-2.5 rounded-lg bg-[#141414] border border-[#292929] font-mono text-[11px] text-[#A0A0A0] truncate">
                  {probe.endpoint}
                </div>
              </div>

              <div className="pt-3 border-t border-[#292929] flex items-center justify-between text-xs font-mono tabular-nums">
                <span className="inline-flex items-center gap-1 text-[#A0A0A0]">
                  <Clock size={12} />
                  <span>{probe.responseTimeMs} ms</span>
                </span>
                <span className="text-white font-bold">
                  HTTP {probe.statusCode || 'ERR'}
                </span>
              </div>
            </div>
          ))}

          {/* Fanart.tv Configuration Status Card */}
          <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">
                  Fanart.tv Registry & Proxy Engine
                </h3>
                <span className="px-2 py-0.5 rounded bg-white text-black font-mono text-[10px] font-bold uppercase">
                  ACTIVE
                </span>
              </div>
              <p className="text-xs text-[#A0A0A0] leading-relaxed">
                Curated Fanart.tv v3 HDTVLogo/ClearLogo registry + live API key integration + image proxy (`/api/image-proxy`).
              </p>
            </div>

            <div className="pt-3 border-t border-[#292929] flex items-center justify-between text-xs font-mono">
              <span className="text-[#A0A0A0]">FANART_API_KEY:</span>
              <span className="text-white font-bold">
                {fanartKeyConfigured
                  ? 'LIVE KEY CONFIGURED'
                  : 'CURATED + FALLBACK MODE'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Historical Probe Log Table */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">
            Recorded Health Check History ({historyLogs.length})
          </h3>
          <span className="text-[11px] font-mono text-[#707070]">
            Stored in /streamingLogs
          </span>
        </div>

        {historyLogs.length === 0 ? (
          <div className="text-xs text-[#707070] py-6 text-center">
            Click &ldquo;Run & Log Health Check&rdquo; above to persist provider latency snapshots to Firestore.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#292929] text-[11px] font-mono uppercase text-[#A0A0A0]">
                  <th className="py-2.5 px-3">Provider</th>
                  <th className="py-2.5 px-3">Endpoint</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Latency</th>
                  <th className="py-2.5 px-3">HTTP</th>
                  <th className="py-2.5 px-3 text-right">Checked At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#292929] font-mono">
                {historyLogs.slice(0, 15).map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-3 font-bold text-white uppercase">
                      {log.provider}
                    </td>
                    <td className="py-2.5 px-3 text-[#A0A0A0] truncate max-w-[260px]">
                      {log.endpoint}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded bg-[#141414] border border-[#292929] text-[10px] uppercase text-white">
                        {log.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-white tabular-nums">
                      {log.responseTimeMs} ms
                    </td>
                    <td className="py-2.5 px-3 text-[#A0A0A0] tabular-nums">
                      {log.statusCode}
                    </td>
                    <td className="py-2.5 px-3 text-right text-[#707070]">
                      {new Date(log.checkedAt).toLocaleString()}
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
