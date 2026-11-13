'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  RefreshCw,
  Clock,
  Server,
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  Film,
  Tv,
} from 'lucide-react';
import { getAdminAuthHeaders } from '@/lib/admin/admin-auth';
import { AdminStatusBadge, StatusTone } from '@/components/admin/ui/AdminStatusBadge';
import { AdminBarChart } from '@/components/admin/ui/AdminChart';

interface LiveProbe {
  provider: 'aniscroll' | 'hoshika' | 'anilist' | 'aniskip' | 'fanart' | 'megaplay' | 'zokoanime';
  name: string;
  description: string;
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

interface StreamHistoryLog {
  id: string;
  provider: string;
  endpoint: string;
  status: 'operational' | 'degraded' | 'outage';
  responseTimeMs: number;
  statusCode: number;
  errorMessage?: string;
  checkedAt: string;
}

interface StreamTestResult {
  ok: boolean;
  provider: 'megaplay' | 'zokoanime';
  format: string;
  anilistId: number;
  episode: number;
  audioType: 'sub' | 'dub';
  playable: boolean;
  url: string;
  tracksCount: number;
  subtitlesCount: number;
  latencyMs: number;
}

function mapStatusTone(status: string): StatusTone {
  if (status === 'operational') return 'operational';
  if (status === 'degraded') return 'degraded';
  return 'outage';
}

export default function AdminStreamingMonitorPage() {
  const [probes, setProbes] = useState<LiveProbe[]>([]);
  const [providerTelemetry, setProviderTelemetry] = useState<ProviderTelemetryRow[]>([]);
  const [historyLogs, setHistoryLogs] = useState<StreamHistoryLog[]>([]);
  const [fanartKeyConfigured, setFanartKeyConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Stream endpoint tester state
  const [testAnilistId, setTestAnilistId] = useState('21');
  const [testEpisode, setTestEpisode] = useState('1');
  const [testAudio, setTestAudio] = useState<'sub' | 'dub'>('sub');
  const [testFormat, setTestFormat] = useState<'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL'>('TV');
  const [testingStream, setTestingStream] = useState(false);
  const [testResult, setTestResult] = useState<StreamTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const loadDiagnostics = useCallback(async (persistSuite = false) => {
    setProbing(true);
    setErrorMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      if (persistSuite) {
        await fetch('/api/admin/streaming', {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'log_probes' }),
        });
      }

      const res = await fetch('/api/admin/streaming', {
        headers,
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(data?.error || `Failed to load streaming telemetry (${res.status})`);
      }

      setProbes(Array.isArray(data.probes) ? data.probes : []);
      setProviderTelemetry(Array.isArray(data.providerTelemetry) ? data.providerTelemetry : []);
      setHistoryLogs(Array.isArray(data.historyLogs) ? data.historyLogs : []);
      setFanartKeyConfigured(Boolean(data.fanartApiKeyConfigured));
      setCheckedAt(data.checkedAt || new Date().toISOString());
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Streaming diagnostics probe failed');
    } finally {
      setLoading(false);
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    loadDiagnostics(false);
  }, [loadDiagnostics]);

  const handleTestStream = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestingStream(true);
    setTestError(null);
    setTestResult(null);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/streaming', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'test_stream',
          anilistId: Number(testAnilistId),
          episode: Number(testEpisode),
          audioType: testAudio,
          format: testFormat,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Stream test failed (${res.status})`);
      }
      setTestResult(data as StreamTestResult);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Failed to test stream endpoint');
    } finally {
      setTestingStream(false);
    }
  };

  const avgLatency =
    probes.length > 0
      ? Math.round(probes.reduce((acc, p) => acc + p.responseTimeMs, 0) / probes.length)
      : 0;

  const operationalCount = probes.filter((p) => p.status === 'operational').length;

  const latencyChartData = probes.map((p) => ({
    label: p.provider.toUpperCase(),
    value: p.responseTimeMs,
  }));

  const expectedProviderForTest = testFormat === 'MOVIE' ? 'ZokoAnime' : 'MegaPlay';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-[#707070]">
            MegaPlay (Series) · ZokoAnime (Movies) · Upstream APIs
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2 mt-0.5">
            <Activity size={19} />
            <span>Streaming Providers & Playback Routing Diagnostics</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-1">
            Live probes for MegaPlay, ZokoAnime, Hoshika, AniList, AniSkip, and Fanart.tv alongside live Sub/Dub stream resolution testing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs font-mono tabular-nums">
            Healthy:{' '}
            <span className="font-bold text-white">
              {probes.length > 0 ? `${operationalCount}/${probes.length}` : '—'}
            </span>
            <span className="mx-2 text-[#444]">|</span>
            Avg:{' '}
            <span className="font-bold text-white">
              {probes.length > 0 ? `${avgLatency}ms` : '—'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => loadDiagnostics(true)}
            disabled={probing}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={probing ? 'animate-spin' : ''} />
            <span>{probing ? 'Probing Providers...' : 'Run & Persist Probe Suite'}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Routing Rules & Live Stream Endpoint Tester */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white">Live Stream Endpoint Tester</h3>
              <p className="text-xs text-[#A0A0A0]">
                Tests real backend stream resolution without exposing signed player secrets or tokens.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-[#141414] border border-[#292929] text-[11px] font-mono text-white">
              Auto-Route: {expectedProviderForTest}
            </span>
          </div>

          <form onSubmit={handleTestStream} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-[11px] font-mono uppercase text-[#707070] mb-1">
                AniList ID
              </label>
              <input
                type="number"
                min={1}
                required
                value={testAnilistId}
                onChange={(e) => setTestAnilistId(e.target.value)}
                placeholder="21"
                className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs text-white font-mono focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono uppercase text-[#707070] mb-1">
                Episode #
              </label>
              <input
                type="number"
                min={1}
                required
                value={testEpisode}
                onChange={(e) => setTestEpisode(e.target.value)}
                placeholder="1"
                className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs text-white font-mono focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono uppercase text-[#707070] mb-1">
                Content Format
              </label>
              <select
                value={testFormat}
                onChange={(e) => setTestFormat(e.target.value as typeof testFormat)}
                className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs text-white font-mono focus:outline-none"
              >
                <option value="TV">TV (MegaPlay)</option>
                <option value="OVA">OVA (MegaPlay)</option>
                <option value="ONA">ONA (MegaPlay)</option>
                <option value="SPECIAL">SPECIAL (MegaPlay)</option>
                <option value="MOVIE">MOVIE (ZokoAnime)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-mono uppercase text-[#707070] mb-1">
                Audio Track
              </label>
              <select
                value={testAudio}
                onChange={(e) => setTestAudio(e.target.value as 'sub' | 'dub')}
                className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs text-white font-mono focus:outline-none"
              >
                <option value="sub">SUB</option>
                <option value="dub">DUB</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={testingStream}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs cursor-pointer disabled:opacity-50"
              >
                {testingStream ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Play size={14} />
                )}
                <span>{testingStream ? 'Testing...' : 'Test Stream'}</span>
              </button>
            </div>
          </form>

          {testError && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 font-mono">
              {testError}
            </div>
          )}

          {testResult && (
            <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-white">
                  {testResult.playable ? (
                    <CheckCircle2 size={15} className="text-emerald-400" />
                  ) : (
                    <XCircle size={15} className="text-red-400" />
                  )}
                  <span>
                    {testResult.playable ? 'Stream Resolved' : 'No Playable Stream Found'} —{' '}
                    <span className="font-mono uppercase">{testResult.provider}</span>
                  </span>
                </div>
                <AdminStatusBadge
                  tone={testResult.playable ? 'operational' : 'outage'}
                  label={testResult.playable ? 'PLAYABLE' : 'UNAVAILABLE'}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono text-[#A0A0A0] tabular-nums">
                <div>
                  Format: <span className="text-white">{testResult.format}</span>
                </div>
                <div>
                  Sources: <span className="text-white">{testResult.tracksCount}</span>
                </div>
                <div>
                  Subtitles: <span className="text-white">{testResult.subtitlesCount}</span>
                </div>
                <div>
                  Latency: <span className="text-white">{testResult.latencyMs}ms</span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-black border border-[#292929] font-mono text-[11px] text-[#A0A0A0] truncate">
                {testResult.url || 'No stream URL returned (signed URLs are redacted for safety)'}
              </div>
            </div>
          )}
        </div>

        {/* Provider Routing Policy Card + Latency Chart */}
        <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-white">Provider Routing Matrix</h3>
          <div className="space-y-2.5 text-xs">
            <div className="p-3 rounded-xl bg-[#141414] border border-[#292929] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Tv size={15} className="text-white shrink-0" />
                <div>
                  <div className="font-semibold text-white">Anime Series (TV/OVA/ONA)</div>
                  <div className="text-[11px] font-mono text-[#707070]">/api/watch/megaplay/...</div>
                </div>
              </div>
              <AdminStatusBadge tone="operational" label="MegaPlay" />
            </div>

            <div className="p-3 rounded-xl bg-[#141414] border border-[#292929] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Film size={15} className="text-white shrink-0" />
                <div>
                  <div className="font-semibold text-white">Anime Movies</div>
                  <div className="text-[11px] font-mono text-[#707070]">/api/watch/zokoanime/...</div>
                </div>
              </div>
              <AdminStatusBadge tone="operational" label="ZokoAnime" />
            </div>

            <div className="p-3 rounded-xl bg-[#141414] border border-[#292929] flex items-center justify-between text-[11px] font-mono">
              <span className="text-[#A0A0A0]">FANART_API_KEY</span>
              <span className="text-white font-bold">
                {fanartKeyConfigured ? 'CONFIGURED' : 'CURATED FALLBACK'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Latency Comparison Chart */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Live Provider Probe Latency (ms)</h3>
          {checkedAt && (
            <span className="text-[11px] font-mono text-[#707070]">
              Checked {new Date(checkedAt).toLocaleTimeString()}
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
                  <div className="flex items-center gap-2 min-w-0">
                    <Server size={15} className="text-white shrink-0" />
                    <h3 className="text-sm font-bold text-white truncate">{probe.name}</h3>
                  </div>
                  <AdminStatusBadge tone={mapStatusTone(probe.status)} label={probe.status} />
                </div>

                <p className="text-xs text-[#A0A0A0] leading-relaxed">{probe.description}</p>

                <div className="p-2.5 rounded-lg bg-[#141414] border border-[#292929] font-mono text-[11px] text-[#A0A0A0] truncate">
                  {probe.endpoint}
                </div>

                {probe.errorMessage && (
                  <div className="text-[11px] font-mono text-amber-300 truncate">
                    {probe.errorMessage}
                  </div>
                )}
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
        </div>
      )}

      {/* Runtime Provider Telemetry Table */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Runtime Process Telemetry</h3>
          <span className="text-[11px] font-mono text-[#707070]">Live Server Metrics</span>
        </div>
        {providerTelemetry.length === 0 ? (
          <div className="text-xs font-mono text-[#707070] py-6 text-center">Data unavailable</div>
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
                {providerTelemetry.map((row) => (
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

      {/* Historical Probe Log Table */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">
            Recorded Health Check History ({historyLogs.length})
          </h3>
          <span className="text-[11px] font-mono text-[#707070]">Stored in /streamingLogs</span>
        </div>

        {historyLogs.length === 0 ? (
          <div className="text-xs text-[#707070] py-6 text-center">
            Click &ldquo;Run &amp; Persist Probe Suite&rdquo; above to save provider latency snapshots to Firestore.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#292929] text-[11px] font-mono uppercase text-[#707070]">
                  <th className="py-2.5 px-3">Provider</th>
                  <th className="py-2.5 px-3">Endpoint</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Latency</th>
                  <th className="py-2.5 px-3">HTTP</th>
                  <th className="py-2.5 px-3 text-right">Checked At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#292929] font-mono">
                {historyLogs.slice(0, 20).map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-3 font-bold text-white uppercase">{log.provider}</td>
                    <td className="py-2.5 px-3 text-[#A0A0A0] truncate max-w-[260px]">
                      {log.endpoint}
                    </td>
                    <td className="py-2.5 px-3">
                      <AdminStatusBadge tone={mapStatusTone(log.status)} label={log.status} />
                    </td>
                    <td className="py-2.5 px-3 text-white tabular-nums">
                      {log.responseTimeMs} ms
                    </td>
                    <td className="py-2.5 px-3 text-[#A0A0A0] tabular-nums">
                      {log.statusCode}
                    </td>
                    <td className="py-2.5 px-3 text-right text-[#707070]">
                      {log.checkedAt ? new Date(log.checkedAt).toLocaleString() : '—'}
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
