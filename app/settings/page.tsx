'use client';

import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Check, Sliders, Play, Palette, CheckCircle2 } from 'lucide-react';
import { UserPreferences } from '@/types/streaming';
import { getUserPreferences, saveUserPreferences, DEFAULT_PREFERENCES } from '@/lib/storage';

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [savedNotification, setSavedNotification] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setPrefs(getUserPreferences());
  }, []);

  const updatePreference = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    const updated = saveUserPreferences({ [key]: value });
    setPrefs(updated);
    setSavedNotification(true);
    setTimeout(() => setSavedNotification(false), 2000);
  };

  if (!mounted) {
    return (
      <div className="space-y-6 max-w-4xl pb-16">
        <div className="h-8 w-48 bg-[#141414] rounded-lg animate-pulse" />
        <div className="space-y-4">
          <div className="h-44 bg-[#141414] rounded-2xl animate-pulse" />
          <div className="h-44 bg-[#141414] rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl pb-20">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#292929]">
        <div className="flex items-center gap-2.5">
          <SettingsIcon size={22} className="text-white" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Settings & Preferences
            </h1>
            <p className="text-xs text-[#707070]">
              Configure player behavior, skipping rules, audio defaults, and interface layout.
            </p>
          </div>
        </div>

        {savedNotification && (
          <div className="flex items-center gap-1.5 text-xs text-white font-medium bg-[#141414] px-3 py-1.5 rounded-lg border border-[#292929] animate-fadeIn">
            <CheckCircle2 size={14} />
            <span>Preferences saved</span>
          </div>
        )}
      </div>

      {/* Video Player Settings */}
      <section className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-6">
        <div className="flex items-center gap-2 pb-2 border-b border-[#292929]">
          <Play size={18} className="text-white" />
          <h2 className="text-base font-bold text-white">
            Video Player & Playback
          </h2>
        </div>

        <div className="space-y-4 divide-y divide-[#292929]">
          {/* Default Audio */}
          <div className="flex items-center justify-between pt-3 first:pt-0">
            <div>
              <div className="text-sm font-semibold text-white">
                Default Audio Mode
              </div>
              <div className="text-xs text-[#707070] mt-0.5">
                Preferred audio format for streaming episodes when both are available.
              </div>
            </div>
            <div className="flex items-center bg-[#141414] border border-[#292929] rounded-lg p-0.5">
              <button
                onClick={() => updatePreference('defaultAudio', 'sub')}
                className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                  prefs.defaultAudio === 'sub'
                    ? 'bg-white text-black font-semibold'
                    : 'text-[#A0A0A0] hover:text-white'
                }`}
              >
                SUB
              </button>
              <button
                onClick={() => updatePreference('defaultAudio', 'dub')}
                className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                  prefs.defaultAudio === 'dub'
                    ? 'bg-white text-black font-semibold'
                    : 'text-[#A0A0A0] hover:text-white'
                }`}
              >
                DUB
              </button>
            </div>
          </div>

          {/* Auto-Play Next Episode */}
          <div className="flex items-center justify-between pt-4">
            <div>
              <div className="text-sm font-semibold text-white">
                Auto-Play Next Episode
              </div>
              <div className="text-xs text-[#707070] mt-0.5">
                Automatically transition to the next episode when current video finishes.
              </div>
            </div>
            <button
              onClick={() => updatePreference('autoPlayNext', !prefs.autoPlayNext)}
              className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors ${
                prefs.autoPlayNext ? 'bg-white justify-end' : 'bg-[#292929] justify-start'
              }`}
              aria-label="Toggle auto-play next episode"
            >
              <div
                className={`w-4 h-4 rounded-full transition-transform ${
                  prefs.autoPlayNext ? 'bg-black' : 'bg-[#707070]'
                }`}
              />
            </button>
          </div>

          {/* Auto-Skip Intro */}
          <div className="flex items-center justify-between pt-4">
            <div>
              <div className="text-sm font-semibold text-white">
                Auto-Skip Opening Theme (AniSkip)
              </div>
              <div className="text-xs text-[#707070] mt-0.5">
                Automatically jump past opening sequence when valid timestamps are available.
              </div>
            </div>
            <button
              onClick={() => updatePreference('autoSkipIntro', !prefs.autoSkipIntro)}
              className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors ${
                prefs.autoSkipIntro ? 'bg-white justify-end' : 'bg-[#292929] justify-start'
              }`}
              aria-label="Toggle auto-skip opening"
            >
              <div
                className={`w-4 h-4 rounded-full transition-transform ${
                  prefs.autoSkipIntro ? 'bg-black' : 'bg-[#707070]'
                }`}
              />
            </button>
          </div>

          {/* Auto-Skip Outro */}
          <div className="flex items-center justify-between pt-4">
            <div>
              <div className="text-sm font-semibold text-white">
                Auto-Skip Ending Theme (AniSkip)
              </div>
              <div className="text-xs text-[#707070] mt-0.5">
                Automatically jump past ending sequence when valid timestamps are available.
              </div>
            </div>
            <button
              onClick={() => updatePreference('autoSkipOutro', !prefs.autoSkipOutro)}
              className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors ${
                prefs.autoSkipOutro ? 'bg-white justify-end' : 'bg-[#292929] justify-start'
              }`}
              aria-label="Toggle auto-skip ending"
            >
              <div
                className={`w-4 h-4 rounded-full transition-transform ${
                  prefs.autoSkipOutro ? 'bg-black' : 'bg-[#707070]'
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      {/* Interface & Appearance Settings */}
      <section className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-6">
        <div className="flex items-center gap-2 pb-2 border-b border-[#292929]">
          <Palette size={18} className="text-white" />
          <h2 className="text-base font-bold text-white">
            Interface & Layout
          </h2>
        </div>

        <div className="space-y-4 divide-y divide-[#292929]">
          {/* Sidebar Mode */}
          <div className="flex items-center justify-between pt-3 first:pt-0">
            <div>
              <div className="text-sm font-semibold text-white">
                Sidebar Navigation Mode
              </div>
              <div className="text-xs text-[#707070] mt-0.5">
                Expand labels or collapse sidebar to icon-only rail (76px).
              </div>
            </div>
            <div className="flex items-center bg-[#141414] border border-[#292929] rounded-lg p-0.5">
              <button
                onClick={() => updatePreference('sidebarCollapsed', false)}
                className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                  !prefs.sidebarCollapsed
                    ? 'bg-white text-black font-semibold'
                    : 'text-[#A0A0A0] hover:text-white'
                }`}
              >
                Expanded
              </button>
              <button
                onClick={() => updatePreference('sidebarCollapsed', true)}
                className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                  prefs.sidebarCollapsed
                    ? 'bg-white text-black font-semibold'
                    : 'text-[#A0A0A0] hover:text-white'
                }`}
              >
                Collapsed
              </button>
            </div>
          </div>

          {/* Theme Note */}
          <div className="flex items-center justify-between pt-4">
            <div>
              <div className="text-sm font-semibold text-white">
                Color Theme
              </div>
              <div className="text-xs text-[#707070] mt-0.5">
                Strict premium monochrome black & white design system.
              </div>
            </div>
            <span className="text-xs font-mono text-[#A0A0A0] border border-[#292929] px-2.5 py-1 rounded-lg">
              Pure Monochrome
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
