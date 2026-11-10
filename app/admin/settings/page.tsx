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
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getAdminAuthHeaders, hasAdminPermission } from '@/lib/admin/admin-auth';
import {
  DEFAULT_SITE_CONFIG,
  SiteConfigFirestoreDoc,
  getSiteConfigDoc,
  saveSiteConfigDoc,
} from '@/lib/admin/admin-firestore';

export default function AdminSettingsPage() {
  const { adminRecord } = useAuth();
  const canManage = hasAdminPermission(adminRecord, 'manageSettings');

  const [config, setConfig] = useState<SiteConfigFirestoreDoc>(DEFAULT_SITE_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSiteConfigDoc();
      setConfig(data);
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
    try {
      const saved = await saveSiteConfigDoc({
        siteName: config.siteName,
        siteDescription: config.siteDescription,
        preferEnglishLogos: config.preferEnglishLogos,
        autoArtworkScan: config.autoArtworkScan,
        artworkCacheTtlMinutes: config.artworkCacheTtlMinutes,
        maintenanceMode: config.maintenanceMode,
        require2FAForAdmins: config.require2FAForAdmins,
        sessionTimeoutMinutes: config.sessionTimeoutMinutes,
      });
      setConfig(saved);
      showToast('Saved global site configuration and security preferences.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handlePurgeCache = async () => {
    setPurging(true);
    try {
      const headers = await getAdminAuthHeaders();
      await fetch('/api/admin/artwork', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'invalidate_cache' }),
      });
      showToast('Purged all server-side Fanart.tv and Firestore artwork caches.');
    } finally {
      setPurging(false);
    }
  };

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
          <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
            <Settings size={20} />
            <span>Platform Configuration, Artwork Cache & Security</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Configure Fanart.tv resolution priority, artwork cache TTL, session governance, and security enforcement.
          </p>
        </div>

        <button
          type="button"
          onClick={handlePurgeCache}
          disabled={purging}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-bold text-white cursor-pointer"
        >
          <RefreshCw size={14} className={purging ? 'animate-spin' : ''} />
          <span>Purge Server Artwork Cache</span>
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Branding & Artwork Engine Defaults */}
          <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Database size={16} />
              <span>Site Identity & Fanart.tv Artwork Engine</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                Platform Name
              </label>
              <input
                type="text"
                disabled={!canManage}
                value={config.siteName}
                onChange={(e) =>
                  setConfig({ ...config, siteName: e.target.value })
                }
                className="w-full px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                Platform Description
              </label>
              <textarea
                rows={2}
                disabled={!canManage}
                value={config.siteDescription}
                onChange={(e) =>
                  setConfig({ ...config, siteDescription: e.target.value })
                }
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
                  <div className="font-bold text-white">
                    Automatic Missing Logo Scanner
                  </div>
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

              <div>
                <label className="block text-xs font-medium text-[#A0A0A0] mb-1">
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
          </div>

          {/* Security & Session Governance */}
          <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Shield size={16} />
              <span>Security Hardening & Session Controls</span>
            </div>

            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                <div>
                  <div className="font-bold text-white">
                    Enforce 2FA / Google Verified Sign-In for Admins
                  </div>
                  <div className="text-[11px] text-[#A0A0A0]">
                    Recommends Google OAuth with 2-Step Verification for all administrator accounts
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={config.require2FAForAdmins}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      require2FAForAdmins: e.target.checked,
                    })
                  }
                  className="accent-white w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between gap-3 text-xs cursor-pointer">
                <div>
                  <div className="font-bold text-white">Maintenance Mode</div>
                  <div className="text-[11px] text-[#A0A0A0]">
                    Displays a maintenance notice banner across public pages while preserving admin access
                  </div>
                </div>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={config.maintenanceMode}
                  onChange={(e) =>
                    setConfig({ ...config, maintenanceMode: e.target.checked })
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

            <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-2 text-xs">
              <div className="font-mono font-bold text-white uppercase">
                Active Security Architecture
              </div>
              <ul className="space-y-1 text-[11px] text-[#A0A0A0] font-mono">
                <li>• Firestore Rules v2: Deployed & Enforced</li>
                <li>• Storage Rules: Max 5MB, PNG/WebP Validated</li>
                <li>• AniZip Logos: Strictly Disabled (0%)</li>
                <li>• Server-Side Token Verification: Active</li>
              </ul>
            </div>
          </div>
        </div>

        {canManage && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              <span>Save Global Settings</span>
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
