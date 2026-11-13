'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Users,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  Flag,
  Activity,
  ArrowRight,
  RefreshCw,
  ShieldCheck,
  Database,
  Clock,
  Bug,
  Megaphone,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getAdminAuthHeaders } from '@/lib/admin/admin-auth';
import { ResilientImage } from '@/components/ui/ResilientImage';
import { RoleBadge } from '@/components/ui/RoleBadge';
import { AdminKpiCard } from '@/components/admin/ui/AdminKpiCard';
import {
  AdminAreaChart,
  AdminBarChart,
  AdminDonutChart,
  AdminChartEmpty,
} from '@/components/admin/ui/AdminChart';
import { AdminStatusBadge } from '@/components/admin/ui/AdminStatusBadge';

type TimeRangeKey = '24h' | '7d' | '30d' | '90d';

interface OverviewResponse {
  ok: boolean;
  range: TimeRangeKey;
  scopedRole: 'owner' | 'admin' | 'mod' | 'member';
  users: {
    total: number;
    active: number;
    restricted: number;
    adminsCount?: number;
    roleBreakdown: {
      owner: number;
      admin: number;
      mod: number;
      member: number;
    };
    registrationSeries: Array<{
      label: string;
      count: number;
      cumulative: number;
    }>;
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
    missingSamples: Array<Record<string, any>>;
  };
  announcements?: {
    total: number;
    published: number;
  };
  moderation: {
    total: number;
    open: number;
    resolved: number;
    recentQueue: Array<Record<string, any>>;
  };
  telemetry?: {
    perfSummary: {
      totalRequests: number;
      avgLatencyMs: number;
      p95LatencyMs: number;
      errorRatePct: number;
      cacheHitRatePct: number;
      uptimeSeconds: number;
    };
    providerTelemetry: Array<{
      provider: string;
      requests: number;
      avgLatencyMs: number;
      p95LatencyMs: number;
      errorRatePct: number;
      cacheHitRatePct: number;
    }>;
    telemetrySeries: Array<{
      label: string;
      requests: number;
      errors: number;
      avgLatencyMs: number;
    }>;
    cacheStats: {
      size: number;
      hits: number;
      staleHits: number;
      misses: number;
      evictions: number;
    };
    artworkCacheStats: {
      resolvedSize: number;
      overrideSize: number;
    };
    recentStreamLogs: Array<Record<string, any>>;
    storedErrorsCount: number;
    inMemoryErrorsCount: number;
  };
  activity: {
    recent: Array<Record<string, any>>;
    recentArtworkAudits?: Array<Record<string, any>>;
    totalCount: number;
  };
}

