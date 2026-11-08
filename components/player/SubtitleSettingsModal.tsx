'use client';

import React, { useState } from 'react';
import {
  SubtitlePreferences,
  SubtitleFontFamily,
  SubtitleFontWeight,
  SubtitleTextColorPreset,
  SubtitleOutline,
  SubtitleShadow,
  SubtitlePosition,
  SubtitleAlignment,
} from '@/types/streaming';
import {
  X,
  RotateCcw,
  Sliders,
  Type,
  Palette,
  Clock,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from 'lucide-react';
import { getSubtitleCueStyles } from '@/lib/subtitle-styles';

interface SubtitleSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: SubtitlePreferences;
  onUpdatePreferences: (prefs: Partial<SubtitlePreferences>) => void;
  onResetPreferences: () => void;
}

const FONT_FAMILIES: SubtitleFontFamily[] = [
  'Arial',
  'Roboto',
  'Verdana',
  'Georgia',
  'Monospace',
  'System default',
];

const COLOR_PRESETS = [
  { label: 'White', value: '#FFFFFF' },
  { label: 'Yellow', value: '#FFE600' },
  { label: 'Green', value: '#00E676' },
  { label: 'Cyan', value: '#00E5FF' },
];

const BG_COLOR_PRESETS = [
  { label: 'Black', value: '#000000' },
  { label: 'Dark Grey', value: '#1A1A1A' },
  { label: 'Charcoal', value: '#2A2A2A' },
];

