'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Film,
  Search,
  Star,
  Pin,
  Plus,
  Trash2,
  Save,
  Loader2,
  CheckCircle2,
  Layers,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { hasAdminPermission } from '@/lib/admin/admin-auth';
import {
  AnimeManagementFirestoreDoc,
  CustomAnimeCollection,
  DEFAULT_ANIME_MANAGEMENT_CONFIG,
  FeaturedAnimeItem,
  getAnimeManagementDoc,
  saveAnimeManagementDoc,
} from '@/lib/admin/admin-firestore';
import { HoshikaAnimeItem } from '@/types/anime';

export default function AdminAnimeManagementPage() {
  const { adminRecord } = useAuth();
  const canManage = hasAdminPermission(adminRecord, 'manageAnime');

  const [config, setConfig] = useState<AnimeManagementFirestoreDoc>(
    DEFAULT_ANIME_MANAGEMENT_CONFIG
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<HoshikaAnimeItem[]>([]);
  const [searching, setSearching] = useState(false);

  const [newCollectionTitle, setNewCollectionTitle] = useState('');
  const [newCollectionSub, setNewCollectionSub] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const docData = await getAnimeManagementDoc();
      setConfig(docData);
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
          setSearchResults(data.results || []);
        }
      } catch {
        // Ignore
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const toFeaturedItem = (
    anime: HoshikaAnimeItem,
    order: number
  ): FeaturedAnimeItem => ({
    hoshikaId: anime.shortId,
    title:
      anime.titleEnglish ||
      anime.titleRomaji ||
      anime.titleLocalized ||
      `Anime #${anime.shortId}`,
    coverImage: anime.coverImage || '',
    bannerImage: anime.bannerImage || anime.coverImage || '',
    format: anime.format || 'TV',
    rating: anime.averageScore || 85,
    order,
  });

  const handleAddFeatured = (anime: HoshikaAnimeItem) => {
    if (config.featuredAnimeIds.includes(anime.shortId)) return;
    const item = toFeaturedItem(anime, config.featuredAnime.length + 1);
    setConfig((prev) => ({
      ...prev,
      featuredAnimeIds: [...prev.featuredAnimeIds, anime.shortId],
      featuredAnime: [...prev.featuredAnime, item],
    }));
  };

  const handleRemoveFeatured = (id: number) => {
    setConfig((prev) => ({
      ...prev,
      featuredAnimeIds: prev.featuredAnimeIds.filter((x) => x !== id),
      featuredAnime: prev.featuredAnime.filter((x) => x.hoshikaId !== id),
    }));
  };

  const handleAddSeasonal = (anime: HoshikaAnimeItem) => {
    if (config.pinnedSeasonalIds.includes(anime.shortId)) return;
    const item = toFeaturedItem(anime, config.pinnedSeasonal.length + 1);
    setConfig((prev) => ({
      ...prev,
      pinnedSeasonalIds: [...prev.pinnedSeasonalIds, anime.shortId],
      pinnedSeasonal: [...prev.pinnedSeasonal, item],
    }));
  };

  const handleRemoveSeasonal = (id: number) => {
    setConfig((prev) => ({
      ...prev,
      pinnedSeasonalIds: prev.pinnedSeasonalIds.filter((x) => x !== id),
      pinnedSeasonal: prev.pinnedSeasonal.filter((x) => x.hoshikaId !== id),
    }));
  };

  const handleCreateCollection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionTitle.trim()) return;
    const newCol: CustomAnimeCollection = {
      id: `col_${Date.now()}`,
      title: newCollectionTitle.trim(),
      subtitle: newCollectionSub.trim() || 'Curated by AniScroll Editors',
      animeIds: [],
      animeItems: [],
    };
    setConfig((prev) => ({
      ...prev,
      collections: [...prev.collections, newCol],
    }));
    setNewCollectionTitle('');
    setNewCollectionSub('');
  };

  const handleDeleteCollection = (colId: string) => {
    setConfig((prev) => ({
      ...prev,
      collections: prev.collections.filter((c) => c.id !== colId),
    }));
  };

  const handleSaveAll = async () => {
    if (!canManage) return;
    setSaving(true);
    try {
      const saved = await saveAnimeManagementDoc({
        featuredAnimeIds: config.featuredAnimeIds,
        featuredAnime: config.featuredAnime,
        pinnedSeasonalIds: config.pinnedSeasonalIds,
        pinnedSeasonal: config.pinnedSeasonal,
        collections: config.collections,
        promoBanner: config.promoBanner,
      });
      setConfig(saved);
      showToast('Saved homepage featured anime, seasonal pins, and collections.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save anime curation.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-12 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col items-center justify-center space-y-3">
        <Loader2 size={24} className="animate-spin text-white" />
        <div className="text-xs font-mono uppercase tracking-wider text-[#A0A0A0]">
          Loading Homepage Curation & Seasonal Collections...
        </div>
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

      {/* Top Bar */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
            <Film size={20} />
            <span>Homepage Curation, Seasonal Pins & Collections</span>
          </h2>
          <p className="text-xs text-[#A0A0A0] mt-0.5">
            Feature anime in the homepage hero carousel, pin seasonal highlights, and configure custom editorial collections.
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            <span>Save Curation Changes</span>
          </button>
        )}
      </div>

      {/* Catalogue Search Picker */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-3 text-[#707070]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Hoshika catalogue to add anime to Featured Hero or Seasonal Pins..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs sm:text-sm text-white placeholder-[#707070] focus:outline-none"
          />
          {searching && (
            <Loader2
              size={15}
              className="absolute right-3.5 top-3 animate-spin text-white"
            />
          )}
        </div>

        {searchResults.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
            {searchResults.slice(0, 6).map((anime) => {
              const title =
                anime.titleEnglish ||
                anime.titleRomaji ||
                anime.titleLocalized ||
                `Anime #${anime.shortId}`;
              return (
                <div
                  key={anime.shortId}
                  className="p-3 rounded-xl bg-[#141414] border border-[#292929] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {anime.coverImage && (
                      <div className="w-10 h-14 rounded-lg overflow-hidden relative shrink-0">
                        <Image
                          src={anime.coverImage}
                          alt={title}
                          fill
                          sizes="48px"
                          className="object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        {title}
                      </div>
                      <div className="text-[11px] font-mono text-[#707070]">
                        ID #{anime.shortId}
                      </div>
                    </div>
                  </div>

                  {canManage && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleAddFeatured(anime)}
                        className="px-2.5 py-1.5 rounded-lg bg-white text-black font-bold text-[11px] cursor-pointer"
                        title="Feature on Homepage Hero"
                      >
                        + Hero
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddSeasonal(anime)}
                        className="px-2.5 py-1.5 rounded-lg bg-black border border-[#292929] hover:border-white text-white font-semibold text-[11px] cursor-pointer"
                        title="Pin to Seasonal"
                      >
                        + Pin
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Featured & Pinned Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Featured Hero Anime */}
        <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles size={15} />
              <span>Featured Homepage Hero Anime ({config.featuredAnime.length})</span>
            </h3>
          </div>

          {config.featuredAnime.length === 0 ? (
            <div className="p-6 rounded-xl bg-[#141414] border border-[#292929] text-center text-xs text-[#A0A0A0]">
              Using automatic Hoshika Featured & Trending feed. Search above to pin custom featured anime.
            </div>
          ) : (
            <div className="space-y-2.5">
              {config.featuredAnime.map((item) => (
                <div
                  key={item.hoshikaId}
                  className="p-3 rounded-xl bg-[#141414] border border-[#292929] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {item.coverImage && (
                      <div className="w-9 h-12 rounded overflow-hidden relative shrink-0">
                        <Image
                          src={item.coverImage}
                          alt={item.title}
                          fill
                          sizes="40px"
                          className="object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        {item.title}
                      </div>
                      <div className="text-[11px] font-mono text-[#707070]">
                        Hoshika #{item.hoshikaId}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/admin/artwork/${item.hoshikaId}`}
                      className="px-2.5 py-1 rounded bg-black border border-[#292929] text-[11px] font-mono text-white hover:border-white"
                    >
                      Logo
                    </Link>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => handleRemoveFeatured(item.hoshikaId)}
                        className="p-1.5 rounded bg-black border border-[#292929] text-[#A0A0A0] hover:text-white cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pinned Seasonal Anime */}
        <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Pin size={15} />
              <span>Pinned Seasonal Highlights ({config.pinnedSeasonal.length})</span>
            </h3>
          </div>

          {config.pinnedSeasonal.length === 0 ? (
            <div className="p-6 rounded-xl bg-[#141414] border border-[#292929] text-center text-xs text-[#A0A0A0]">
              No pinned seasonal overrides yet. Use &ldquo;+ Pin&rdquo; in search results above.
            </div>
          ) : (
            <div className="space-y-2.5">
              {config.pinnedSeasonal.map((item) => (
                <div
                  key={item.hoshikaId}
                  className="p-3 rounded-xl bg-[#141414] border border-[#292929] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {item.coverImage && (
                      <div className="w-9 h-12 rounded overflow-hidden relative shrink-0">
                        <Image
                          src={item.coverImage}
                          alt={item.title}
                          fill
                          sizes="40px"
                          className="object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        {item.title}
                      </div>
                      <div className="text-[11px] font-mono text-[#707070]">
                        Hoshika #{item.hoshikaId}
                      </div>
                    </div>
                  </div>

                  {canManage && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSeasonal(item.hoshikaId)}
                      className="p-1.5 rounded bg-black border border-[#292929] text-[#A0A0A0] hover:text-white cursor-pointer"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Custom Editorial Collections */}
      <div className="bg-[#0A0A0A] border border-[#292929] rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Layers size={15} />
          <span>Custom Editorial Collections ({config.collections.length})</span>
        </h3>

        {canManage && (
          <form
            onSubmit={handleCreateCollection}
            className="grid grid-cols-1 md:grid-cols-3 gap-3"
          >
            <input
              type="text"
              value={newCollectionTitle}
              onChange={(e) => setNewCollectionTitle(e.target.value)}
              placeholder="Collection Title (e.g., Dark Fantasy Essentials)"
              className="px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white placeholder-[#707070] focus:outline-none focus:border-white"
            />
            <input
              type="text"
              value={newCollectionSub}
              onChange={(e) => setNewCollectionSub(e.target.value)}
              placeholder="Subtitle description..."
              className="px-3.5 py-2 rounded-xl bg-[#141414] border border-[#292929] text-xs text-white placeholder-[#707070] focus:outline-none focus:border-white"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-bold text-white cursor-pointer"
            >
              <Plus size={14} />
              <span>Create Collection</span>
            </button>
          </form>
        )}

        {config.collections.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            {config.collections.map((col) => (
              <div
                key={col.id}
                className="p-4 rounded-xl bg-[#141414] border border-[#292929] flex items-center justify-between gap-3"
              >
                <div>
                  <div className="text-xs font-bold text-white">{col.title}</div>
                  <div className="text-[11px] text-[#A0A0A0]">{col.subtitle}</div>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleDeleteCollection(col.id)}
                    className="p-1.5 rounded bg-black border border-[#292929] text-[#A0A0A0] hover:text-white cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
