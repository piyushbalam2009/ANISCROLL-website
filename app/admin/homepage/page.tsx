'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  LayoutTemplate,
  Save,
  Search,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
  CheckCircle2,
  Sparkles,
  FolderPlus,
} from 'lucide-react';
import { getAdminAuthHeaders } from '@/lib/admin/admin-auth';
import {
  AnimeManagementFirestoreDoc,
  CustomAnimeCollection,
  DEFAULT_ANIME_MANAGEMENT_CONFIG,
  FeaturedAnimeItem,
} from '@/lib/admin/admin-firestore';
import { HoshikaAnimeItem } from '@/types/anime';
import { ResilientImage } from '@/components/ui/ResilientImage';

const SECTION_LABELS: Record<string, string> = {
  continue_watching: 'Continue Watching',
  trending: 'Trending Now',
  seasonal: 'Seasonal Highlights',
  popular: 'All-Time Popular',
  recent: 'Recently Updated',
  collections: 'Editorial Collections',
  promo_banner: 'Promo Spotlight Banner',
};

function toFeaturedItem(anime: HoshikaAnimeItem, order: number): FeaturedAnimeItem {
  return {
    hoshikaId: anime.shortId,
    title: anime.titleEnglish || anime.titleRomaji || `Anime #${anime.shortId}`,
    coverImage: anime.coverImage || '',
    bannerImage: anime.bannerImage || anime.coverImage || '',
    format: anime.format || 'TV',
    rating: Number(anime.averageScore || 0),
    order,
  };
}

