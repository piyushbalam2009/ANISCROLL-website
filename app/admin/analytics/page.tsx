'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Users,
  Activity,
  Zap,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Database,
} from 'lucide-react';
import { getAdminAuthHeaders } from '@/lib/admin/admin-auth';
import { AdminKpiCard } from '@/components/admin/ui/AdminKpiCard';
import {
  AdminAreaChart,
  AdminBarChart,
  AdminDonutChart,
} from '@/components/admin/ui/AdminChart';

type TimeRangeKey = '24h' | '7d' | '30d' | '90d';

interface OverviewAnalyticsData {
  ok: boolean;
  range: TimeRangeKey;
  users?: {
    total: number;
    active: number;
    restricted: number;
    adminsCount?: number;
    roleBreakdown: { owner: number; admin: number; mod: number; member: number };
    registrationSeries: Array<{ label: string; count: number; cumulative: number }>;
  };
  artwork?: {
    total: number;
    validLogos: number;
    missingLogos: number;
    japaneseOnlyLogos: number;
    customLogos: number;
    manualOverrides: number;
    autoSelected: number;
    coveragePct: number;
  };
  telemetry?: {
    perfSummary: {
      totalRequests: number;
      totalErrors: number;
      errorRatePct: number;
      avgLatencyMs: number | null;
      p95LatencyMs: number | null;
      cacheHitRatePct: number;
    };
    providerTelemetry: Array<{
      provider: string;
      requests: number;
      errors: number;
      errorRatePct: number;
      cacheHitRatePct: number;
      p50Ms: number | null;
      p95Ms: number | null;
      lastError: string | null;
    }>;
    telemetrySeries: Array<{
      label: string;
      requests: number;
      errors: number;
      avgLatencyMs: number | null;
    }>;
    cacheStats: {
      size: number;
      hits: number;
      staleHits: number;
      misses: number;
      evictions: number;
    };
  };
}

