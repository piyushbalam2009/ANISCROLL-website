'use client';

import React from 'react';
import { ResilientImage } from '@/components/ui/ResilientImage';
import {
  Check,
  EyeOff,
  Eye,
  Trash2,
  Type,
  ThumbsUp,
  Globe,
  Sparkles,
} from 'lucide-react';
import { CustomLogoItem, FanartLogoItem } from '@/types/artwork';

interface LogoSelectorProps {
  availableLogos: FanartLogoItem[];
  customLogos: CustomLogoItem[];
  hiddenLogoIds: string[];
  selectedLogoUrl: string | null;
  selectedLogoSource: string;
  selectionMode: 'auto' | 'manual';
  canDeleteCustom: boolean;
  onSelectLogo: (params: {
    url: string;
    source:
      | 'fanart_hdtvlogo'
      | 'fanart_clearlogo'
      | 'custom_upload'
      | 'typography_fallback';
    lang: string;
  }) => void;
  onToggleHideLogo: (logoId: string) => void;
  onDeleteCustomLogo: (customLogo: CustomLogoItem) => void;
}

export function LogoSelector({
  availableLogos,
  customLogos,
  hiddenLogoIds,
  selectedLogoUrl,
  selectedLogoSource,
  selectionMode,
  canDeleteCustom,
  onSelectLogo,
  onToggleHideLogo,
  onDeleteCustomLogo,
}: LogoSelectorProps) {
  const hiddenSet = new Set(hiddenLogoIds);

  const isSelected = (url: string) => {
    if (!selectedLogoUrl || !url) return false;
    return selectedLogoUrl === url;
  };

  return (
    <div className="space-y-6">
      {/* 1. Custom Uploaded Logos Section */}
      {customLogos.length > 0 && (
        <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles size={15} />
                <span>Custom Uploaded Transparent Logos ({customLogos.length})</span>
              </h3>
              <p className="text-xs text-[#A0A0A0] mt-0.5">
                Stored in Supabase Storage (aniscroll-artwork) under anime-logos/
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {customLogos.map((custom) => {
              const active = isSelected(custom.url) || isSelected(custom.proxyUrl);
              return (
                <div
                  key={custom.id}
                  className={`rounded-xl border p-4 flex flex-col justify-between gap-3 transition-all ${
                    active
                      ? 'bg-[#141414] border-white ring-1 ring-white'
                      : 'bg-[#0F0F0F] border-[#292929] hover:border-white/40'
                  }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                      <span className="px-2 py-0.5 rounded bg-white text-black font-bold uppercase">
                        CUSTOM UPLOAD
                      </span>
                      <span className="text-[#A0A0A0]">
                        {custom.width}×{custom.height}px •{' '}
                        {Math.round(custom.fileSize / 1024)}KB
                      </span>
                    </div>

                    {/* Dark Transparent Canvas */}
                    <div className="relative h-28 w-full rounded-lg bg-[#050505] border border-[#292929] flex items-center justify-center p-3 overflow-hidden">
                      <ResilientImage
                        src={custom.url}
                        fallbackSrcs={[custom.proxyUrl]}
                        alt={custom.fileName}
                        fill
                        sizes="320px"
                        className="object-contain p-3"
                        fallback={
                          <span className="text-[11px] font-mono text-[#707070] truncate px-2">
                            {custom.fileName}
                          </span>
                        }
                      />
                    </div>

                    <div className="text-[11px] font-mono text-[#707070] truncate">
                      {custom.fileName} • by {custom.uploadedByEmail}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        onSelectLogo({
                          url: custom.url,
                          source: 'custom_upload',
                          lang: custom.lang || 'en',
                        })
                      }
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                        active
                          ? 'bg-white text-black'
                          : 'bg-[#1B1B1B] border border-[#292929] text-white hover:border-white'
                      }`}
                    >
                      <Check size={13} />
                      <span>{active ? 'Active Primary Logo' : 'Use Custom Logo'}</span>
                    </button>

                    {canDeleteCustom && (
                      <button
                        type="button"
                        onClick={() => onDeleteCustomLogo(custom)}
                        className="p-2 rounded-lg bg-[#1B1B1B] border border-[#292929] text-[#A0A0A0] hover:text-white hover:border-white transition-colors cursor-pointer"
                        title="Delete custom logo from Firebase Storage"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. Fanart.tv HDTVLOGO & CLEARLOGO Candidates */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white">
              Fanart.tv Transparent Logos ({availableLogos.length})
            </h3>
            <p className="text-xs text-[#A0A0A0] mt-0.5">
              Sorted by strict priority: English HDTVLogo → English ClearLogo → Japanese HDTVLogo → Japanese ClearLogo. AniZip logos are strictly excluded.
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-md bg-[#141414] border border-[#292929] font-mono text-[11px] text-white">
            Mode: {selectionMode.toUpperCase()}
          </span>
        </div>

        {availableLogos.length === 0 ? (
          <div className="p-8 rounded-xl bg-[#0F0F0F] border border-[#292929] text-center space-y-2">
            <div className="text-sm font-bold text-white">
              No Fanart.tv Transparent Logos Found
            </div>
            <p className="text-xs text-[#A0A0A0] max-w-md mx-auto">
              Fanart.tv did not return any hdtvlogo or clearlogo assets for this TVDB/TMDB ID. Upload a custom transparent PNG/WebP logo below or use the Typography Fallback.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {availableLogos.map((logo, idx) => {
              const hidden = hiddenSet.has(logo.id);
              const active =
                isSelected(logo.proxyUrl) || isSelected(logo.url);

              return (
                <div
                  key={logo.id}
                  className={`rounded-xl border p-4 flex flex-col justify-between gap-3 transition-all ${
                    active
                      ? 'bg-[#141414] border-white ring-1 ring-white'
                      : hidden
                      ? 'bg-[#080808] border-[#222222] opacity-55'
                      : 'bg-[#0F0F0F] border-[#292929] hover:border-white/40'
                  }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded bg-white/10 border border-white/15 text-white font-bold uppercase">
                          {logo.category}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-black border border-[#292929] text-white uppercase inline-flex items-center gap-1">
                          <Globe size={10} />
                          {logo.lang || 'EN'}
                        </span>
                        {idx === 0 && !hidden && (
                          <span className="px-1.5 py-0.5 rounded bg-white text-black font-bold">
                            #1 AUTO
                          </span>
                        )}
                      </div>

                      <span className="inline-flex items-center gap-1 text-[#A0A0A0] tabular-nums">
                        <ThumbsUp size={11} />
                        {logo.likes}
                      </span>
                    </div>

                    {/* Transparent Logo Preview Container */}
                    <div className="relative h-28 w-full rounded-lg bg-[#050505] border border-[#292929] flex items-center justify-center p-3 overflow-hidden">
                      <ResilientImage
                        src={logo.proxyUrl || logo.url}
                        fallbackSrcs={[logo.url]}
                        alt={logo.label || logo.category}
                        fill
                        sizes="320px"
                        className="object-contain p-3"
                        fallback={
                          <span className="text-[11px] font-mono text-[#707070]">
                            Logo preview unavailable
                          </span>
                        }
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        onSelectLogo({
                          url: logo.proxyUrl || logo.url,
                          source: logo.source,
                          lang: logo.lang || 'en',
                        })
                      }
                      disabled={hidden}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 ${
                        active
                          ? 'bg-white text-black'
                          : 'bg-[#1B1B1B] border border-[#292929] text-white hover:border-white'
                      }`}
                    >
                      <Check size={13} />
                      <span>{active ? 'Selected Primary' : 'Select Logo'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onToggleHideLogo(logo.id)}
                      className="p-2 rounded-lg bg-[#1B1B1B] border border-[#292929] text-[#A0A0A0] hover:text-white hover:border-white transition-colors cursor-pointer"
                      title={
                        hidden
                          ? 'Unhide logo candidate'
                          : 'Hide unsuitable logo candidate'
                      }
                    >
                      {hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 3. Typography Fallback Option */}
        <div className="pt-2 border-t border-[#292929] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-[#A0A0A0]">
            <Type size={15} className="text-white" />
            <span>
              Prefer clean Hoshika title typography instead of a graphical logo?
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              onSelectLogo({
                url: '',
                source: 'typography_fallback',
                lang: 'en',
              })
            }
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
              selectedLogoSource === 'typography_fallback' && selectionMode === 'manual'
                ? 'bg-white text-black border-white'
                : 'bg-[#141414] text-white border-[#292929] hover:border-white'
            }`}
          >
            {selectedLogoSource === 'typography_fallback' && selectionMode === 'manual'
              ? 'Typography Fallback Active'
              : 'Force Title Typography Fallback'}
          </button>
        </div>
      </div>
    </div>
  );
}
