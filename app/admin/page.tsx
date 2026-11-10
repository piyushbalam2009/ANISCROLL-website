'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Users,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Upload,
  ShieldCheck,
  Activity,
  ArrowRight,
  RefreshCw,
  Sparkles,
  Lock,
} from 'lucide-react';
import {
  AdminActivityLogEntry,
  AnimeArtworkFirestoreDoc,
  ArtworkAuditLogEntry,
  listAdminActivityLogs,
  listAllAdmins,
  listAllAnimeArtworkOverrides,
  listArtworkAuditLogs,
  listManagedUsers,
} from '@/lib/admin/admin-firestore';
import { getAdminAuthHeaders } from '@/lib/admin/admin-auth';

export default function AdminOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [usersCount, setUsersCount] = useState(0);
  const [adminsCount, setAdminsCount] = useState(1);
  const [artworkDocs, setArtworkDocs] = useState<AnimeArtworkFirestoreDoc[]>([]);
  const [activityLogs, setActivityLogs] = useState<AdminActivityLogEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<ArtworkAuditLogEntry[]>([]);

  const loadDashboardMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const [users, admins, overrides, activities, audits] = await Promise.all([
        listManagedUsers().catch(() => []),
        listAllAdmins().catch(() => []),
        listAllAnimeArtworkOverrides().catch(() => []),
        listAdminActivityLogs(12).catch(() => []),
        listArtworkAuditLogs(10).catch(() => []),
      ]);

      setUsersCount(users.length);
      setAdminsCount(Math.max(1, admins.length));
      setActivityLogs(activities);
      setAuditLogs(audits);

      if (overrides.length > 0) {
        setArtworkDocs(overrides);
      } else {
        // Run initial lightweight catalogue scan if no artwork overrides exist yet
        const headers = await getAdminAuthHeaders();
        const scanRes = await fetch('/api/admin/artwork', {
          method: 'POST',
          headers,
          body: JSON.stringify({ action: 'scan_catalogue', limit: 16 }),
        });
        if (scanRes.ok) {
          const data = await scanRes.json();
          setArtworkDocs(data.results || []);
        }
      }
    } catch (error) {
      console.error('Failed to load admin overview:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardMetrics();
  }, [loadDashboardMetrics]);

  const handleQuickScan = async () => {
    setScanning(true);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/artwork', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'scan_catalogue', limit: 24 }),
      });
      if (res.ok) {
        const data = await res.json();
        const scanned: AnimeArtworkFirestoreDoc[] = data.results || [];
        const overrides = await listAllAnimeArtworkOverrides().catch(() => []);
        const merged = new Map<number, AnimeArtworkFirestoreDoc>();
        for (const item of scanned) merged.set(item.hoshikaId, item);
        for (const ov of overrides) merged.set(ov.hoshikaId, ov);
        setArtworkDocs(Array.from(merged.values()));
      }
    } finally {
      setScanning(false);
    }
  };

  const totalAnime = artworkDocs.length;
  const validLogosCount = artworkDocs.filter(
    (a) => Boolean(a.selectedLogoUrl) && a.selectedLogoSource !== 'typography_fallback'
  ).length;
  const missingLogosCount = artworkDocs.filter(
    (a) => !a.selectedLogoUrl || a.logoStatus === 'missing' || a.selectedLogoSource === 'typography_fallback'
  ).length;
  const japaneseLogosCount = artworkDocs.filter(
    (a) => a.selectedLogoLanguage === 'ja' || a.logoStatus === 'japanese_only'
  ).length;
  const customLogosCount = artworkDocs.filter(
    (a) => a.selectedLogoSource === 'custom_upload' || (a.customLogos && a.customLogos.length > 0)
  ).length;
  const manualOverridesCount = artworkDocs.filter(
    (a) => a.selectionMode === 'manual'
  ).length;
  const autoSelectedCount = Math.max(0, totalAnime - manualOverridesCount);

  const coveragePct =
    totalAnime > 0 ? Math.round((validLogosCount / totalAnime) * 100) : 100;
  const manualPct =
    totalAnime > 0 ? Math.round((manualOverridesCount / totalAnime) * 100) : 0;

  const kpiCards = [
    {
      label: 'Registered Users',
      value: usersCount,
      sub: 'Cloud synced accounts',
      icon: Users,
      href: '/admin/users',
    },
    {
      label: 'Indexed Anime Artwork',
      value: totalAnime,
      sub: `${coveragePct}% logo coverage`,
      icon: ImageIcon,
      href: '/admin/artwork',
    },
    {
      label: 'Valid Transparent Logos',
      value: validLogosCount,
      sub: 'Fanart.tv + Custom PNG/WebP',
      icon: CheckCircle2,
      href: '/admin/artwork',
    },
    {
      label: 'Missing / Fallback Logos',
      value: missingLogosCount,
      sub: 'Using Hoshika typography',
      icon: AlertTriangle,
      href: '/admin/missing-logos',
    },
    {
      label: 'Japanese-Only Logos',
      value: japaneseLogosCount,
      sub: 'Candidates for EN upload',
      icon: Globe,
      href: '/admin/missing-logos?filter=japanese_only',
    },
    {
      label: 'Custom Uploaded Logos',
      value: customLogosCount,
      sub: 'Stored in Firebase Storage',
      icon: Upload,
      href: '/admin/artwork',
    },
    {
      label: 'Active Administrators',
      value: adminsCount,
      sub: 'Three-tier RBAC enforced',
      icon: ShieldCheck,
      href: '/admin/admins',
    },
    {
      label: 'Recent Admin Actions',
      value: activityLogs.length + auditLogs.length,
      sub: 'Audited in Firestore',
      icon: Activity,
      href: '/admin/activity',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#0A0A0A] border border-[#292929] rounded-xl p-5">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-[#707070]">
            AniScroll Operations Center
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight mt-0.5">
            Platform & Artwork Telemetry
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-1">
            Real-time overview of Fanart.tv transparent logo coverage, Firebase Storage custom overrides, and RBAC audit trails.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleQuickScan}
            disabled={scanning || loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
            <span>{scanning ? 'Scanning Catalogue...' : 'Run Artwork Health Scan'}</span>
          </button>

          <Link
            href="/admin/artwork"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-white font-semibold text-xs transition-colors"
          >
            <span>Manage Logos</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>

      {/* 8 KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href={card.href}
              className="group bg-[#0A0A0A] border border-[#292929] hover:border-white/50 rounded-xl p-4 flex flex-col justify-between gap-3 transition-all"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#A0A0A0] group-hover:text-white transition-colors">
                  {card.label}
                </span>
                <div className="w-8 h-8 rounded-lg bg-[#141414] border border-[#292929] flex items-center justify-center text-white">
                  <Icon size={15} />
                </div>
              </div>

              <div>
                <div className="text-2xl sm:text-3xl font-black text-white font-mono tabular-nums tracking-tight">
                  {loading ? '—' : card.value}
                </div>
                <div className="text-[11px] font-mono text-[#707070] mt-1">
                  {card.sub}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Charts Row: Logo Coverage & Custom vs Auto Ratio */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Logo Coverage Breakdown */}
        <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">
                Transparent Logo Coverage Distribution
              </h3>
              <p className="text-xs text-[#A0A0A0]">
                Fanart.tv HDTVLogo / ClearLogo vs Custom Uploads vs Typography Fallback
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-md bg-white text-black font-mono font-bold text-xs tabular-nums">
              {coveragePct}% Covered
            </span>
          </div>

          <div className="space-y-3 pt-1">
            {[
              {
                label: 'Valid English Fanart.tv Logos',
                count: Math.max(0, validLogosCount - japaneseLogosCount - customLogosCount),
                total: Math.max(1, totalAnime),
                barClass: 'bg-white',
              },
              {
                label: 'Custom Uploaded Logos (Firebase Storage)',
                count: customLogosCount,
                total: Math.max(1, totalAnime),
                barClass: 'bg-neutral-300',
              },
              {
                label: 'Japanese-Only Fanart.tv Logos',
                count: japaneseLogosCount,
                total: Math.max(1, totalAnime),
                barClass: 'bg-neutral-500',
              },
              {
                label: 'Missing / Typography Fallback',
                count: missingLogosCount,
                total: Math.max(1, totalAnime),
                barClass: 'bg-neutral-700',
              },
            ].map((row) => {
              const pct = Math.min(100, Math.round((row.count / row.total) * 100));
              const widthClass =
                pct === 0
                  ? 'w-0'
                  : pct <= 10
                  ? 'w-1/12'
                  : pct <= 25
                  ? 'w-1/4'
                  : pct <= 40
                  ? 'w-2/5'
                  : pct <= 55
                  ? 'w-1/2'
                  : pct <= 70
                  ? 'w-2/3'
                  : pct <= 85
                  ? 'w-4/5'
                  : pct < 100
                  ? 'w-11/12'
                  : 'w-full';
              return (
                <div key={row.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#A0A0A0]">{row.label}</span>
                    <span className="font-mono text-white font-semibold tabular-nums">
                      {row.count} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#141414] overflow-hidden">
                    <div
                      className={`h-full ${row.barClass} ${widthClass} transition-all duration-500`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chart 2: Custom Manual Lock vs Automatic Resolver */}
        <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">
                Selection Mode Governance (Manual Lock vs Auto)
              </h3>
              <p className="text-xs text-[#A0A0A0]">
                Manual selections are locked and never overridden by automatic Fanart.tv resolution
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-md bg-[#141414] border border-[#292929] font-mono text-xs text-white tabular-nums">
              {manualPct}% Manual
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-mono text-[#A0A0A0]">
                <Lock size={13} className="text-white" />
                <span>MANUAL ADMIN LOCK</span>
              </div>
              <div className="text-2xl font-black text-white font-mono tabular-nums">
                {manualOverridesCount}
              </div>
              <div className="text-[11px] text-[#707070]">
                Pinned primary logos & custom uploads
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-mono text-[#A0A0A0]">
                <Sparkles size={13} className="text-white" />
                <span>AUTO PRIORITY</span>
              </div>
              <div className="text-2xl font-black text-white font-mono tabular-nums">
                {autoSelectedCount}
              </div>
              <div className="text-[11px] text-[#707070]">
                EN HDTVLogo → EN ClearLogo → JA
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-[#292929] flex items-center justify-between text-xs">
            <span className="text-[#A0A0A0]">
              AniZip Logo Policy: <strong className="text-white">Strictly Disabled (0%)</strong>
            </span>
            <Link
              href="/admin/missing-logos"
              className="text-white font-semibold hover:underline inline-flex items-center gap-1"
            >
              <span>Open Missing Logo Scanner</span>
              <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      </div>

      {/* Bottom Row: Recent Artwork Changes & Recent Admin Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Artwork Changes */}
        <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">
              Recent Artwork & Logo Changes
            </h3>
            <Link
              href="/admin/activity"
              className="text-xs font-mono text-[#A0A0A0] hover:text-white"
            >
              View Audit Trail →
            </Link>
          </div>

          {auditLogs.length === 0 ? (
            <div className="space-y-2.5">
              {artworkDocs.slice(0, 4).map((item) => (
                <Link
                  key={item.hoshikaId}
                  href={`/admin/artwork/${item.hoshikaId}`}
                  className="p-3 rounded-lg bg-[#141414] border border-[#292929] hover:border-white/40 flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-16 h-9 rounded bg-black border border-[#292929] relative flex items-center justify-center shrink-0 overflow-hidden">
                      {item.selectedLogoUrl ? (
                        <Image
                          src={item.selectedLogoUrl}
                          alt={item.title}
                          fill
                          sizes="80px"
                          className="object-contain p-1"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="text-[9px] font-mono text-[#707070]">
                          TEXT
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        {item.title}
                      </div>
                      <div className="text-[11px] font-mono text-[#707070]">
                        {item.selectedLogoSource} • {item.selectionMode.toUpperCase()}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-white shrink-0">
                    Configure →
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              {auditLogs.slice(0, 5).map((log) => (
                <Link
                  key={log.id}
                  href={`/admin/artwork/${log.hoshikaId}`}
                  className="p-3 rounded-lg bg-[#141414] border border-[#292929] hover:border-white/40 flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">
                      {log.animeTitle} ({log.action.replace(/_/g, ' ')})
                    </div>
                    <div className="text-[11px] font-mono text-[#707070] truncate">
                      {log.previousSource} → {log.newSource} • {log.changedByEmail}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-[#A0A0A0] shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent Admin Activity */}
        <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">
              Recent Administrator Activity
            </h3>
            <Link
              href="/admin/activity"
              className="text-xs font-mono text-[#A0A0A0] hover:text-white"
            >
              All Logs →
            </Link>
          </div>

          {activityLogs.length === 0 ? (
            <div className="p-8 rounded-xl bg-[#141414] border border-[#292929] text-center space-y-1">
              <div className="text-xs font-bold text-white">
                System Audit Log Initialized
              </div>
              <p className="text-[11px] text-[#A0A0A0]">
                All artwork updates, custom uploads, user status changes, and RBAC modifications are recorded here in real time.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {activityLogs.slice(0, 5).map((act) => (
                <div
                  key={act.id}
                  className="p-3 rounded-lg bg-[#141414] border border-[#292929] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-black border border-[#292929] font-mono text-[9px] uppercase text-white">
                        {act.category}
                      </span>
                      <span className="text-xs font-bold text-white truncate">
                        {act.action}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-[#707070] truncate mt-0.5">
                      {act.targetName} • {act.adminEmail}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-[#A0A0A0] shrink-0">
                    {new Date(act.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