export default function AdminHomepageCurationPage() {
  const [config, setConfig] = useState<Omit<AnimeManagementFirestoreDoc, 'createdAt' | 'updatedAt'>>(
    DEFAULT_ANIME_MANAGEMENT_CONFIG
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Search modal/drawer target
  const [pickerTarget, setPickerTarget] = useState<
    { type: 'featured' } | { type: 'seasonal' } | { type: 'collection'; collectionId: string }
  >({ type: 'featured' });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HoshikaAnimeItem[]>([]);
  const [searching, setSearching] = useState(false);

  // New collection draft
  const [newColTitle, setNewColTitle] = useState('');
  const [newColSubtitle, setNewColSubtitle] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/homepage', { headers, cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.config) {
        throw new Error(data?.error || `Failed to load homepage config (${res.status})`);
      }
      setConfig({
        ...DEFAULT_ANIME_MANAGEMENT_CONFIG,
        ...data.config,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load homepage config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(
            (data.results || []).filter((x: HoshikaAnimeItem) => Boolean(x?.shortId))
          );
        }
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      const res = await fetch('/api/admin/homepage', {
        method: 'POST',
        headers,
        body: JSON.stringify(config),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Failed to save homepage config (${res.status})`);
      }
      setConfig(data.config);
      showToast('Homepage curation saved and public home revalidated.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const addAnimeToTarget = (anime: HoshikaAnimeItem) => {
    if (pickerTarget.type === 'featured') {
      if (config.featuredAnime.some((a) => a.hoshikaId === anime.shortId)) return;
      const next = [...config.featuredAnime, toFeaturedItem(anime, config.featuredAnime.length)];
      setConfig({
        ...config,
        featuredAnime: next,
        featuredAnimeIds: next.map((a) => a.hoshikaId),
      });
    } else if (pickerTarget.type === 'seasonal') {
      if (config.pinnedSeasonal.some((a) => a.hoshikaId === anime.shortId)) return;
      const next = [...config.pinnedSeasonal, toFeaturedItem(anime, config.pinnedSeasonal.length)];
      setConfig({
        ...config,
        pinnedSeasonal: next,
        pinnedSeasonalIds: next.map((a) => a.hoshikaId),
      });
    } else {
      const colId = pickerTarget.collectionId;
      const nextCols = config.collections.map((col) => {
        if (col.id !== colId) return col;
        if (col.animeItems.some((a) => a.hoshikaId === anime.shortId)) return col;
        const nextItems = [...col.animeItems, toFeaturedItem(anime, col.animeItems.length)];
        return {
          ...col,
          animeItems: nextItems,
          animeIds: nextItems.map((a) => a.hoshikaId),
        };
      });
      setConfig({ ...config, collections: nextCols });
    }
  };

  const moveSection = (idx: number, dir: -1 | 1) => {
    const order = [...(config.sectionOrder || DEFAULT_ANIME_MANAGEMENT_CONFIG.sectionOrder!)];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= order.length) return;
    const temp = order[idx]!;
    order[idx] = order[swapIdx]!;
    order[swapIdx] = temp;
    setConfig({ ...config, sectionOrder: order });
  };

  const toggleSectionEnabled = (key: string) => {
    const current = {
      ...DEFAULT_ANIME_MANAGEMENT_CONFIG.enabledSections!,
      ...(config.enabledSections || {}),
    };
    current[key] = current[key] === false;
    setConfig({ ...config, enabledSections: current });
  };

  const createCollection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newColTitle.trim()) return;
    const newCol: CustomAnimeCollection = {
      id: `col_${Date.now()}`,
      title: newColTitle.trim(),
      subtitle: newColSubtitle.trim(),
      animeIds: [],
      animeItems: [],
    };
    setConfig({ ...config, collections: [...config.collections, newCol] });
    setPickerTarget({ type: 'collection', collectionId: newCol.id });
    setNewColTitle('');
    setNewColSubtitle('');
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
          <div className="text-[11px] font-mono uppercase tracking-widest text-[#707070]">
            Homepage Curation &amp; Editorial Layout
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2 mt-0.5">
            <LayoutTemplate size={19} />
            <span>Homepage Manager &amp; Featured Collections</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Control hero slides, pinned seasonal anime, editorial collections, promo spotlight banner, and public section order.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs cursor-pointer disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          <span>Publish Homepage Layout</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Anime Search Picker */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="text-sm font-bold text-white">Add Anime to Selected Target</div>
          <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
            <button
              type="button"
              onClick={() => setPickerTarget({ type: 'featured' })}
              className={`px-2.5 py-1 rounded-lg cursor-pointer ${
                pickerTarget.type === 'featured'
                  ? 'bg-white text-black font-bold'
                  : 'bg-[#141414] text-[#A0A0A0] border border-[#292929]'
              }`}
            >
              Hero Carousel
            </button>
            <button
              type="button"
              onClick={() => setPickerTarget({ type: 'seasonal' })}
              className={`px-2.5 py-1 rounded-lg cursor-pointer ${
                pickerTarget.type === 'seasonal'
                  ? 'bg-white text-black font-bold'
                  : 'bg-[#141414] text-[#A0A0A0] border border-[#292929]'
              }`}
            >
              Pinned Seasonal
            </button>
            {config.collections.map((col) => (
              <button
                key={col.id}
                type="button"
                onClick={() => setPickerTarget({ type: 'collection', collectionId: col.id })}
                className={`px-2.5 py-1 rounded-lg cursor-pointer ${
                  pickerTarget.type === 'collection' && pickerTarget.collectionId === col.id
                    ? 'bg-white text-black font-bold'
                    : 'bg-[#141414] text-[#A0A0A0] border border-[#292929]'
                }`}
              >
                {col.title}
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-3 text-[#707070]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Hoshika catalogue to add an anime..."
            className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs text-white placeholder-[#707070] focus:outline-none"
          />
          {searching && (
            <Loader2 size={14} className="absolute right-3.5 top-3 animate-spin text-white" />
          )}
        </div>

        {searchResults.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {searchResults.slice(0, 6).map((item) => {
              const title =
                item.titleEnglish || item.titleRomaji || `Anime #${item.shortId}`;
              return (
                <div
                  key={item.shortId}
                  className="p-2.5 rounded-xl bg-[#141414] border border-[#292929] flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {item.coverImage && (
                      <div className="w-8 h-11 rounded overflow-hidden relative shrink-0 border border-[#292929]">
                        <ResilientImage
                          src={item.coverImage}
                          alt={title}
                          fill
                          sizes="40px"
                          className="object-cover"
                        />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{title}</div>
                      <div className="text-[10px] font-mono text-[#707070]">
                        #{item.shortId} · {item.format || 'TV'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => addAnimeToTarget(item)}
                    className="p-1.5 rounded-lg bg-white text-black hover:bg-neutral-200 cursor-pointer shrink-0"
                    title="Add anime"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Featured Hero & Pinned Seasonal */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">
              Featured Hero Carousel ({config.featuredAnime.length})
            </h3>
            <span className="text-[11px] font-mono text-[#707070]">Hero slides priority</span>
          </div>
          {config.featuredAnime.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#707070] border border-dashed border-[#292929] rounded-xl">
              No custom hero slides pinned — automatic trending slides will be used.
            </div>
          ) : (
            <div className="space-y-2">
              {config.featuredAnime.map((item, idx) => (
                <div
                  key={item.hoshikaId}
                  className="p-2.5 rounded-xl bg-[#141414] border border-[#292929] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-[11px] font-mono text-[#707070] w-5">
                      #{idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        {item.title}
                      </div>
                      <div className="text-[10px] font-mono text-[#707070]">
                        ID #{item.hoshikaId} · {item.format}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = config.featuredAnime.filter(
                        (a) => a.hoshikaId !== item.hoshikaId
                      );
                      setConfig({
                        ...config,
                        featuredAnime: next,
                        featuredAnimeIds: next.map((a) => a.hoshikaId),
                      });
                    }}
                    className="p-1.5 rounded-lg text-[#707070] hover:text-red-400 cursor-pointer"
                    aria-label={`Remove ${item.title}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">
              Pinned Seasonal Highlights ({config.pinnedSeasonal.length})
            </h3>
            <span className="text-[11px] font-mono text-[#707070]">Prepended to Seasonal</span>
          </div>
          {config.pinnedSeasonal.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#707070] border border-dashed border-[#292929] rounded-xl">
              No seasonal pins set yet.
            </div>
          ) : (
            <div className="space-y-2">
              {config.pinnedSeasonal.map((item) => (
                <div
                  key={item.hoshikaId}
                  className="p-2.5 rounded-xl bg-[#141414] border border-[#292929] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">
                      {item.title}
                    </div>
                    <div className="text-[10px] font-mono text-[#707070]">
                      ID #{item.hoshikaId} · {item.format}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = config.pinnedSeasonal.filter(
                        (a) => a.hoshikaId !== item.hoshikaId
                      );
                      setConfig({
                        ...config,
                        pinnedSeasonal: next,
                        pinnedSeasonalIds: next.map((a) => a.hoshikaId),
                      });
                    }}
                    className="p-1.5 rounded-lg text-[#707070] hover:text-red-400 cursor-pointer"
                    aria-label={`Remove ${item.title}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Editorial Collections */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <FolderPlus size={16} />
            <span>Custom Editorial Collections ({config.collections.length})</span>
          </h3>
        </div>

        <form onSubmit={createCollection} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="text"
            value={newColTitle}
            onChange={(e) => setNewColTitle(e.target.value)}
            placeholder="Collection Title (e.g. Dark Fantasy Essentials)"
            className="px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white"
          />
          <input
            type="text"
            value={newColSubtitle}
            onChange={(e) => setNewColSubtitle(e.target.value)}
            placeholder="Subtitle / Description"
            className="px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white"
          />
          <button
            type="submit"
            disabled={!newColTitle.trim()}
            className="px-4 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-bold text-white cursor-pointer disabled:opacity-40"
          >
            + Create Collection
          </button>
        </form>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {config.collections.map((col) => (
            <div
              key={col.id}
              className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-white">{col.title}</div>
                  {col.subtitle && (
                    <div className="text-[11px] text-[#A0A0A0]">{col.subtitle}</div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPickerTarget({ type: 'collection', collectionId: col.id })}
                    className="px-2 py-1 rounded bg-[#0A0A0A] border border-[#292929] text-[10px] font-mono text-white hover:border-white cursor-pointer"
                  >
                    + Add Anime
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setConfig({
                        ...config,
                        collections: config.collections.filter((c) => c.id !== col.id),
                      })
                    }
                    className="p-1 text-[#707070] hover:text-red-400 cursor-pointer"
                    aria-label={`Delete collection ${col.title}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {col.animeItems.length === 0 ? (
                <div className="text-[11px] text-[#707070] font-mono">
                  Empty collection — select &ldquo;+ Add Anime&rdquo; and use the search picker above.
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {col.animeItems.map((anime) => (
                    <span
                      key={anime.hoshikaId}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0A0A0A] border border-[#292929] text-[11px] text-white"
                    >
                      <span className="truncate max-w-[140px]">{anime.title}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setConfig({
                            ...config,
                            collections: config.collections.map((c) =>
                              c.id !== col.id
                                ? c
                                : {
                                    ...c,
                                    animeItems: c.animeItems.filter(
                                      (a) => a.hoshikaId !== anime.hoshikaId
                                    ),
                                    animeIds: c.animeIds.filter((id) => id !== anime.hoshikaId),
                                  }
                            ),
                          });
                        }}
                        className="text-[#707070] hover:text-red-400 cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Promo Spotlight Banner + Section Ordering */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles size={15} />
              <span>Promo Spotlight Banner</span>
            </h3>
            <label className="inline-flex items-center gap-2 text-xs font-mono text-white cursor-pointer">
              <input
                type="checkbox"
                checked={config.promoBanner.enabled}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    promoBanner: { ...config.promoBanner, enabled: e.target.checked },
                  })
                }
                className="accent-white w-4 h-4"
              />
              <span>Enabled</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={config.promoBanner.badgeText}
              onChange={(e) =>
                setConfig({
                  ...config,
                  promoBanner: { ...config.promoBanner, badgeText: e.target.value },
                })
              }
              placeholder="Badge (e.g. FEATURED SPOTLIGHT)"
              className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white"
            />
            <input
              type="number"
              min={0}
              value={config.promoBanner.hoshikaId || ''}
              onChange={(e) =>
                setConfig({
                  ...config,
                  promoBanner: {
                    ...config.promoBanner,
                    hoshikaId: Number(e.target.value) || 0,
                  },
                })
              }
              placeholder="Target Hoshika ID (e.g. 16498)"
              className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white font-mono focus:outline-none focus:border-white"
            />
          </div>

          <input
            type="text"
            value={config.promoBanner.title}
            onChange={(e) =>
              setConfig({
                ...config,
                promoBanner: { ...config.promoBanner, title: e.target.value },
              })
            }
            placeholder="Spotlight Headline"
            className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white"
          />

          <textarea
            rows={2}
            value={config.promoBanner.subtitle}
            onChange={(e) =>
              setConfig({
                ...config,
                promoBanner: { ...config.promoBanner, subtitle: e.target.value },
              })
            }
            placeholder="Spotlight Subtitle"
            className="w-full px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={config.promoBanner.backgroundUrl}
              onChange={(e) =>
                setConfig({
                  ...config,
                  promoBanner: { ...config.promoBanner, backgroundUrl: e.target.value },
                })
              }
              placeholder="Background Image URL (optional)"
              className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white"
            />
            <input
              type="text"
              value={config.promoBanner.ctaText}
              onChange={(e) =>
                setConfig({
                  ...config,
                  promoBanner: { ...config.promoBanner, ctaText: e.target.value },
                })
              }
              placeholder="CTA Button Text (e.g. Watch Now)"
              className="px-3 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white focus:outline-none focus:border-white"
            />
          </div>
        </div>

        {/* Section Order & Visibility */}
        <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-white">Homepage Section Order &amp; Visibility</h3>
          <div className="space-y-2">
            {(config.sectionOrder || DEFAULT_ANIME_MANAGEMENT_CONFIG.sectionOrder!).map(
              (key, idx, arr) => {
                const enabled = config.enabledSections?.[key] !== false;
                return (
                  <div
                    key={key}
                    className="p-2.5 rounded-xl bg-[#141414] border border-[#292929] flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => toggleSectionEnabled(key)}
                        className="accent-white w-4 h-4 cursor-pointer"
                      />
                      <span
                        className={`text-xs font-semibold ${
                          enabled ? 'text-white' : 'text-[#707070] line-through'
                        }`}
                      >
                        {SECTION_LABELS[key] || key}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveSection(idx, -1)}
                        className="p-1.5 rounded-lg bg-[#0A0A0A] border border-[#292929] text-[#A0A0A0] hover:text-white disabled:opacity-30 cursor-pointer"
                        aria-label={`Move ${key} up`}
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        disabled={idx === arr.length - 1}
                        onClick={() => moveSection(idx, 1)}
                        className="p-1.5 rounded-lg bg-[#0A0A0A] border border-[#292929] text-[#A0A0A0] hover:text-white disabled:opacity-30 cursor-pointer"
                        aria-label={`Move ${key} down`}
                      >
                        <ArrowDown size={12} />
                      </button>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
