'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Save,
  RefreshCw,
  Shield,
  CheckCircle2,
  Loader2,
  Database,
  PlaySquare,
  Tv,
  Gauge,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getAdminAuthHeaders, hasAdminPermission } from '@/lib/admin/admin-auth';
import {
  DEFAULT_SITE_CONFIG,
  SiteConfigFirestoreDoc,
} from '@/lib/admin/admin-firestore';

type SettingsTab = 'general' | 'player' | 'providers' | 'performance' | 'maintenance';

export default function AdminSettingsPage() {
  const { adminRecord } = useAuth();
  const canManage = hasAdminPermission(adminRecord, 'manageSettings');

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [config, setConfig] = useState<Omit<SiteConfigFirestoreDoc, 'createdAt' | 'updatedAt'>>(
    DEFAULT_SITE_CONFIG
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/settings', {
        headers,
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.config) {
        throw new Error(data?.error || `Failed to load settings (${res.status})`);
      }
      setConfig({
        ...DEFAULT_SITE_CONFIG,
        ...data.config,
        playerSettings: {
          ...DEFAULT_SITE_CONFIG.playerSettings!,
          ...(data.config.playerSettings || {}),
        },
        providerSettings: {
          ...DEFAULT_SITE_CONFIG.providerSettings!,
          ...(data.config.providerSettings || {}),
        },
        performanceSettings: {
          ...DEFAULT_SITE_CONFIG.performanceSettings!,
          ...(data.config.performanceSettings || {}),
        },
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers,
        body: JSON.stringify(config),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Failed to save settings (${res.status})`);
      }
      setConfig(data.config);
      showToast('Saved global site settings and revalidated public routes.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handlePurgeArtworkCache = async () => {
    setPurging(true);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/cache', {
        method: 'POST',
        headers,
        body: JSON.stringify({ scope: 'artwork' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to purge artwork cache');
      }
      showToast(`Purged ${data?.clearedCount ?? 0} server-side artwork cache entries.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Cache purge failed');
    } finally {
      setPurging(false);
    }
  };

  const tabs: Array<{ id: SettingsTab; label: string; Icon: React.ComponentType<{ size?: number }> }> = [
    { id: 'general', label: 'General & Artwork', Icon: Database },
    { id: 'player', label: 'Player', Icon: PlaySquare },
    { id: 'providers', label: 'Streaming Providers', Icon: Tv },
    { id: 'performance', label: 'Performance & Cache', Icon: Gauge },
    { id: 'maintenance', label: 'Maintenance & Security', Icon: Shield },
  ];

  if (loading) {
    return (
      <div className="p-12 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex justify-center">
        <Loader2 size={24} className="animate-spin text-white" />
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
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <Settings size={19} />
            <span>Platform Configuration & Feature Controls</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Configure global branding, Fanart.tv logo rules, video player defaults, provider routing, cache TTLs, and maintenance mode.
          </p>
        </div>

        <button
          type="button"
          onClick={handlePurgeArtworkCache}
          disabled={purging}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-bold text-white cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={14} className={purging ? 'animate-spin' : ''} />
          <span>Purge Server Cache</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex flex-wrap gap-1.5 bg-[#0A0A0A] border border-[#292929] rounded-xl p-1.5">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                active ? 'bg-white text-black' : 'text-[#A0A0A0] hover:text-white'
              }`}
            >
              <tab.Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {activeTab === 'general' && (
          <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Site Identity & Artwork Engine</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                  Platform Name
                </label>
                <input
                  type="text"
                  disabled={!canManage}
                  value={config.siteName}
                  onChange={(e) => setConfig({ ...config, siteName: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                  Artwork Server Cache TTL (Minutes)
                </label>
                <input
                  type="number"
                  min={1}
                  max={10080}
                  disabled={!canManage}
                  value={config.artworkCacheTtlMinutes}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      artworkCacheTtlMinutes: Number(e.target.value) || 60,
                    })
                  }
                  className="w-full px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white font-mono focus:outline-none focus:border-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                Platform Description
              </label>
              <textarea
                rows={2}
                disabled={!canManage}
                value={config.siteDescription}
                onChange={(e) => setConfig({ ...config, siteDescription: e.target.value })}
                className="w-full px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white"
              />
            </div>

            <div className="space-y-3 pt-2 border-t border-[#292929]">
              <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                <div>
                  <div className="font-bold text-white">
                    Prefer English Transparent Logos (EN HDTVLogo → EN ClearLogo)
                  </div>
                  <div className="text-[11px] text-[#A0A0A0]">
                    Prioritizes English Fanart.tv logos before falling back to Japanese logos
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={config.preferEnglishLogos}
                  onChange={(e) =>
                    setConfig({ ...config, preferEnglishLogos: e.target.checked })
                  }
                  className="accent-white w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                <div>
                  <div className="font-bold text-white">Automatic Missing Logo Scanner</div>
                  <div className="text-[11px] text-[#A0A0A0]">
                    Automatically indexes Fanart.tv logo candidates when new seasonal anime appear
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={config.autoArtworkScan}
                  onChange={(e) =>
                    setConfig({ ...config, autoArtworkScan: e.target.checked })
                  }
                  className="accent-white w-4 h-4"
                />
              </label>
            </div>
          </div>
        )}

        {activeTab === 'player' && (
          <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Video Player Defaults</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                  Default Audio Track
                </label>
                <select
                  disabled={!canManage}
                  value={config.playerSettings?.defaultAudio || 'sub'}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      playerSettings: {
                        ...DEFAULT_SITE_CONFIG.playerSettings!,
                        ...config.playerSettings,
                        defaultAudio: e.target.value === 'dub' ? 'dub' : 'sub',
                      },
                    })
                  }
                  className="w-full px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white font-mono focus:outline-none focus:border-white"
                >
                  <option value="sub">SUB (Original Japanese + Subtitles)</option>
                  <option value="dub">DUB (English Dubbed)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                  Default Stream Quality
                </label>
                <select
                  disabled={!canManage}
                  value={config.playerSettings?.defaultQuality || 'auto'}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      playerSettings: {
                        ...DEFAULT_SITE_CONFIG.playerSettings!,
                        ...config.playerSettings,
                        defaultQuality: e.target.value as 'auto' | '1080p' | '720p' | '480p',
                      },
                    })
                  }
                  className="w-full px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white font-mono focus:outline-none focus:border-white"
                >
                  <option value="auto">Auto Adaptive</option>
                  <option value="1080p">1080p</option>
                  <option value="720p">720p</option>
                  <option value="480p">480p</option>
                </select>
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-[#292929]">
              <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                <div>
                  <div className="font-bold text-white">Auto-Play Next Episode</div>
                  <div className="text-[11px] text-[#A0A0A0]">
                    Automatically advances to the next episode when playback ends
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={config.playerSettings?.autoPlayNext ?? true}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      playerSettings: {
                        ...DEFAULT_SITE_CONFIG.playerSettings!,
                        ...config.playerSettings,
                        autoPlayNext: e.target.checked,
                      },
                    })
                  }
                  className="accent-white w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                <div>
                  <div className="font-bold text-white">Auto-Skip Intro (AniSkip OP)</div>
                  <div className="text-[11px] text-[#A0A0A0]">
                    Skips opening sequence automatically when AniSkip timestamps exist
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={config.playerSettings?.autoSkipIntro ?? true}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      playerSettings: {
                        ...DEFAULT_SITE_CONFIG.playerSettings!,
                        ...config.playerSettings,
                        autoSkipIntro: e.target.checked,
                      },
                    })
                  }
                  className="accent-white w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                <div>
                  <div className="font-bold text-white">Auto-Skip Outro (AniSkip ED)</div>
                  <div className="text-[11px] text-[#A0A0A0]">
                    Skips ending credits automatically when timestamps are available
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={config.playerSettings?.autoSkipOutro ?? false}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      playerSettings: {
                        ...DEFAULT_SITE_CONFIG.playerSettings!,
                        ...config.playerSettings,
                        autoSkipOutro: e.target.checked,
                      },
                    })
                  }
                  className="accent-white w-4 h-4"
                />
              </label>
            </div>
          </div>
        )}

        {activeTab === 'providers' && (
          <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Streaming Provider Routing</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-1">
                <div className="text-[11px] font-mono uppercase text-[#707070]">
                  Anime TV / OVA / ONA / Special
                </div>
                <div className="text-sm font-bold text-white font-mono">MegaPlay (Locked)</div>
                <div className="text-[11px] text-[#A0A0A0]">
                  GET /api/watch/megaplay/&#123;anilist_id&#125;/&#123;episode&#125;/&#123;sub|dub&#125;
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-1">
                <div className="text-[11px] font-mono uppercase text-[#707070]">
                  Anime Movies
                </div>
                <div className="text-sm font-bold text-white font-mono">ZokoAnime (Locked)</div>
                <div className="text-[11px] text-[#A0A0A0]">
                  Dedicated ZokoAnime movie gateway
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[#292929]">
              <div>
                <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                  Upstream Stream Timeout (ms)
                </label>
                <input
                  type="number"
                  min={2000}
                  max={20000}
                  step={500}
                  disabled={!canManage}
                  value={config.providerSettings?.streamTimeoutMs ?? 8500}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      providerSettings: {
                        ...DEFAULT_SITE_CONFIG.providerSettings!,
                        ...config.providerSettings,
                        streamTimeoutMs: Number(e.target.value) || 8500,
                      },
                    })
                  }
                  className="w-full px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white font-mono focus:outline-none focus:border-white"
                />
              </div>

              <label className="flex items-center justify-between gap-3 text-xs cursor-pointer p-3 rounded-xl bg-[#141414] border border-[#292929]">
                <div>
                  <div className="font-bold text-white">Allow Secondary Fallback Probes</div>
                  <div className="text-[11px] text-[#A0A0A0]">
                    Only within strict format boundaries (series stays MegaPlay, movie stays ZokoAnime)
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={config.providerSettings?.allowStreamFallback ?? false}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      providerSettings: {
                        ...DEFAULT_SITE_CONFIG.providerSettings!,
                        ...config.providerSettings,
                        allowStreamFallback: e.target.checked,
                      },
                    })
                  }
                  className="accent-white w-4 h-4"
                />
              </label>
            </div>
          </div>
        )}

        {activeTab === 'performance' && (
          <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Cache & Edge Performance</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                  Catalog Cache TTL (Seconds)
                </label>
                <input
                  type="number"
                  min={30}
                  max={86400}
                  disabled={!canManage}
                  value={config.performanceSettings?.catalogCacheTtlSeconds ?? 300}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      performanceSettings: {
                        ...DEFAULT_SITE_CONFIG.performanceSettings!,
                        ...config.performanceSettings,
                        catalogCacheTtlSeconds: Number(e.target.value) || 300,
                      },
                    })
                  }
                  className="w-full px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white font-mono focus:outline-none focus:border-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                  Episode List Cache TTL (Seconds)
                </label>
                <input
                  type="number"
                  min={30}
                  max={86400}
                  disabled={!canManage}
                  value={config.performanceSettings?.episodeCacheTtlSeconds ?? 180}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      performanceSettings: {
                        ...DEFAULT_SITE_CONFIG.performanceSettings!,
                        ...config.performanceSettings,
                        episodeCacheTtlSeconds: Number(e.target.value) || 180,
                      },
                    })
                  }
                  className="w-full px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white font-mono focus:outline-none focus:border-white"
                />
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 text-xs cursor-pointer pt-2 border-t border-[#292929]">
              <div>
                <div className="font-bold text-white">Enable Edge / SWR Caching Headers</div>
                <div className="text-[11px] text-[#A0A0A0]">
                  Uses stale-while-revalidate caching on public catalog & artwork proxy endpoints
                </div>
              </div>
              <input
                type="checkbox"
                disabled={!canManage}
                checked={config.performanceSettings?.enableEdgeCaching ?? true}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    performanceSettings: {
                      ...DEFAULT_SITE_CONFIG.performanceSettings!,
                      ...config.performanceSettings,
                      enableEdgeCaching: e.target.checked,
                    },
                  })
                }
                className="accent-white w-4 h-4"
              />
            </label>
          </div>
        )}

        {activeTab === 'maintenance' && (
          <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Maintenance Mode & Security Governance</h3>

            <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
              <div>
                <div className="font-bold text-white">Maintenance Mode</div>
                <div className="text-[11px] text-[#A0A0A0]">
                  Displays a prominent maintenance notice across public pages while preserving admin console access
                </div>
              </div>
              <input
                type="checkbox"
                disabled={!canManage}
                checked={config.maintenanceMode}
                onChange={(e) => setConfig({ ...config, maintenanceMode: e.target.checked })}
                className="accent-white w-4 h-4"
              />
            </label>

            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                Public Maintenance Banner Message
              </label>
              <textarea
                rows={2}
                disabled={!canManage}
                value={config.maintenanceMessage || ''}
                onChange={(e) =>
                  setConfig({ ...config, maintenanceMessage: e.target.value })
                }
                placeholder="AniScroll is undergoing scheduled maintenance..."
                className="w-full px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[#292929]">
              <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                <div>
                  <div className="font-bold text-white">
                    Require 2FA / Google Verified Sign-In for Admins
                  </div>
                  <div className="text-[11px] text-[#A0A0A0]">
                    Recommends Google OAuth with 2-Step Verification for privileged accounts
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={config.require2FAForAdmins}
                  onChange={(e) =>
                    setConfig({ ...config, require2FAForAdmins: e.target.checked })
                  }
                  className="accent-white w-4 h-4"
                />
              </label>

              <div>
                <label className="block text-xs font-medium text-[#A0A0A0] mb-1">
                  Admin Idle Session Timeout (Minutes)
                </label>
                <input
                  type="number"
                  min={5}
                  max={10080}
                  disabled={!canManage}
                  value={config.sessionTimeoutMinutes}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      sessionTimeoutMinutes: Number(e.target.value) || 120,
                    })
                  }
                  className="w-full px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white font-mono focus:outline-none focus:border-white"
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-1.5 text-xs">
              <div className="font-mono font-bold text-white uppercase">
                Active Security Architecture
              </div>
              <ul className="space-y-1 text-[11px] text-[#A0A0A0] font-mono">
                <li>• Firestore RBAC Rules: 4-Tier Server &amp; Rule Enforced</li>
                <li>• Storage Rules: Max 5MB, PNG/WebP Validated</li>
                <li>• AniZip Logos: Strictly Disabled (0%)</li>
                <li>• Diagnostic Secret Redaction: Active</li>
              </ul>
            </div>
          </div>
        )}

        {canManage && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span>Save Global Settings</span>
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