export default function AdminOverviewPage() {
  const { effectiveRole } = useAuth();
  const [range, setRange] = useState<TimeRangeKey>('7d');
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async (selectedRange: TimeRangeKey) => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch(`/api/admin/overview?range=${selectedRange}`, {
        headers,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Failed to load dashboard (${res.status})`);
      }
      setData(json as OverviewResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard telemetry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview(range);
  }, [loadOverview, range]);

  const isMod = data?.scopedRole === 'mod' || effectiveRole === 'mod';

  const growthData = (data?.users?.registrationSeries || []).map((p) => ({
    label: p.label,
    value: p.cumulative,
    secondaryValue: p.count,
  }));

  const telemetrySeriesData = (data?.telemetry?.telemetrySeries || []).map((p) => ({
    label: p.label,
    value: p.requests,
    secondaryValue: p.errors,
  }));

  const providerLatencyBars = (data?.telemetry?.providerTelemetry || []).map((p) => ({
    label: p.provider.toUpperCase(),
    value: p.avgLatencyMs,
  }));

  const artworkSegments = data?.artwork
    ? [
        {
          label: 'English / Valid Logos',
          value: Math.max(
            0,
            data.artwork.validLogos -
              data.artwork.japaneseOnlyLogos -
              data.artwork.customLogos
          ),
          color: '#FFFFFF',
        },
        {
          label: 'Custom Uploads',
          value: data.artwork.customLogos,
          color: '#A3A3A3',
        },
        {
          label: 'Japanese Only',
          value: data.artwork.japaneseOnlyLogos,
          color: '#737373',
        },
        {
          label: 'Missing / Fallback',
          value: data.artwork.missingLogos,
          color: '#3F3F46',
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Top Operations Header */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#707070]">
            <span>AniScroll Operations Center</span>
            <RoleBadge role={effectiveRole} size="sm" />
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
            {isMod ? 'Moderation & Community Overview' : 'Platform Analytics & Operations'}
          </h2>
          <p className="text-xs text-[#A0A0A0]">
            {isMod
              ? 'Scoped view for member safety, open moderation reports, and user activity.'
              : 'Real-time user telemetry, Fanart.tv logo coverage, streaming provider latency, and audit trails.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div
            className="inline-flex rounded-xl bg-[#141414] border border-[#292929] p-1 text-xs"
            role="group"
            aria-label="Dashboard time range"
          >
            {(['24h', '7d', '30d', '90d'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-2.5 py-1.5 rounded-lg font-mono uppercase transition-colors cursor-pointer ${
                  range === r
                    ? 'bg-white text-black font-bold'
                    : 'text-[#A0A0A0] hover:text-white'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => loadOverview(range)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          {!isMod && (
            <Link
              href="/admin/analytics"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs transition-colors"
            >
              <span>Deep Analytics</span>
              <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => loadOverview(range)}
            className="px-3 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 font-mono uppercase text-[11px] cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="p-12 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col items-center justify-center space-y-3">
          <Loader2 size={24} className="animate-spin text-white" />
          <div className="text-xs font-mono uppercase tracking-wider text-[#A0A0A0]">
            Aggregating Live Platform Telemetry...
          </div>
        </div>
      ) : data ? (
        <>
          {/* KPI Grid */}
          {isMod ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <AdminKpiCard
                label="Total Community Users"
                value={data.users.total}
                sublabel={`${data.users.active} active · ${data.users.restricted} restricted`}
                icon={Users}
                href="/admin/users"
              />
              <AdminKpiCard
                label="Open Moderation Reports"
                value={data.moderation.open}
                sublabel={`${data.moderation.total} total reports filed`}
                icon={Flag}
                href="/admin/moderation"
                statusTone={data.moderation.open > 0 ? 'warn' : 'good'}
              />
              <AdminKpiCard
                label="Resolved Reports"
                value={data.moderation.resolved}
                sublabel="Completed moderation actions"
                icon={CheckCircle2}
                href="/admin/moderation?status=resolved"
              />
              <AdminKpiCard
                label="Moderation Activity"
                value={data.activity.totalCount}
                sublabel="Logged user & report events"
                icon={Activity}
                href="/admin/activity"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <AdminKpiCard
                label="Registered Users"
                value={data.users.total}
                sublabel={`${data.users.active} active · ${data.users.restricted} restricted`}
                icon={Users}
                href="/admin/users"
              />
              <AdminKpiCard
                label="Artwork Logo Coverage"
                value={data.artwork ? `${data.artwork.coveragePct}%` : 'Data unavailable'}
                sublabel={
                  data.artwork
                    ? `${data.artwork.validLogos}/${data.artwork.total} indexed overrides`
                    : undefined
                }
                icon={ImageIcon}
                href="/admin/artwork"
              />
              <AdminKpiCard
                label="Missing / Fallback Logos"
                value={data.artwork?.missingLogos ?? 0}
                sublabel={`${data.artwork?.japaneseOnlyLogos ?? 0} Japanese-only candidates`}
                icon={AlertTriangle}
                href="/admin/missing-logos"
                statusTone={
                  (data.artwork?.missingLogos ?? 0) > 0 ? 'warn' : 'good'
                }
              />
              <AdminKpiCard
                label="Open Reports Queue"
                value={data.moderation.open}
                sublabel={`${data.moderation.resolved} resolved · ${data.moderation.total} total`}
                icon={Flag}
                href="/admin/moderation"
                statusTone={data.moderation.open > 0 ? 'warn' : 'good'}
              />
              <AdminKpiCard
                label="Avg Provider Latency"
                value={
                  data.telemetry?.perfSummary.totalRequests
                    ? `${data.telemetry.perfSummary.avgLatencyMs}ms`
                    : 'No traffic'
                }
                sublabel={
                  data.telemetry?.perfSummary.totalRequests
                    ? `p95 ${data.telemetry.perfSummary.p95LatencyMs}ms · ${data.telemetry.perfSummary.totalRequests} reqs`
                    : 'Run streaming/API traffic to record'
                }
                icon={Clock}
                href="/admin/monitoring"
              />
              <AdminKpiCard
                label="Server Cache Entries"
                value={data.telemetry?.cacheStats.size ?? 0}
                sublabel={`${data.telemetry?.perfSummary.cacheHitRatePct ?? 0}% hit rate · ${data.telemetry?.artworkCacheStats.resolvedSize ?? 0} artwork`}
                icon={Database}
                href="/admin/cache"
              />
              <AdminKpiCard
                label="Recorded Errors"
                value={
                  (data.telemetry?.storedErrorsCount ?? 0) +
                  (data.telemetry?.inMemoryErrorsCount ?? 0)
                }
                sublabel={`${data.telemetry?.storedErrorsCount ?? 0} stored · ${data.telemetry?.inMemoryErrorsCount ?? 0} runtime`}
                icon={Bug}
                href="/admin/errors"
                statusTone={
                  (data.telemetry?.storedErrorsCount ?? 0) > 0 ? 'warn' : 'default'
                }
              />
              <AdminKpiCard
                label="Active Staff & Notices"
                value={`${data.users.adminsCount ?? 1} / ${data.announcements?.published ?? 0}`}
                sublabel={`${data.announcements?.total ?? 0} total announcements`}
                icon={Megaphone}
                href="/admin/announcements"
              />
            </div>
          )}

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    User Registration Growth ({range.toUpperCase()})
                  </h3>
                  <p className="text-xs text-[#A0A0A0]">
                    Cumulative registered users and new signups per window
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-md bg-[#141414] border border-[#292929] font-mono text-xs text-white tabular-nums">
                  {data.users.total} Users
                </span>
              </div>

              <AdminAreaChart
                data={growthData}
                primaryLabel="Cumulative Users"
                secondaryLabel="New in Bucket"
                emptyMessage="Data unavailable — no timestamped registrations yet"
              />
            </div>

            {isMod ? (
              <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Community Role Breakdown
                    </h3>
                    <p className="text-xs text-[#A0A0A0]">
                      Distribution across Member, Mod, Admin, and Owner roles
                    </p>
                  </div>
                  <Link
                    href="/admin/users"
                    className="text-xs font-mono text-[#A0A0A0] hover:text-white"
                  >
                    Manage Users →
                  </Link>
                </div>

                <AdminDonutChart
                  segments={[
                    { label: 'Members', value: data.users.roleBreakdown.member, color: '#FFFFFF' },
                    { label: 'Mods', value: data.users.roleBreakdown.mod, color: '#A3A3A3' },
                    { label: 'Admins', value: data.users.roleBreakdown.admin, color: '#737373' },
                    { label: 'Owners', value: data.users.roleBreakdown.owner, color: '#404040' },
                  ]}
                  centerValue={String(data.users.total)}
                  centerLabel="Accounts"
                />
              </div>
            ) : (
              <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Transparent Logo Coverage
                    </h3>
                    <p className="text-xs text-[#A0A0A0]">
                      Fanart.tv HDTVLogo / ClearLogo vs Custom Storage vs Fallback
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-md bg-white text-black font-mono font-bold text-xs tabular-nums">
                    {data.artwork?.coveragePct ?? 0}% Covered
                  </span>
                </div>

                <AdminDonutChart
                  segments={artworkSegments}
                  centerValue={`${data.artwork?.coveragePct ?? 0}%`}
                  centerLabel="Coverage"
                  emptyMessage="Data unavailable — run Missing Logo Scanner to index overrides"
                />
              </div>
            )}
          </div>

          {/* Charts Row 2 (Admin/Owner Only): API Throughput & Provider Latency */}
          {!isMod && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      API Request & Error Volume
                    </h3>
                    <p className="text-xs text-[#A0A0A0]">
                      Real server-side upstream request buckets from perf-monitor
                    </p>
                  </div>
                  <Link
                    href="/admin/monitoring"
                    className="text-xs font-mono text-[#A0A0A0] hover:text-white"
                  >
                    Live Probes →
                  </Link>
                </div>

                {telemetrySeriesData.some((d) => d.value > 0) ? (
                  <AdminAreaChart
                    data={telemetrySeriesData}
                    primaryLabel="Requests"
                    secondaryLabel="Errors"
                  />
                ) : (
                  <AdminChartEmpty message="Data unavailable — no upstream requests recorded in this window" />
                )}
              </div>

              <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      Provider Average Latency (ms)
                    </h3>
                    <p className="text-xs text-[#A0A0A0]">
                      Hoshika, AniList, MegaPlay, ZokoAnime, AniSkip, and Fanart.tv
                    </p>
                  </div>
                  <Link
                    href="/admin/streaming"
                    className="text-xs font-mono text-[#A0A0A0] hover:text-white"
                  >
                    Stream Tester →
                  </Link>
                </div>

                {providerLatencyBars.some((b) => b.value > 0) ? (
                  <AdminBarChart
                    data={providerLatencyBars}
                    primaryLabel="Avg Latency"
                    valueSuffix="ms"
                  />
                ) : (
                  <AdminChartEmpty message="Data unavailable — trigger streaming or API health probes" />
                )}
              </div>
            </div>
          )}

          {/* Actionable Queues & Audit Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Open Moderation Reports Queue */}
            <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Flag size={15} />
                  <span>Open Moderation Queue ({data.moderation.open})</span>
                </h3>
                <Link
                  href="/admin/moderation"
                  className="text-xs font-mono text-[#A0A0A0] hover:text-white"
                >
                  Open Queue →
                </Link>
              </div>

              {data.moderation.recentQueue.length === 0 ? (
                <div className="p-6 rounded-xl bg-[#141414] border border-[#292929] text-center space-y-1.5">
                  <ShieldCheck size={18} className="mx-auto text-emerald-400" />
                  <div className="text-xs font-semibold text-white">
                    Queue Clear
                  </div>
                  <p className="text-[11px] text-[#707070]">
                    No open user or content moderation reports require attention.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {data.moderation.recentQueue.slice(0, 6).map((rep, i) => (
                    <Link
                      key={rep.id || i}
                      href="/admin/moderation"
                      className="p-3 rounded-xl bg-[#141414] border border-[#292929] hover:border-white/40 flex items-center justify-between gap-3 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-black border border-[#292929] font-mono text-[9px] uppercase text-white">
                            {rep.targetType || 'other'}
                          </span>
                          <span className="text-xs font-bold text-white truncate">
                            {rep.targetName || rep.targetId || 'Reported Item'}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#A0A0A0] truncate mt-0.5">
                          {rep.reason}
                        </div>
                      </div>
                      <AdminStatusBadge
                        tone={rep.status === 'in_review' ? 'degraded' : 'pending'}
                        label={String(rep.status || 'open').replace('_', ' ')}
                      />
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Admin Activity */}
            <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Activity size={15} />
                  <span>
                    {isMod
                      ? 'Recent Moderation & User Logs'
                      : 'Recent Administrator Activity'}
                  </span>
                </h3>
                <Link
                  href="/admin/activity"
                  className="text-xs font-mono text-[#A0A0A0] hover:text-white"
                >
                  All Logs →
                </Link>
              </div>

              {data.activity.recent.length === 0 ? (
                <div className="p-6 rounded-xl bg-[#141414] border border-[#292929] text-center text-xs text-[#707070]">
                  Data unavailable — no administrative activity logged yet.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {data.activity.recent.slice(0, 6).map((act, i) => (
                    <div
                      key={act.id || i}
                      className="p-3 rounded-xl bg-[#141414] border border-[#292929] flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-black border border-[#292929] font-mono text-[9px] uppercase text-white">
                            {act.category || 'system'}
                          </span>
                          <span className="text-xs font-bold text-white truncate">
                            {act.action}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-[#707070] truncate mt-0.5">
                          {act.targetName || act.targetId} · {act.adminEmail}
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-[#A0A0A0] shrink-0 tabular-nums">
                        {act.timestamp
                          ? new Date(act.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Missing Logos Preview + Recent Artwork Audits (Admin/Owner Only) */}
          {!isMod && data.artwork && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">
                    Artwork Attention Queue
                  </h3>
                  <Link
                    href="/admin/missing-logos"
                    className="text-xs font-mono text-[#A0A0A0] hover:text-white"
                  >
                    Open Scanner →
                  </Link>
                </div>

                {data.artwork.missingSamples.length === 0 ? (
                  <div className="p-6 rounded-xl bg-[#141414] border border-[#292929] text-center text-xs text-[#707070]">
                    All indexed anime overrides have active transparent logos.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {data.artwork.missingSamples.map((item) => (
                      <Link
                        key={item.hoshikaId}
                        href={`/admin/artwork/${item.hoshikaId}`}
                        className="p-3 rounded-xl bg-[#141414] border border-[#292929] hover:border-white/40 flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-14 h-8 rounded bg-black border border-[#292929] relative flex items-center justify-center shrink-0 overflow-hidden">
                            <ResilientImage
                              src={item.selectedLogoUrl}
                              alt={item.title || 'Anime'}
                              fill
                              sizes="64px"
                              className="object-contain p-1"
                              fallback={
                                <span className="text-[9px] font-mono text-[#707070]">
                                  TEXT
                                </span>
                              }
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white truncate">
                              {item.title}
                            </div>
                            <div className="text-[11px] font-mono text-[#707070]">
                              #{item.hoshikaId} · {item.logoStatus || 'missing'}
                            </div>
                          </div>
                        </div>
                        <span className="text-xs font-mono text-white shrink-0">
                          Fix →
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">
                    Recent Artwork Audits
                  </h3>
                  <Link
                    href="/admin/activity"
                    className="text-xs font-mono text-[#A0A0A0] hover:text-white"
                  >
                    Audit Trail →
                  </Link>
                </div>

                {(data.activity.recentArtworkAudits || []).length === 0 ? (
                  <div className="p-6 rounded-xl bg-[#141414] border border-[#292929] text-center text-xs text-[#707070]">
                    Data unavailable — no artwork overrides recorded yet.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {(data.activity.recentArtworkAudits || [])
                      .slice(0, 6)
                      .map((log, i) => (
                        <Link
                          key={log.id || i}
                          href={`/admin/artwork/${log.hoshikaId}`}
                          className="p-3 rounded-xl bg-[#141414] border border-[#292929] hover:border-white/40 flex items-center justify-between gap-3 transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white truncate">
                              {log.animeTitle} ({String(log.action || '').replace(/_/g, ' ')})
                            </div>
                            <div className="text-[11px] font-mono text-[#707070] truncate">
                              {log.previousSource} → {log.newSource} · {log.changedByEmail}
                            </div>
                          </div>
                          <span className="text-[11px] font-mono text-[#A0A0A0] shrink-0 tabular-nums">
                            {log.timestamp
                              ? new Date(log.timestamp).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '—'}
                          </span>
                        </Link>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
