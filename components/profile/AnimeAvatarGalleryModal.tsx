'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Search,
  Sparkles,
  Upload,
  Check,
  Loader2,
  User,
  Image as ImageIcon,
  AlertCircle,
  Heart,
} from 'lucide-react';
import { ResilientImage } from '@/components/ui/ResilientImage';
import {
  AnimeCharacterAvatar,
  POPULAR_ANIME_AVATAR_SERIES,
} from '@/lib/anilist-characters';
import { auth } from '@/lib/firebase';

export interface AvatarSelectionPayload {
  photoURL: string;
  avatarCharacterId?: number | null;
  avatarCharacterName?: string | null;
  avatarAnimeName?: string | null;
}

interface AnimeAvatarGalleryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPhotoURL?: string | null;
  onConfirmAvatar: (selection: AvatarSelectionPayload) => Promise<void>;
}

export function AnimeAvatarGalleryModal({
  isOpen,
  onClose,
  currentPhotoURL,
  onConfirmAvatar,
}: AnimeAvatarGalleryModalProps) {
  const [activeTab, setActiveTab] = useState<'gallery' | 'upload'>('gallery');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedSeries, setSelectedSeries] = useState<string>('All Popular');

  const [characters, setCharacters] = useState<AnimeCharacterAvatar[]>([]);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [pendingSelection, setPendingSelection] =
    useState<AnimeCharacterAvatar | null>(null);
  const [saving, setSaving] = useState(false);

  // Optional custom upload tab state
  const [uploadConfigured, setUploadConfigured] = useState<boolean | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Debounce search input cleanly
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 280);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Reset modal selection state when opened
  useEffect(() => {
    if (!isOpen) return;
    setPendingSelection(null);
    setErrorMsg(null);
    setUploadError(null);
  }, [isOpen]);

  // Check if custom Supabase avatar upload is configured when modal opens
  useEffect(() => {
    if (!isOpen || uploadConfigured !== null) return;
    fetch('/api/profile/avatar')
      .then((r) => r.json())
      .then((data) => setUploadConfigured(Boolean(data?.configured)))
      .catch(() => setUploadConfigured(false));
  }, [isOpen, uploadConfigured]);

  const loadCharacters = useCallback(
    async (targetPage: number, append: boolean) => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setErrorMsg(null);

      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          perPage: '24',
        });
        if (debouncedSearch) params.set('q', debouncedSearch);
        if (selectedSeries && selectedSeries !== 'All Popular') {
          params.set('series', selectedSeries);
        }

        const res = await fetch(`/api/characters?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || 'Failed to load anime characters.');
        }

        const incoming: AnimeCharacterAvatar[] = Array.isArray(data.characters)
          ? data.characters
          : [];

        setCharacters((prev) => {
          if (!append) return incoming;
          const seen = new Set(prev.map((c) => c.id));
          const merged = [...prev];
          for (const item of incoming) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              merged.push(item);
            }
          }
          return merged;
        });
        setPage(targetPage);
        setHasNextPage(Boolean(data.hasNextPage));
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setErrorMsg(err?.message || 'Unable to load anime character gallery.');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [debouncedSearch, selectedSeries]
  );

  useEffect(() => {
    if (!isOpen || activeTab !== 'gallery') return;
    loadCharacters(1, false);
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [isOpen, activeTab, loadCharacters]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !uploading) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, saving, uploading, onClose]);

  // Clean up object URL for upload preview
  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) {
        URL.revokeObjectURL(uploadPreviewUrl);
      }
    };
  }, [uploadPreviewUrl]);

  if (!isOpen) return null;

  const handleConfirmCharacter = async () => {
    if (!pendingSelection || saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await onConfirmAvatar({
        photoURL: pendingSelection.imageUrl,
        avatarCharacterId: pendingSelection.id,
        avatarCharacterName: pendingSelection.name,
        avatarAnimeName: pendingSelection.animeTitle,
      });
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to save selected avatar.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleFilePick = (file: File | null) => {
    setUploadError(null);
    if (uploadPreviewUrl) {
      URL.revokeObjectURL(uploadPreviewUrl);
      setUploadPreviewUrl(null);
    }
    if (!file) {
      setUploadFile(null);
      return;
    }

    const allowed = ['image/png', 'image/webp', 'image/jpeg'];
    if (!allowed.includes(file.type)) {
      setUploadError('Please select a PNG, WebP, or JPEG image.');
      setUploadFile(null);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('Image exceeds the 2 MB maximum upload limit.');
      setUploadFile(null);
      return;
    }

    setUploadFile(file);
    setUploadPreviewUrl(URL.createObjectURL(file));
  };

  const handleConfirmUpload = async () => {
    if (!uploadFile || uploading) return;
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setUploadError('Please sign in again before uploading an avatar.');
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const token = await currentUser.getIdToken();
      const formData = new FormData();
      formData.append('file', uploadFile);

      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.url) {
        throw new Error(data?.error || 'Avatar upload failed.');
      }

      await onConfirmAvatar({
        photoURL: data.url,
        avatarCharacterId: null,
        avatarCharacterName: null,
        avatarAnimeName: 'Custom Upload',
      });
      onClose();
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Unable to upload avatar.'
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-gallery-title"
      onClick={() => {
        if (!saving && !uploading) onClose();
      }}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-[#0A0A0A] border border-[#292929] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[#292929] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white text-black flex items-center justify-center shrink-0">
              <Sparkles size={18} />
            </div>
            <div className="min-w-0">
              <h2
                id="avatar-gallery-title"
                className="text-base sm:text-lg font-bold text-white truncate"
              >
                Choose Profile Avatar
              </h2>
              <p className="text-xs text-[#707070] truncate">
                Select a character portrait from AniList or upload your own image
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving || uploading}
            className="p-2 rounded-xl bg-[#141414] border border-[#292929] text-[#A0A0A0] hover:text-white hover:border-white/40 transition-colors cursor-pointer disabled:opacity-50"
            aria-label="Close avatar gallery"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="px-5 pt-3 border-b border-[#292929] flex items-center gap-2 bg-[#070707] shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('gallery')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'gallery'
                ? 'border-white text-white'
                : 'border-transparent text-[#707070] hover:text-white'
            }`}
          >
            <ImageIcon size={14} />
            <span>Anime Character Gallery</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'upload'
                ? 'border-white text-white'
                : 'border-transparent text-[#707070] hover:text-white'
            }`}
          >
            <Upload size={14} />
            <span>Custom Upload</span>
          </button>
        </div>

        {activeTab === 'gallery' ? (
          <>
            {/* Search & Popular Series Filter Bar */}
            <div className="p-4 sm:px-5 border-b border-[#292929] space-y-3 shrink-0 bg-[#0A0A0A]">
              <div className="relative">
                <Search
                  size={15}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#707070]"
                />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search character name or anime title (e.g. Gojo, Naruto, Luffy, Frieren)..."
                  className="w-full h-10 pl-10 pr-9 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs sm:text-sm text-white placeholder-[#707070] focus:outline-none transition-colors"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => setSearchInput('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#707070] hover:text-white cursor-pointer"
                    aria-label="Clear character search"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                {POPULAR_ANIME_AVATAR_SERIES.map((series) => {
                  const active = selectedSeries === series;
                  return (
                    <button
                      key={series}
                      type="button"
                      onClick={() => setSelectedSeries(series)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors border cursor-pointer shrink-0 ${
                        active
                          ? 'bg-white text-black border-white font-semibold'
                          : 'bg-[#141414] text-[#A0A0A0] border-[#292929] hover:text-white hover:border-[#404040]'
                      }`}
                    >
                      {series}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Character Grid */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
              {errorMsg && (
                <div className="p-3.5 rounded-xl bg-[#141414] border border-white/30 text-xs text-white flex items-center gap-2">
                  <AlertCircle size={15} className="shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div
                      key={i}
                      className="rounded-xl bg-[#141414] border border-[#292929] overflow-hidden animate-pulse"
                    >
                      <div className="aspect-[3/4] bg-[#1F1F1F]" />
                      <div className="p-2.5 space-y-1.5">
                        <div className="h-3 w-3/4 bg-[#1F1F1F] rounded" />
                        <div className="h-2.5 w-1/2 bg-[#1F1F1F] rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : characters.length === 0 ? (
                <div className="py-14 text-center space-y-2">
                  <User size={28} className="mx-auto text-[#707070]" />
                  <p className="text-sm font-semibold text-white">
                    No characters matched your search
                  </p>
                  <p className="text-xs text-[#707070]">
                    Try another character name, anime title, or switch back to All Popular.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {characters.map((char) => {
                      const isSelected = pendingSelection?.id === char.id;
                      const isCurrent = currentPhotoURL === char.imageUrl;

                      return (
                        <button
                          key={char.id}
                          type="button"
                          onClick={() => setPendingSelection(char)}
                          className={`group text-left rounded-xl overflow-hidden border transition-all cursor-pointer flex flex-col bg-[#141414] ${
                            isSelected
                              ? 'border-white ring-2 ring-white shadow-xl scale-[1.01]'
                              : 'border-[#292929] hover:border-white/50'
                          }`}
                        >
                          <div className="relative aspect-[3/4] w-full bg-[#070707] overflow-hidden">
                            <ResilientImage
                              src={char.imageUrl}
                              alt={`${char.name} from ${char.animeTitle}`}
                              fill
                              sizes="(max-width: 640px) 45vw, 150px"
                              className="object-cover object-top group-hover:scale-105 transition-transform duration-300"
                              fallback={
                                <div className="w-full h-full flex items-center justify-center text-[#707070]">
                                  <User size={24} />
                                </div>
                              }
                            />

                            {isSelected && (
                              <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                                <Check size={14} />
                              </div>
                            )}

                            {!isSelected && isCurrent && (
                              <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/80 border border-white/30 text-[9px] font-mono uppercase text-white">
                                Current
                              </span>
                            )}
                          </div>

                          <div className="p-2.5 space-y-0.5 flex-1 flex flex-col justify-between">
                            <div>
                              <div className="text-xs font-semibold text-white truncate">
                                {char.name}
                              </div>
                              <div className="text-[10px] text-[#888888] truncate">
                                {char.animeTitle}
                              </div>
                            </div>
                            {char.favourites > 0 && (
                              <div className="pt-1 flex items-center gap-1 text-[10px] font-mono text-[#707070]">
                                <Heart size={10} />
                                <span>{char.favourites.toLocaleString()}</span>
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {hasNextPage && (
                    <div className="flex justify-center pt-2">
                      <button
                        type="button"
                        onClick={() => loadCharacters(page + 1, true)}
                        disabled={loadingMore}
                        className="px-5 py-2.5 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-xs font-semibold text-white transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        {loadingMore ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            <span>Loading More Characters...</span>
                          </>
                        ) : (
                          <span>Load More Characters</span>
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Sticky Preview & Explicit Confirmation Footer */}
            <div className="px-5 py-3.5 border-t border-[#292929] bg-[#070707] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              {pendingSelection ? (
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative w-11 h-11 rounded-xl overflow-hidden border border-white/40 shrink-0 bg-[#141414]">
                    <ResilientImage
                      src={pendingSelection.imageUrl}
                      alt={pendingSelection.name}
                      fill
                      sizes="44px"
                      className="object-cover object-top"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">
                      Preview: {pendingSelection.name}
                    </div>
                    <div className="text-[11px] text-[#A0A0A0] truncate">
                      {pendingSelection.animeTitle} · Click Confirm Avatar to apply
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[#707070]">
                  Select any anime character above to preview before updating your profile picture.
                </div>
              )}

              <div className="flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="px-4 py-2 rounded-xl border border-[#292929] text-xs font-medium text-[#A0A0A0] hover:text-white hover:border-white/40 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCharacter}
                  disabled={!pendingSelection || saving}
                  className="px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Updating...</span>
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      <span>Confirm Avatar</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Custom Image Upload Tab */
          <div className="p-6 space-y-5 flex-1 overflow-y-auto">
            {uploadConfigured === false ? (
              <div className="p-6 rounded-2xl bg-[#141414] border border-[#292929] text-center space-y-3">
                <Upload size={26} className="mx-auto text-[#A0A0A0]" />
                <div className="text-sm font-bold text-white">
                  Custom Image Storage Unavailable
                </div>
                <p className="text-xs text-[#A0A0A0] max-w-md mx-auto leading-relaxed">
                  Custom file uploads require server-side Supabase Storage configuration. You can select any high-resolution character portrait directly from the Anime Character Gallery tab.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('gallery')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors cursor-pointer"
                >
                  <Sparkles size={14} />
                  <span>Browse Anime Character Gallery</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <label className="block p-8 rounded-2xl border border-dashed border-[#404040] hover:border-white bg-[#141414] text-center cursor-pointer transition-colors">
                  <input
                    type="file"
                    accept="image/png,image/webp,image/jpeg"
                    className="hidden"
                    onChange={(e) => handleFilePick(e.target.files?.[0] || null)}
                  />
                  <Upload size={26} className="mx-auto text-white mb-2" />
                  <div className="text-sm font-semibold text-white">
                    {uploadFile ? uploadFile.name : 'Choose a PNG, WebP, or JPEG image'}
                  </div>
                  <div className="text-xs text-[#707070] mt-1">
                    Maximum file size: 2 MB. Square portraits look best.
                  </div>
                </label>

                {uploadError && (
                  <div className="p-3 rounded-xl bg-[#141414] border border-white/30 text-xs text-white flex items-center gap-2">
                    <AlertCircle size={15} />
                    <span>{uploadError}</span>
                  </div>
                )}

                {uploadPreviewUrl && (
                  <div className="p-4 rounded-2xl bg-[#141414] border border-[#292929] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="relative w-16 h-16 rounded-2xl overflow-hidden border border-white/30 bg-black shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={uploadPreviewUrl}
                          alt="Custom avatar preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">
                          Ready to Confirm Upload
                        </div>
                        <div className="text-[11px] text-[#A0A0A0]">
                          {uploadFile ? `${Math.round(uploadFile.size / 1024)} KB` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleFilePick(null)}
                        disabled={uploading}
                        className="px-3.5 py-2 rounded-xl border border-[#292929] text-xs text-[#A0A0A0] hover:text-white cursor-pointer"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmUpload}
                        disabled={uploading}
                        className="px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {uploading ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            <span>Uploading...</span>
                          </>
                        ) : (
                          <>
                            <Check size={14} />
                            <span>Confirm Upload</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