export default function AdminAnalyticsPage() {
  const [range, setRange] = useState<TimeRangeKey>('7d');
  const [data, setData] = useState<OverviewAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      const [overviewRes, monitorRes] = await Promise.all([
        fetch(`/api/admin/overview?range=${range}`, { headers, cache: 'no-store' }),
        fetch('/api/admin/monitoring?probe=false', { headers, cache: 'no-store' }),
      ]);

      const overviewJson = await overviewRes.json().catch(() => null);
      const monitorJson = await monitorRes.json().catch(() => null);

      if (!overviewRes.ok || !overviewJson?.ok) {
        throw new Error(overviewJson?.error || `Failed to load analytics (${overviewRes.status})`);
      }

      const merged: OverviewAnalyticsData = {
        ...overviewJson,
        telemetry: overviewJson.telemetry || {
          perfSummary: monitorJson?.perfSummary,
          providerTelemetry: monitorJson?.providerTelemetry || [],
          telemetrySeries: monitorJson?.telemetrySeries || [],
          cacheStats: monitorJson?.cacheStats || {
            size: 0,
            hits: 0,
            staleHits: 0,
            misses: 0,
            evictions: 0,
          },
        },
      };
      setData(merged);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const userGrowthData = (data?.users?.registrationSeries || []).map((pt) => ({
    label: pt.label,
    value: pt.cumulative,
    secondaryValue: pt.count,
  }));

  const requestSeriesData = (data?.telemetry?.telemetrySeries || []).map((pt) => ({
    label: pt.label,
    value: pt.requests,
    secondaryValue: pt.errors,
  }));

  const latencyBarData = (data?.telemetry?.providerTelemetry || [])
    .filter((p) => typeof p.p50Ms === 'number')
    .map((p) => ({
      label: p.provider.toUpperCase(),
      value: p.p50Ms || 0,
    }));

  const roleSegments = data?.users
    ? [
        { label: 'Members', value: data.users.roleBreakdown.member, color: '#ffffff' },
        { label: 'Moderators', value: data.users.roleBreakdown.mod, color: '#a3a3a3' },
        { label: 'Admins', value: data.users.roleBreakdown.admin, color: '#6366f1' },
        { label: 'Owners', value: data.users.roleBreakdown.owner, color: '#22c55e' },
      ]
    : [];

  const artworkSegments = data?.artwork
    ? [
        { label: 'Valid Logos', value: data.artwork.validLogos, color: '#ffffff' },
        { label: 'Japanese Only', value: data.artwork.japaneseOnlyLogos, color: '#f59e0b' },
        { label: 'Missing / Fallback', value: data.artwork.missingLogos, color: '#ef4444' },
      ]
    : [];

  const perf = data?.telemetry?.perfSummary;
  const cacheStats = data?.telemetry?.cacheStats;

  return (
    <div className="space-y-6">
      {/* Header & Range Selector */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-[#707070]">
            Real-Time Platform Telemetry &amp; Community Growth
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2 mt-0.5">
            <BarChart3 size={19} />
            <span>Platform Analytics &amp; Provider Performance</span>
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-[#141414] border border-[#292929] p-1 text-xs font-mono">
            {(['24h', '7d', '30d', '90d'] as TimeRangeKey[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-3 py-1 rounded-lg uppercase cursor-pointer transition-colors ${
                  range === r ? 'bg-white text-black font-bold' : 'text-[#A0A0A0] hover:text-white'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={loadAnalytics}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {loading && !data ? (
        <div className="p-12 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex justify-center">
          <Loader2 size={24} className="animate-spin text-white" />
        </div>
      ) : (
        <>
          {/* Top KPI Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <AdminKpiCard
              label="Total Registered Users"
              value={data?.users?.total ?? 'Data unavailable'}
              sublabel={
                data?.users
                  ? `${data.users.active} active · ${data.users.restricted} restricted`
                  : undefined
              }
              icon={Users}
            />
            <AdminKpiCard
              label="Tracked API Requests"
              value={perf ? perf.totalRequests : 'Data unavailable'}
              sublabel={
                perf ? `${perf.errorRatePct}% error rate (${perf.totalErrors} errors)` : undefined
              }
              icon={Activity}
              statusTone={perf && perf.errorRatePct > 5 ? 'warn' : 'default'}
            />
            <AdminKpiCard
              label="Avg / p95 API Latency"
              value={
                perf && typeof perf.avgLatencyMs === 'number'
                  ? `${perf.avgLatencyMs}ms`
                  : 'Data unavailable'
              }
              sublabel={
                perf && typeof perf.p95LatencyMs === 'number'
                  ? `p95: ${perf.p95LatencyMs}ms`
                  : 'No latency samples yet'
              }
              icon={Zap}
            />
            <AdminKpiCard
              label="Server Cache Hit Rate"
              value={perf ? `${perf.cacheHitRatePct}%` : 'Data unavailable'}
              sublabel={
                cacheStats
                  ? `${cacheStats.size} keys · ${cacheStats.hits} hits`
                  : undefined
              }
              icon={Database}
            />
          </div>

          {/* Area Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">User Registration Growth</h3>
                  <p className="text-[11px] text-[#707070] font-mono">
                    Cumulative members vs new signups ({range})
                  </p>
                </div>
              </div>
              <AdminAreaChart
                data={userGrowthData}
                primaryLabel="Cumulative"
                secondaryLabel="New"
                emptyMessage="Data unavailable"
              />
            </div>

            <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">API Request &amp; Error Volume</h3>
                  <p className="text-[11px] text-[#707070] font-mono">
                    Server telemetry buckets ({range})
                  </p>
                </div>
              </div>
              <AdminAreaChart
                data={requestSeriesData}
                primaryLabel="Requests"
                secondaryLabel="Errors"
                emptyMessage="Data unavailable"
              />
            </div>
          </div>

          {/* Bar + Donuts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-white">Provider p50 Latency (ms)</h3>
              <AdminBarChart
                data={latencyBarData}
                primaryLabel="p50"
                valueSuffix="ms"
                emptyMessage="Data unavailable"
              />
            </div>

            <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-white">User Role Distribution</h3>
              <AdminDonutChart
                segments={roleSegments}
                centerValue={String(data?.users?.total ?? 0)}
                centerLabel="Users"
                emptyMessage="Data unavailable"
              />
            </div>

            <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-bold text-white">Artwork Logo Coverage</h3>
              <AdminDonutChart
                segments={artworkSegments}
                centerValue={data?.artwork ? `${data.artwork.coveragePct}%` : '0%'}
                centerLabel="Covered"
                emptyMessage="Data unavailable"
              />
            </div>
          </div>

          {/* Provider Telemetry Table */}
          <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Upstream Provider Telemetry Breakdown</h3>
              <span className="text-[11px] font-mono text-[#707070]">Window: {range}</span>
            </div>

            {!data?.telemetry?.providerTelemetry?.length ? (
              <div className="py-8 text-center text-xs font-mono text-[#707070]">
                Data unavailable
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#292929] text-[11px] font-mono uppercase text-[#707070]">
                      <th className="py-2.5 px-3">Provider</th>
                      <th className="py-2.5 px-3">Requests</th>
                      <th className="py-2.5 px-3">Errors</th>
                      <th className="py-2.5 px-3">Error Rate</th>
                      <th className="py-2.5 px-3">Cache Hit Rate</th>
                      <th className="py-2.5 px-3">p50 Latency</th>
                      <th className="py-2.5 px-3">p95 Latency</th>
                      <th className="py-2.5 px-3">Last Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#292929] font-mono tabular-nums">
                    {data.telemetry.providerTelemetry.map((row) => (
                      <tr key={row.provider} className="hover:bg-[#141414]/40">
                        <td className="py-2.5 px-3 font-bold text-white uppercase">
                          {row.provider}
                        </td>
                        <td className="py-2.5 px-3 text-white">{row.requests}</td>
                        <td className="py-2.5 px-3 text-[#A0A0A0]">{row.errors}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={
                              row.errorRatePct > 5 ? 'text-amber-300 font-bold' : 'text-[#A0A0A0]'
                            }
                          >
                            {row.errorRatePct}%
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[#A0A0A0]">{row.cacheHitRatePct}%</td>
                        <td className="py-2.5 px-3 text-white">
                          {row.p50Ms !== null ? `${row.p50Ms}ms` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-white">
                          {row.p95Ms !== null ? `${row.p95Ms}ms` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-[#707070] max-w-[260px] truncate">
                          {row.lastError ? (
                            <span className="inline-flex items-center gap-1 text-amber-300">
                              <AlertTriangle size={11} />
                              {row.lastError}
                            </span>
                          ) : (
                            'None'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