export function SubtitleSettingsModal({
  isOpen,
  onClose,
  preferences,
  onUpdatePreferences,
  onResetPreferences,
}: SubtitleSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<'font' | 'color' | 'effects' | 'sync'>('font');

  if (!isOpen) return null;

  // Custom preview subtitle text
  const previewSampleText = 'On that day, mankind received a grim reminder.';

  // Position alignment styling for the live preview
  const getPreviewPositionClasses = (pos: SubtitlePosition) => {
    switch (pos) {
      case 'Top':
        return 'top-4';
      case 'Middle':
        return 'top-1/2 -translate-y-1/2';
      case 'Bottom':
      default:
        return 'bottom-4';
    }
  };

  const getPreviewAlignmentClasses = (align: SubtitleAlignment) => {
    switch (align) {
      case 'Left':
        return 'justify-start text-left pl-6';
      case 'Right':
        return 'justify-end text-right pr-6';
      case 'Center':
      default:
        return 'justify-center text-center';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm select-none">
      <div
        className="w-full max-w-2xl bg-[#0A0A0A] border border-[#292929] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[#292929] flex items-center justify-between shrink-0 bg-[#0F0F0F]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#141414] border border-[#292929] flex items-center justify-center">
              <Sliders size={16} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide">
                Subtitle Customization
              </h2>
              <p className="text-[11px] text-[#707070]">
                Typography, appearance, and audio synchronization
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onResetPreferences}
              className="px-2.5 py-1.5 rounded-lg border border-[#292929] hover:border-[#404040] hover:bg-[#141414] text-xs text-[#A0A0A0] hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Reset all subtitle settings to default"
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#707070] hover:text-white hover:bg-[#141414] transition-colors cursor-pointer"
              aria-label="Close subtitle settings"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Live Preview Stage (Always Visible) */}
        <div className="p-4 sm:p-5 border-b border-[#292929] bg-[#050505] shrink-0">
          <div className="flex items-center justify-between pb-2 text-[10px] uppercase font-semibold text-[#707070] tracking-wider">
            <span>Live Subtitle Preview</span>
            <span className="font-mono text-[#A0A0A0]">
              {preferences.offsetSeconds !== 0
                ? `${preferences.offsetSeconds > 0 ? '+' : ''}${preferences.offsetSeconds.toFixed(1)}s Sync`
                : 'In Sync'}
            </span>
          </div>

          {/* Simulated 16:9 Video Canvas */}
          <div className="relative w-full h-36 sm:h-44 rounded-xl border border-[#292929] bg-gradient-to-b from-[#141414] via-[#0A0A0A] to-[#000000] overflow-hidden flex flex-col justify-center items-center shadow-inner">
            {/* Subtle video background grid */}
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px]" />

            {/* Video status indicator */}
            <div className="absolute top-2.5 left-3 text-[10px] font-mono text-[#707070] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>AniScroll Player 1080p</span>
            </div>

            {/* Rendered Live Subtitle */}
            <div
              className={`absolute inset-x-0 flex items-center ${getPreviewPositionClasses(
                preferences.position
              )} ${getPreviewAlignmentClasses(preferences.alignment)}`}
            >
              <span
                style={getSubtitleCueStyles(
                  preferences,
                  typeof window !== 'undefined' && window.innerWidth < 640 ? 0.75 : 0.85
                )}
              >
                {previewSampleText}
              </span>
            </div>
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="flex border-b border-[#292929] px-4 bg-[#0A0A0A] shrink-0 text-xs font-medium">
          <button
            onClick={() => setActiveTab('font')}
            className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'font'
                ? 'border-white text-white font-semibold'
                : 'border-transparent text-[#707070] hover:text-[#A0A0A0]'
            }`}
          >
            <Type size={14} />
            <span>Font & Size</span>
          </button>
          <button
            onClick={() => setActiveTab('color')}
            className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'color'
                ? 'border-white text-white font-semibold'
                : 'border-transparent text-[#707070] hover:text-[#A0A0A0]'
            }`}
          >
            <Palette size={14} />
            <span>Colors & Background</span>
          </button>
          <button
            onClick={() => setActiveTab('effects')}
            className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'effects'
                ? 'border-white text-white font-semibold'
                : 'border-transparent text-[#707070] hover:text-[#A0A0A0]'
            }`}
          >
            <Sliders size={14} />
            <span>Outline & Position</span>
          </button>
          <button
            onClick={() => setActiveTab('sync')}
            className={`py-3 px-3 border-b-2 flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'sync'
                ? 'border-white text-white font-semibold'
                : 'border-transparent text-[#707070] hover:text-[#A0A0A0]'
            }`}
          >
            <Clock size={14} />
            <span>Sync ({preferences.offsetSeconds > 0 ? '+' : ''}{preferences.offsetSeconds.toFixed(1)}s)</span>
          </button>
        </div>

        {/* Tab Content Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs text-[#A0A0A0]">
          {/* TAB 1: FONT & SIZE */}
          {activeTab === 'font' && (
            <div className="space-y-6">
              {/* Font Family */}
              <div>
                <label className="block text-white font-medium mb-2.5">Font Family</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {FONT_FAMILIES.map((family) => (
                    <button
                      key={family}
                      onClick={() => onUpdatePreferences({ fontFamily: family })}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        preferences.fontFamily === family
                          ? 'border-white bg-[#1B1B1B] text-white font-semibold'
                          : 'border-[#292929] bg-[#141414] text-[#A0A0A0] hover:text-white hover:border-[#404040]'
                      }`}
                    >
                      <div className="text-xs truncate">{family}</div>
                      <div className="text-[10px] text-[#707070] mt-0.5 truncate">
                        Aa Bb Cc 123
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Size Slider */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-white font-medium">Font Size</label>
                  <span className="font-mono text-white text-xs bg-[#141414] px-2 py-0.5 rounded border border-[#292929]">
                    {preferences.fontSize}px
                  </span>
                </div>
                <input
                  type="range"
                  min={12}
                  max={48}
                  step={1}
                  value={preferences.fontSize}
                  onChange={(e) => onUpdatePreferences({ fontSize: parseInt(e.target.value) })}
                  className="w-full h-1.5 bg-[#292929] accent-white rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-[#707070] mt-1.5">
                  <span>12px (Small)</span>
                  <span>22px (Standard)</span>
                  <span>48px (Extra Large)</span>
                </div>
              </div>

              {/* Font Weight */}
              <div>
                <label className="block text-white font-medium mb-2">Font Weight</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['Normal', 'Bold'] as SubtitleFontWeight[]).map((weight) => (
                    <button
                      key={weight}
                      onClick={() => onUpdatePreferences({ fontWeight: weight })}
                      className={`py-2 px-3 rounded-xl border text-center transition-all cursor-pointer ${
                        preferences.fontWeight === weight
                          ? 'border-white bg-[#1B1B1B] text-white font-semibold'
                          : 'border-[#292929] bg-[#141414] text-[#A0A0A0] hover:text-white hover:border-[#404040]'
                      }`}
                    >
                      <span className={weight === 'Bold' ? 'font-bold' : 'font-normal'}>
                        {weight}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: COLORS & BACKGROUND */}
          {activeTab === 'color' && (
            <div className="space-y-6">
              {/* Text Color */}
              <div>
                <label className="block text-white font-medium mb-2.5">Text Color</label>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  {COLOR_PRESETS.map((c) => {
                    const isSelected =
                      preferences.textColor.toUpperCase() === c.value.toUpperCase();
                    return (
                      <button
                        key={c.label}
                        onClick={() =>
                          onUpdatePreferences({
                            textColor: c.value,
                            textColorPreset: c.label as SubtitleTextColorPreset,
                          })
                        }
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'border-white bg-[#1B1B1B] text-white font-semibold'
                            : 'border-[#292929] bg-[#141414] text-[#A0A0A0] hover:text-white'
                        }`}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-black/40"
                          style={{ backgroundColor: c.value }}
                        />
                        <span>{c.label}</span>
                      </button>
                    );
                  })}

                  {/* Custom Color Input */}
                  <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-[#292929] bg-[#141414]">
                    <input
                      type="color"
                      value={preferences.textColor}
                      onChange={(e) =>
                        onUpdatePreferences({
                          textColor: e.target.value,
                          textColorPreset: 'Custom',
                        })
                      }
                      className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0"
                      title="Choose custom text color"
                    />
                    <span className="font-mono text-[11px] text-[#A0A0A0]">
                      {preferences.textColor}
                    </span>
                  </div>
                </div>
              </div>

              {/* Background Color */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-white font-medium">Background Color</label>
                  <button
                    onClick={() =>
                      onUpdatePreferences({
                        isBackgroundTransparent: !preferences.isBackgroundTransparent,
                      })
                    }
                    className={`text-[11px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                      preferences.isBackgroundTransparent
                        ? 'border-white bg-white text-black font-semibold'
                        : 'border-[#292929] text-[#707070] hover:text-white'
                    }`}
                  >
                    {preferences.isBackgroundTransparent ? 'Fully Transparent' : 'Make Transparent'}
                  </button>
                </div>

                {!preferences.isBackgroundTransparent && (
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    {BG_COLOR_PRESETS.map((bg) => (
                      <button
                        key={bg.label}
                        onClick={() => onUpdatePreferences({ backgroundColor: bg.value })}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                          preferences.backgroundColor === bg.value
                            ? 'border-white bg-[#1B1B1B] text-white font-semibold'
                            : 'border-[#292929] bg-[#141414] text-[#A0A0A0] hover:text-white'
                        }`}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-white/20"
                          style={{ backgroundColor: bg.value }}
                        />
                        <span>{bg.label}</span>
                      </button>
                    ))}
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-[#292929] bg-[#141414]">
                      <input
                        type="color"
                        value={preferences.backgroundColor}
                        onChange={(e) =>
                          onUpdatePreferences({ backgroundColor: e.target.value })
                        }
                        className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0"
                        title="Choose custom background color"
                      />
                      <span className="font-mono text-[10px] text-[#707070]">Custom</span>
                    </div>
                  </div>
                )}

                {/* Background Opacity Slider */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[#A0A0A0]">Background Opacity</span>
                    <span className="font-mono text-white text-xs bg-[#141414] px-2 py-0.5 rounded border border-[#292929]">
                      {preferences.isBackgroundTransparent ? '0%' : `${preferences.backgroundOpacity}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    disabled={preferences.isBackgroundTransparent}
                    value={preferences.isBackgroundTransparent ? 0 : preferences.backgroundOpacity}
                    onChange={(e) =>
                      onUpdatePreferences({
                        backgroundOpacity: parseInt(e.target.value),
                        isBackgroundTransparent: false,
                      })
                    }
                    className="w-full h-1.5 bg-[#292929] accent-white rounded-lg cursor-pointer disabled:opacity-40"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: OUTLINE & EFFECTS */}
          {activeTab === 'effects' && (
            <div className="space-y-6">
              {/* Text Outline */}
              <div>
                <label className="block text-white font-medium mb-2.5">Text Outline (Stroke)</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['None', 'Thin', 'Thick'] as SubtitleOutline[]).map((outline) => (
                    <button
                      key={outline}
                      onClick={() => onUpdatePreferences({ outline })}
                      className={`py-2 px-3 rounded-xl border text-center transition-all cursor-pointer ${
                        preferences.outline === outline
                          ? 'border-white bg-[#1B1B1B] text-white font-semibold'
                          : 'border-[#292929] bg-[#141414] text-[#A0A0A0] hover:text-white'
                      }`}
                    >
                      {outline}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Shadow */}
              <div>
                <label className="block text-white font-medium mb-2.5">Text Shadow</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['Off', 'Light', 'Strong'] as SubtitleShadow[]).map((shadow) => (
                    <button
                      key={shadow}
                      onClick={() => onUpdatePreferences({ shadow })}
                      className={`py-2 px-3 rounded-xl border text-center transition-all cursor-pointer ${
                        preferences.shadow === shadow
                          ? 'border-white bg-[#1B1B1B] text-white font-semibold'
                          : 'border-[#292929] bg-[#141414] text-[#A0A0A0] hover:text-white'
                      }`}
                    >
                      {shadow}
                    </button>
                  ))}
                </div>
              </div>

              {/* Position */}
              <div>
                <label className="block text-white font-medium mb-2.5">Vertical Position</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['Top', 'Middle', 'Bottom'] as SubtitlePosition[]).map((pos) => (
                    <button
                      key={pos}
                      onClick={() => onUpdatePreferences({ position: pos })}
                      className={`py-2 px-3 rounded-xl border text-center transition-all cursor-pointer ${
                        preferences.position === pos
                          ? 'border-white bg-[#1B1B1B] text-white font-semibold'
                          : 'border-[#292929] bg-[#141414] text-[#A0A0A0] hover:text-white'
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>

              {/* Alignment */}
              <div>
                <label className="block text-white font-medium mb-2.5">Horizontal Alignment</label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { label: 'Left', value: 'Left', icon: AlignLeft },
                      { label: 'Center', value: 'Center', icon: AlignCenter },
                      { label: 'Right', value: 'Right', icon: AlignRight },
                    ] as const
                  ).map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.value}
                        onClick={() => onUpdatePreferences({ alignment: item.value })}
                        className={`py-2 px-3 rounded-xl border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                          preferences.alignment === item.value
                            ? 'border-white bg-[#1B1B1B] text-white font-semibold'
                            : 'border-[#292929] bg-[#141414] text-[#A0A0A0] hover:text-white'
                        }`}
                      >
                        <Icon size={14} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SYNCHRONIZATION */}
          {activeTab === 'sync' && (
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-white font-medium">Subtitle Delay Offset</label>
                  <span
                    className={`font-mono text-xs px-2.5 py-0.5 rounded border ${
                      preferences.offsetSeconds === 0
                        ? 'border-[#292929] text-[#A0A0A0] bg-[#141414]'
                        : 'border-white text-black bg-white font-bold'
                    }`}
                  >
                    {preferences.offsetSeconds > 0 ? '+' : ''}
                    {preferences.offsetSeconds.toFixed(1)}s
                  </span>
                </div>

                <input
                  type="range"
                  min={-5.0}
                  max={5.0}
                  step={0.1}
                  value={preferences.offsetSeconds}
                  onChange={(e) =>
                    onUpdatePreferences({ offsetSeconds: parseFloat(e.target.value) })
                  }
                  className="w-full h-1.5 bg-[#292929] accent-white rounded-lg cursor-pointer"
                />

                <div className="flex justify-between text-[10px] text-[#707070] mt-1.5">
                  <span>-5.0s (Earlier)</span>
                  <span>0.0s (In Sync)</span>
                  <span>+5.0s (Later)</span>
                </div>
              </div>

              {/* Quick Stepper Buttons */}
              <div>
                <label className="block text-white font-medium mb-2.5">Quick Step Adjustments</label>
                <div className="grid grid-cols-5 gap-2">
                  <button
                    onClick={() =>
                      onUpdatePreferences({
                        offsetSeconds: Math.max(-5, preferences.offsetSeconds - 0.5),
                      })
                    }
                    className="py-2 rounded-xl border border-[#292929] bg-[#141414] text-white hover:bg-[#1B1B1B] text-center font-mono cursor-pointer"
                  >
                    -0.5s
                  </button>
                  <button
                    onClick={() =>
                      onUpdatePreferences({
                        offsetSeconds: Math.max(-5, preferences.offsetSeconds - 0.1),
                      })
                    }
                    className="py-2 rounded-xl border border-[#292929] bg-[#141414] text-white hover:bg-[#1B1B1B] text-center font-mono cursor-pointer"
                  >
                    -0.1s
                  </button>
                  <button
                    onClick={() => onUpdatePreferences({ offsetSeconds: 0 })}
                    className="py-2 rounded-xl border border-[#292929] bg-[#141414] text-[#A0A0A0] hover:text-white hover:bg-[#1B1B1B] text-center font-mono cursor-pointer"
                  >
                    Reset
                  </button>
                  <button
                    onClick={() =>
                      onUpdatePreferences({
                        offsetSeconds: Math.min(5, preferences.offsetSeconds + 0.1),
                      })
                    }
                    className="py-2 rounded-xl border border-[#292929] bg-[#141414] text-white hover:bg-[#1B1B1B] text-center font-mono cursor-pointer"
                  >
                    +0.1s
                  </button>
                  <button
                    onClick={() =>
                      onUpdatePreferences({
                        offsetSeconds: Math.min(5, preferences.offsetSeconds + 0.5),
                      })
                    }
                    className="py-2 rounded-xl border border-[#292929] bg-[#141414] text-white hover:bg-[#1B1B1B] text-center font-mono cursor-pointer"
                  >
                    +0.5s
                  </button>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-[#292929] bg-[#141414] text-[11px] text-[#707070] space-y-1">
                <p className="text-[#A0A0A0] font-medium">How subtitle delay works:</p>
                <p>
                  • If dialogue is heard <span className="text-white">before</span> the subtitle appears, use a <span className="text-white">negative</span> offset (e.g. -0.5s) to display text earlier.
                </p>
                <p>
                  • If subtitles appear <span className="text-white">before</span> dialogue is spoken, use a <span className="text-white">positive</span> offset (e.g. +0.5s) to delay text.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-[#292929] bg-[#0F0F0F] flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
