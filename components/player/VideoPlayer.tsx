'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings as SettingsIcon,
  SkipForward,
  SkipBack,
  Subtitles,
  Layers,
  Loader2,
  Check,
  AlertCircle,
  ExternalLink,
  Sliders,
  RefreshCw,
} from 'lucide-react';
import {
  AniScrollStreamResponse,
  AniSkipResult,
  HlsManifestQualityLevel,
  SubtitlePreference,
  SubtitlePreferences,
  ParsedSubtitleCue,
  ZokoAnimeQuality,
} from '@/types/streaming';
import {
  saveWatchProgress,
  getSavedProgress,
  getSavedHistoryEntry,
  getUserPreferences,
  getSubtitlePreferences,
  saveSubtitlePreferences,
  resetSubtitlePreferences,
  DEFAULT_SUBTITLE_PREFERENCES,
} from '@/lib/storage';
import { parseSubtitles } from '@/lib/subtitle-parser';
import {
  normalizeAndSortQualities,
  normalizeHlsMasterLevels,
  normalizeSubtitleTracks,
  selectInitialHlsLevelIndex,
  selectInitialQuality,
  selectNextFallbackQuality,
  resolveSubtitleTrackForPreference,
} from '@/lib/zokoanime-stream';
import { SubtitleOverlay } from './SubtitleOverlay';
import { SubtitleSettingsModal } from './SubtitleSettingsModal';

const SUBTITLE_PREF_STORAGE_KEY = 'aniscroll_active_subtitle_pref_v1';

function getStoredSubtitlePreference(): SubtitlePreference | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SUBTITLE_PREF_STORAGE_KEY);
    if (!raw) return null;
    return raw;
  } catch {
    return null;
  }
}

function setStoredSubtitlePreference(pref: SubtitlePreference | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (pref === null) {
      window.sessionStorage.removeItem(SUBTITLE_PREF_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(SUBTITLE_PREF_STORAGE_KEY, pref);
    }
  } catch {
    // Ignore storage quota errors
  }
}

interface VideoPlayerProps {
  animeId: number;
  anilistId?: number | null;
  animeTitle: string;
  coverImage?: string;
  bannerImage?: string;
  episodeNumber: number;
  episodeTitle?: string;
  episodeThumbnail?: string;
  episodeDurationSeconds?: number;
  initialResumeTime?: number;
  totalEpisodes?: number;
  malId?: number | null;
  streamData?: AniScrollStreamResponse | null;
  isLoadingStream?: boolean;
  streamError?: string | null;
  activeType: 'sub' | 'dub';
  onChangeType: (type: 'sub' | 'dub') => void;
  onNavigateEpisode: (episode: number) => void;
  onRetryStream?: () => void;
  hasSub?: boolean;
  hasDub?: boolean;
  isLoadingAvailability?: boolean;
}

export function VideoPlayer({
  animeId,
  anilistId,
  animeTitle,
  coverImage,
  bannerImage,
  episodeNumber,
  episodeTitle,
  episodeThumbnail,
  episodeDurationSeconds = 1440,
  initialResumeTime = 0,
  totalEpisodes = 1,
  malId,
  streamData,
  isLoadingStream = false,
  streamError = null,
  activeType,
  onChangeType,
  onNavigateEpisode,
  onRetryStream,
  hasSub = false,
  hasDub = false,
  isLoadingAvailability = false,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideControlsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastProgressSaveRef = useRef<number>(0);
  const hasRestoredPositionRef = useRef<boolean>(false);

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState<number>(() => {
    if (initialResumeTime > 0) return initialResumeTime;
    return getSavedProgress(animeId, episodeNumber);
  });
  const [duration, setDuration] = useState<number>(() => {
    const saved = getSavedHistoryEntry(animeId, episodeNumber);
    if (saved?.duration && saved.duration > 0) return saved.duration;
    return episodeDurationSeconds || 1440;
  });
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Menus
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [showSubtitleSettings, setShowSubtitleSettings] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  // Quality state:
  // - ZokoAnime movies provide discrete `qualities[]` URLs
  // - MegaPlay series provide a single master HLS URL whose variants are parsed via HLS.js `hls.levels`
  const availableQualities = useMemo<ZokoAnimeQuality[]>(
    () => normalizeAndSortQualities(streamData?.qualities),
    [streamData?.qualities]
  );
  const isMasterPlaylistMode =
    availableQualities.length === 0 && Boolean(streamData?.hlsProxyUrl);
  const providerDisplayName =
    streamData?.provider === 'megaplay' || streamData?.source === 'megaplay'
      ? 'MegaPlay'
      : 'ZokoAnime';

  const [hlsMasterLevels, setHlsMasterLevels] = useState<HlsManifestQualityLevel[]>([]);
  const [selectedHlsLevel, setSelectedHlsLevel] = useState<number>(-1);
  const [activeHlsAutoHeight, setActiveHlsAutoHeight] = useState<number | null>(null);
  const [selectedQualityLabel, setSelectedQualityLabel] = useState<string>('');
  const [activeHlsUrl, setActiveHlsUrl] = useState<string | null>(null);
  const [isSwitchingQuality, setIsSwitchingQuality] = useState<boolean>(false);
  const [localPlaybackError, setLocalPlaybackError] = useState<string | null>(null);

  const failedQualityUrlsRef = useRef<Set<string>>(new Set());
  const hasTriedMasterFallbackRef = useRef<boolean>(false);
  const qualitySwitchStateRef = useRef<{
    isSwitching: boolean;
    targetTime: number;
    wasPlaying: boolean;
  } | null>(null);
  const isMasterPlaylistModeRef = useRef<boolean>(isMasterPlaylistMode);
  const selectedHlsLevelRef = useRef<number>(selectedHlsLevel);
  const hlsMasterLevelsRef = useRef<HlsManifestQualityLevel[]>(hlsMasterLevels);
  const providerDisplayNameRef = useRef<string>(providerDisplayName);

  useEffect(() => {
    isMasterPlaylistModeRef.current = isMasterPlaylistMode;
  }, [isMasterPlaylistMode]);

  useEffect(() => {
    selectedHlsLevelRef.current = selectedHlsLevel;
  }, [selectedHlsLevel]);

  useEffect(() => {
    hlsMasterLevelsRef.current = hlsMasterLevels;
  }, [hlsMasterLevels]);

  useEffect(() => {
    providerDisplayNameRef.current = providerDisplayName;
  }, [providerDisplayName]);

  // Explicit SubtitlePreference state:
  // - null: uninitialized (use API default track)
  // - 'off': user explicitly turned subtitles Off (never auto-enable across quality or episode changes)
  // - string: active subtitle track URL or label
  const [subtitlePreference, setSubtitlePreference] = useState<SubtitlePreference | null>(() =>
    getStoredSubtitlePreference()
  );
  const [activeSubtitleUrl, setActiveSubtitleUrl] = useState<SubtitlePreference>('off');
  const subtitlePreferenceRef = useRef<SubtitlePreference | null>(subtitlePreference);
  const subtitleRequestIdRef = useRef<number>(0);

  useEffect(() => {
    subtitlePreferenceRef.current = subtitlePreference;
  }, [subtitlePreference]);

  // Normalized subtitle tracks from API
  const subtitleTracks = useMemo(
    () => normalizeSubtitleTracks(streamData?.subtitles),
    [streamData?.subtitles]
  );

  // Subtitle Customization & Parsed Cues
  const [subtitlePrefs, setSubtitlePrefs] = useState<SubtitlePreferences>(
    DEFAULT_SUBTITLE_PREFERENCES
  );
  const [parsedCues, setParsedCues] = useState<ParsedSubtitleCue[]>([]);
  const [isLoadingSubtitles, setIsLoadingSubtitles] = useState(false);

  // AniSkip states (Preserved 100% independent of ZokoAnime skip object)
  const [skipIntervals, setSkipIntervals] = useState<AniSkipResult[]>([]);
  const [currentSkip, setCurrentSkip] = useState<AniSkipResult | null>(null);
  const [autoSkipIntro, setAutoSkipIntro] = useState(false);
  const [autoSkipOutro, setAutoSkipOutro] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(true);

  // Resume toast
  const [resumePrompt, setResumePrompt] = useState<{ time: number } | null>(null);

  const effectiveMalId = malId ?? streamData?.malId ?? null;
  const effectiveAnilistId = anilistId ?? streamData?.anilistId ?? null;

  // Refs to guarantee up-to-date values inside rapid timeupdate/seeked callbacks without stale closures
  const skipIntervalsRef = useRef<AniSkipResult[]>([]);
  const currentSkipRef = useRef<AniSkipResult | null>(null);
  const autoSkipIntroRef = useRef(autoSkipIntro);
  const autoSkipOutroRef = useRef(autoSkipOutro);
  const skipFetchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    skipIntervalsRef.current = skipIntervals;
  }, [skipIntervals]);

  useEffect(() => {
    currentSkipRef.current = currentSkip;
  }, [currentSkip]);

  useEffect(() => {
    autoSkipIntroRef.current = autoSkipIntro;
  }, [autoSkipIntro]);

  useEffect(() => {
    autoSkipOutroRef.current = autoSkipOutro;
  }, [autoSkipOutro]);

  // Keep latest metadata ref so playback callbacks always save fresh episode/anime metadata
  const metadataRef = useRef({
    animeId,
    anilistId: anilistId ?? streamData?.anilistId ?? null,
    malId: effectiveMalId,
    animeTitle,
    coverImage,
    bannerImage,
    episodeNumber,
    episodeTitle,
    episodeThumbnail,
    episodeDurationSeconds,
    activeType,
  });

  useEffect(() => {
    metadataRef.current = {
      animeId,
      anilistId: anilistId ?? streamData?.anilistId ?? null,
      malId: effectiveMalId,
      animeTitle,
      coverImage,
      bannerImage,
      episodeNumber,
      episodeTitle,
      episodeThumbnail,
      episodeDurationSeconds,
      activeType,
    };
  }, [
    animeId,
    anilistId,
    effectiveMalId,
    streamData?.anilistId,
    animeTitle,
    coverImage,
    bannerImage,
    episodeNumber,
    episodeTitle,
    episodeThumbnail,
    episodeDurationSeconds,
    activeType,
  ]);

  // Helper to completely disable all native HTML5 textTracks & HLS.js internal subtitle rendering
  const disableAllNativeAndHlsSubtitles = useCallback(() => {
    const hls = hlsRef.current;
    if (hls) {
      try {
        hls.subtitleDisplay = false;
        hls.subtitleTrack = -1;
      } catch {
        // Ignore if HLS instance is detaching
      }
    }

    const video = videoRef.current;
    if (video) {
      const trackNodes = video.querySelectorAll('track');
      trackNodes.forEach((node) => node.remove());

      if (video.textTracks) {
        for (let i = 0; i < video.textTracks.length; i++) {
          try {
            video.textTracks[i].mode = 'disabled';
          } catch {
            // Ignore read-only track mode errors
          }
        }
      }
    }
  }, []);

  const persistProgress = useCallback(
    (timeSec: number, durationSec?: number) => {
      const meta = metadataRef.current;
      const videoDur =
        videoRef.current &&
        Number.isFinite(videoRef.current.duration) &&
        videoRef.current.duration > 0
          ? videoRef.current.duration
          : 0;
      const effectiveDuration =
        durationSec && durationSec > 0
          ? durationSec
          : videoDur > 0
          ? videoDur
          : duration > 0
          ? duration
          : meta.episodeDurationSeconds || 1440;

      if (effectiveDuration <= 0 || timeSec < 0) return;

      const progressPct = Math.min(
        100,
        Math.max(0, Math.round((timeSec / effectiveDuration) * 100))
      );

      saveWatchProgress({
        hoshikaId: meta.animeId,
        anilistId: meta.anilistId,
        malId: meta.malId,
        title: meta.animeTitle,
        animeTitle: meta.animeTitle,
        coverImage: meta.coverImage,
        animeCover: meta.coverImage,
        bannerImage: meta.bannerImage,
        episodeNumber: meta.episodeNumber,
        episodeTitle: meta.episodeTitle,
        episodeThumbnail: meta.episodeThumbnail,
        currentTime: timeSec,
        duration: effectiveDuration,
        progress: progressPct,
        audioType: meta.activeType,
        completed: timeSec / effectiveDuration >= 0.99,
      });
    },
    [duration]
  );

  // Sync initialResumeTime when episode or URL resume param updates
  useEffect(() => {
    hasRestoredPositionRef.current = false;
    qualitySwitchStateRef.current = null;
    setLocalPlaybackError(null);
    setSkipIntervals([]);
    setCurrentSkip(null);

    const saved = getSavedHistoryEntry(animeId, episodeNumber);
    const targetTime =
      initialResumeTime > 0
        ? initialResumeTime
        : saved && saved.currentTime > 0 && !saved.completed
        ? saved.currentTime
        : 0;

    if (targetTime > 0) {
      setCurrentTime(targetTime);
      if (videoRef.current && videoRef.current.readyState >= 1) {
        videoRef.current.currentTime = targetTime;
        hasRestoredPositionRef.current = true;
      }
    } else {
      setCurrentTime(0);
    }

    if (saved?.duration && saved.duration > 0) {
      setDuration(saved.duration);
    } else {
      setDuration(episodeDurationSeconds || 1440);
    }
  }, [animeId, episodeNumber, initialResumeTime, episodeDurationSeconds]);

  // Load preferences
  useEffect(() => {
    const prefs = getUserPreferences();
    setAutoSkipIntro(prefs.autoSkipIntro);
    setAutoSkipOutro(prefs.autoSkipOutro);
    setAutoPlayNext(prefs.autoPlayNext);
    setSubtitlePrefs(getSubtitlePreferences());
  }, []);

  // Sync subtitle preferences across window events
  useEffect(() => {
    const handleSubPrefChange = (e: any) => {
      if (e.detail) {
        setSubtitlePrefs(e.detail);
      }
    };
    window.addEventListener('aniscroll_subtitles_updated', handleSubPrefChange);
    return () => window.removeEventListener('aniscroll_subtitles_updated', handleSubPrefChange);
  }, []);

  // Fetch AniSkip timestamps independently of streaming provider, quality, or sub/dub
  useEffect(() => {
    // 1. Instantly clear old timestamps on episode navigation or anime transition
    setSkipIntervals([]);
    setCurrentSkip(null);
    skipIntervalsRef.current = [];
    currentSkipRef.current = null;

    if (skipFetchAbortRef.current) {
      skipFetchAbortRef.current.abort();
      skipFetchAbortRef.current = null;
    }

    if (!effectiveMalId && !effectiveAnilistId) return;

    const controller = new AbortController();
    skipFetchAbortRef.current = controller;

    async function fetchSkips() {
      try {
        const queryParams = new URLSearchParams({
          episode: String(episodeNumber),
        });
        if (effectiveMalId) queryParams.set('malId', String(effectiveMalId));
        if (effectiveAnilistId) queryParams.set('anilistId', String(effectiveAnilistId));

        // Use estimated or known episode duration in seconds; AniSkip requires integer seconds or 0
        const estDuration = Math.round(episodeDurationSeconds || 1440);
        queryParams.set('duration', String(estDuration));

        const res = await fetch(`/api/skips?${queryParams.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (controller.signal.aborted) return;

        if (data.found && Array.isArray(data.results)) {
          // Validate intervals
          const validIntervals = data.results.filter(
            (r: any) =>
              r &&
              r.interval &&
              typeof r.interval.startTime === 'number' &&
              typeof r.interval.endTime === 'number' &&
              r.interval.endTime > r.interval.startTime
          );

          setSkipIntervals(validIntervals);
          skipIntervalsRef.current = validIntervals;

          // Check if current video position is already inside an active interval
          const video = videoRef.current;
          if (video) {
            const now = video.currentTime;
            const active = validIntervals.find(
              (s: AniSkipResult) =>
                now >= s.interval.startTime && now <= s.interval.endTime
            );
            if (active) {
              if (
                (active.skipType.includes('op') && autoSkipIntroRef.current) ||
                (active.skipType.includes('ed') && autoSkipOutroRef.current)
              ) {
                video.currentTime = active.interval.endTime;
                setCurrentSkip(null);
                currentSkipRef.current = null;
              } else {
                setCurrentSkip(active);
                currentSkipRef.current = active;
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('[AniSkip] Failed to load skips:', err);
        }
      }
    }

    fetchSkips();

    return () => {
      controller.abort();
    };
  }, [effectiveMalId, effectiveAnilistId, episodeNumber, episodeDurationSeconds]);

  // Fetch and parse WebVTT / SRT subtitle content
  const loadSubtitleContent = useCallback(
    async (subUrl: SubtitlePreference) => {
      const requestId = ++subtitleRequestIdRef.current;

      if (!subUrl || subUrl === 'off') {
        setParsedCues([]);
        setIsLoadingSubtitles(false);
        disableAllNativeAndHlsSubtitles();
        return;
      }

      setIsLoadingSubtitles(true);
      disableAllNativeAndHlsSubtitles();

      try {
        let text = '';
        try {
          const directRes = await fetch(subUrl);
          if (directRes.ok) {
            text = await directRes.text();
          }
        } catch {
          // Fallback to internal subtitle proxy if direct URL fails CORS
        }

        if (!text || !text.includes('-->')) {
          const fallbackTrack = subtitleTracks.find((t) => t.url === subUrl);
          const targetForProxy = fallbackTrack?.src || subUrl;
          const proxyRes = await fetch(
            `/api/subtitles?url=${encodeURIComponent(targetForProxy)}`
          );
          if (proxyRes.ok) {
            text = await proxyRes.text();
          }
        }

        // Ignore stale response if user switched subtitles or turned subtitles Off while loading
        if (
          requestId !== subtitleRequestIdRef.current ||
          subtitlePreferenceRef.current === 'off'
        ) {
          setParsedCues([]);
          return;
        }

        if (text && text.includes('-->')) {
          const cues = parseSubtitles(text);
          setParsedCues(cues);
        } else {
          setParsedCues([]);
        }
      } catch (err) {
        console.error('Failed to parse subtitle:', err);
        if (requestId === subtitleRequestIdRef.current) {
          setParsedCues([]);
        }
      } finally {
        if (requestId === subtitleRequestIdRef.current) {
          setIsLoadingSubtitles(false);
        }
      }
    },
    [disableAllNativeAndHlsSubtitles, subtitleTracks]
  );

  // Explicit user subtitle selection handler
  const handleSelectSubtitle = useCallback(
    (selection: SubtitlePreference) => {
      setShowSubtitleMenu(false);

      if (selection === 'off') {
        subtitlePreferenceRef.current = 'off';
        setSubtitlePreference('off');
        setStoredSubtitlePreference('off');
        setActiveSubtitleUrl('off');
        subtitleRequestIdRef.current++;
        setParsedCues([]);
        setIsLoadingSubtitles(false);
        disableAllNativeAndHlsSubtitles();
        return;
      }

      const matchedTrack = subtitleTracks.find((t) => t.url === selection);
      const prefToStore = matchedTrack?.label || matchedTrack?.lang || selection;

      subtitlePreferenceRef.current = prefToStore;
      setSubtitlePreference(prefToStore);
      setStoredSubtitlePreference(prefToStore);
      setActiveSubtitleUrl(selection);
      loadSubtitleContent(selection);
    },
    [subtitleTracks, disableAllNativeAndHlsSubtitles, loadSubtitleContent]
  );

  // Resolve active subtitle track whenever streamData/subtitleTracks change,
  // strictly respecting 'off' across quality switches and episode changes.
  useEffect(() => {
    if (!streamData) {
      setParsedCues([]);
      setActiveSubtitleUrl('off');
      disableAllNativeAndHlsSubtitles();
      return;
    }

    const currentPref = subtitlePreferenceRef.current;
    if (currentPref === 'off') {
      setActiveSubtitleUrl('off');
      setParsedCues([]);
      setIsLoadingSubtitles(false);
      disableAllNativeAndHlsSubtitles();
      return;
    }

    const resolvedUrl = resolveSubtitleTrackForPreference(subtitleTracks, currentPref);
    if (resolvedUrl === 'off') {
      setActiveSubtitleUrl('off');
      setParsedCues([]);
      setIsLoadingSubtitles(false);
      disableAllNativeAndHlsSubtitles();
    } else {
      setActiveSubtitleUrl(resolvedUrl);
      loadSubtitleContent(resolvedUrl);
    }
  }, [streamData, subtitleTracks, disableAllNativeAndHlsSubtitles, loadSubtitleContent]);

  // Initialize quality selection when streamData changes
  useEffect(() => {
    failedQualityUrlsRef.current.clear();
    hasTriedMasterFallbackRef.current = false;
    setLocalPlaybackError(null);
    setIsSwitchingQuality(false);
    setHlsMasterLevels([]);
    setSelectedHlsLevel(-1);
    setActiveHlsAutoHeight(null);

    if (!streamData) {
      setSelectedQualityLabel('');
      setActiveHlsUrl(null);
      return;
    }

    if (streamData.iframeOnly || streamData.playbackMode === 'embed') {
      setSelectedQualityLabel('Embed');
      setActiveHlsUrl(null);
      return;
    }

    const initialQuality = selectInitialQuality(availableQualities);
    if (initialQuality) {
      setSelectedQualityLabel(initialQuality.quality);
      setActiveHlsUrl(initialQuality.hlsProxyUrl);
    } else if (streamData.hlsProxyUrl) {
      // Master HLS playlist mode (e.g., MegaPlay): load single master URL and parse hls.levels
      setSelectedQualityLabel('Auto');
      setActiveHlsUrl(streamData.hlsProxyUrl);
      hasTriedMasterFallbackRef.current = true;
    } else {
      setSelectedQualityLabel('');
      setActiveHlsUrl(null);
      setLocalPlaybackError('No playable HLS quality stream was returned for this episode.');
    }
  }, [streamData, availableQualities]);

  // Manual quality switch handler for discrete quality URLs (ZokoAnime movies)
  const handleSelectQuality = useCallback(
    (qualityItem: ZokoAnimeQuality) => {
      setShowQualityMenu(false);
      setShowSettingsMenu(false);

      if (qualityItem.hlsProxyUrl === activeHlsUrl && !localPlaybackError) {
        return;
      }

      const video = videoRef.current;
      const savedTime =
        video && video.currentTime > 0 ? video.currentTime : currentTime;
      const wasPlaying = video ? !video.paused : isPlaying;

      qualitySwitchStateRef.current = {
        isSwitching: true,
        targetTime: savedTime,
        wasPlaying,
      };

      setLocalPlaybackError(null);
      setIsSwitchingQuality(true);
      setSelectedQualityLabel(qualityItem.quality);
      setActiveHlsUrl(qualityItem.hlsProxyUrl);
    },
    [activeHlsUrl, currentTime, isPlaying, localPlaybackError]
  );

  // Manual quality switch handler for HLS.js master playlist levels (MegaPlay series)
  // Uses `hls.currentLevel` without reloading the stream or re-calling the MegaPlay API.
  const handleSelectHlsLevel = useCallback(
    (levelIndex: number) => {
      setShowQualityMenu(false);
      setShowSettingsMenu(false);

      const hls = hlsRef.current;
      if (!hls) return;

      setLocalPlaybackError(null);
      selectedHlsLevelRef.current = levelIndex;
      setSelectedHlsLevel(levelIndex);

      if (levelIndex === -1) {
        setSelectedQualityLabel('Auto');
      } else {
        const matched = hlsMasterLevels.find((l) => l.levelIndex === levelIndex);
        setSelectedQualityLabel(matched ? matched.label : 'Auto');
      }

      try {
        hls.currentLevel = levelIndex;
      } catch {
        // Fallback to Auto ABR if level switch fails
        selectedHlsLevelRef.current = -1;
        setSelectedHlsLevel(-1);
        setSelectedQualityLabel('Auto');
        hls.currentLevel = -1;
      }
    },
    [hlsMasterLevels]
  );

  const masterHlsProxyUrl = streamData?.hlsProxyUrl;

  // Automatic fallback to next lower quality when the active quality stream fails
  const attemptNextQualityFallback = useCallback(
    (failedUrl: string) => {
      failedQualityUrlsRef.current.add(failedUrl);

      const video = videoRef.current;
      const savedTime =
        qualitySwitchStateRef.current?.targetTime ??
        (video && video.currentTime > 0 ? video.currentTime : 0);
      const wasPlaying =
        qualitySwitchStateRef.current?.wasPlaying ??
        (video ? !video.paused : false);

      const nextQuality = selectNextFallbackQuality(
        availableQualities,
        failedUrl,
        failedQualityUrlsRef.current
      );

      if (nextQuality) {
        qualitySwitchStateRef.current = {
          isSwitching: true,
          targetTime: savedTime,
          wasPlaying,
        };
        setIsSwitchingQuality(true);
        setSelectedQualityLabel(nextQuality.quality);
        setActiveHlsUrl(nextQuality.hlsProxyUrl);
        return true;
      }

      // If all individual quality URLs failed, try top-level master hlsProxyUrl once as final fallback
      if (
        masterHlsProxyUrl &&
        !hasTriedMasterFallbackRef.current &&
        !failedQualityUrlsRef.current.has(masterHlsProxyUrl)
      ) {
        hasTriedMasterFallbackRef.current = true;
        qualitySwitchStateRef.current = {
          isSwitching: true,
          targetTime: savedTime,
          wasPlaying,
        };
        setIsSwitchingQuality(true);
        setSelectedQualityLabel('Auto');
        setActiveHlsUrl(masterHlsProxyUrl);
        return true;
      }

      setIsSwitchingQuality(false);
      qualitySwitchStateRef.current = null;
      setLocalPlaybackError(
        'All available video quality streams failed to load for this episode. Please retry or switch audio version.'
      );
      return false;
    },
    [availableQualities, masterHlsProxyUrl]
  );

  // Restore saved or quality-switch playback position onto the video element
  const restorePlaybackPositionOnVideo = useCallback(
    (video: HTMLVideoElement) => {
      // 1. If recovering from a manual or fallback quality switch, restore exact position & play/pause state
      if (qualitySwitchStateRef.current?.isSwitching) {
        const { targetTime, wasPlaying } = qualitySwitchStateRef.current;
        try {
          if (targetTime > 0) {
            const maxSeek =
              Number.isFinite(video.duration) && video.duration > 2
                ? Math.min(targetTime, video.duration - 0.5)
                : targetTime;
            video.currentTime = maxSeek;
            setCurrentTime(maxSeek);
          }
          qualitySwitchStateRef.current = null;
          setIsSwitchingQuality(false);
          hasRestoredPositionRef.current = true;

          if (wasPlaying) {
            video.play().catch(() => {});
            setIsPlaying(true);
          } else {
            video.pause();
            setIsPlaying(false);
          }
          return;
        } catch {
          // Wait for loadedmetadata if seek before readyState
          return;
        }
      }

      // 2. Normal initial episode load position restore
      if (hasRestoredPositionRef.current) return;
      const savedTime =
        initialResumeTime > 0
          ? initialResumeTime
          : getSavedProgress(animeId, episodeNumber);
      if (savedTime > 0) {
        const maxSeek =
          Number.isFinite(video.duration) && video.duration > 2
            ? Math.min(savedTime, video.duration - 2)
            : savedTime;
        try {
          video.currentTime = maxSeek;
          setCurrentTime(maxSeek);
          hasRestoredPositionRef.current = true;
        } catch {
          // Will retry on loadedmetadata
        }
      } else {
        hasRestoredPositionRef.current = true;
      }
    },
    [animeId, episodeNumber, initialResumeTime]
  );

  // Keep callback refs stable across renders so the HLS stream effect never re-mounts on state changes
  const attemptNextQualityFallbackRef = useRef(attemptNextQualityFallback);
  useEffect(() => {
    attemptNextQualityFallbackRef.current = attemptNextQualityFallback;
  });

  const restorePlaybackPositionOnVideoRef = useRef(restorePlaybackPositionOnVideo);
  useEffect(() => {
    restorePlaybackPositionOnVideoRef.current = restorePlaybackPositionOnVideo;
  });

  const disableAllNativeAndHlsSubtitlesRef = useRef(disableAllNativeAndHlsSubtitles);
  useEffect(() => {
    disableAllNativeAndHlsSubtitlesRef.current = disableAllNativeAndHlsSubtitles;
  });

  // Dedicated playbackSpeed effect so speed adjustments do not reload HLS
  useEffect(() => {
    const video = videoRef.current;
    if (video && playbackSpeed > 0 && video.playbackRate !== playbackSpeed) {
      video.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Load HLS Stream for `activeHlsUrl` (only re-runs when the active stream URL changes)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeHlsUrl) {
      if (hlsRef.current) {
        try {
          hlsRef.current.stopLoad();
          hlsRef.current.detachMedia();
          hlsRef.current.destroy();
        } catch {
          // ignore
        }
        hlsRef.current = null;
      }
      return;
    }

    if (hlsRef.current) {
      try {
        hlsRef.current.stopLoad();
        hlsRef.current.detachMedia();
        hlsRef.current.destroy();
      } catch {
        // ignore
      }
      hlsRef.current = null;
    }

    let mediaRecoverAttempts = 0;
    let networkRecoverAttempts = 0;
    let levelFallbackToAutoAttempted = false;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        renderTextTracksNatively: false,
      });

      hlsRef.current = hls;
      // Ensure HLS internal subtitle rendering stays disabled; we render subtitles cleanly via SubtitleOverlay
      hls.subtitleDisplay = false;
      hls.subtitleTrack = -1;

      hls.loadSource(activeHlsUrl);
      hls.attachMedia(video);

      const handleManifestParsed = () => {
        hls.subtitleDisplay = false;
        hls.subtitleTrack = -1;
        disableAllNativeAndHlsSubtitlesRef.current();

        // When playing a master playlist directly (MegaPlay), detect actual resolutions from HLS.js levels
        if (isMasterPlaylistModeRef.current) {
          const parsedLevels = normalizeHlsMasterLevels(hls.levels);
          hlsMasterLevelsRef.current = parsedLevels;
          setHlsMasterLevels(parsedLevels);

          if (parsedLevels.length > 0) {
            const preferredIdx = selectInitialHlsLevelIndex(parsedLevels);
            if (preferredIdx >= 0) {
              hls.currentLevel = preferredIdx;
              const matched = parsedLevels.find((l) => l.levelIndex === preferredIdx);
              selectedHlsLevelRef.current = preferredIdx;
              setSelectedHlsLevel(preferredIdx);
              setSelectedQualityLabel(matched ? matched.label : 'Auto');
              setActiveHlsAutoHeight(matched?.height ?? null);
            } else {
              hls.currentLevel = -1;
              selectedHlsLevelRef.current = -1;
              setSelectedHlsLevel(-1);
              setSelectedQualityLabel('Auto');
            }
          } else {
            selectedHlsLevelRef.current = -1;
            setSelectedHlsLevel(-1);
            setSelectedQualityLabel('Auto');
          }
        }

        restorePlaybackPositionOnVideoRef.current(video);
      };

      const handleLevelSwitched = (_event: any, data: { level: number }) => {
        const levelObj = hls.levels?.[data.level];
        if (levelObj && typeof levelObj.height === 'number' && levelObj.height > 0) {
          setActiveHlsAutoHeight(Math.round(levelObj.height));
        }
        setIsSwitchingQuality(false);
      };

      const handleSubtitleTracksUpdated = () => {
        hls.subtitleDisplay = false;
        hls.subtitleTrack = -1;
        disableAllNativeAndHlsSubtitlesRef.current();
      };

      const handleHlsError = (_event: any, data: any) => {
        if (!data.fatal) return;

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoverAttempts < 1) {
          mediaRecoverAttempts += 1;
          hls.recoverMediaError();
          return;
        }

        // In master playlist mode (MegaPlay), gracefully recover a failed manual level by falling back to Auto ABR
        if (
          isMasterPlaylistModeRef.current &&
          data.type === Hls.ErrorTypes.NETWORK_ERROR
        ) {
          if (
            selectedHlsLevelRef.current >= 0 &&
            hlsMasterLevelsRef.current.length > 1 &&
            !levelFallbackToAutoAttempted
          ) {
            levelFallbackToAutoAttempted = true;
            selectedHlsLevelRef.current = -1;
            setSelectedHlsLevel(-1);
            setSelectedQualityLabel('Auto');
            hls.currentLevel = -1;
            hls.startLoad();
            return;
          }

          if (networkRecoverAttempts < 1) {
            networkRecoverAttempts += 1;
            hls.startLoad();
            return;
          }
        }

        try {
          hls.stopLoad();
          hls.detachMedia();
          hls.destroy();
        } catch {
          // ignore
        }
        if (hlsRef.current === hls) {
          hlsRef.current = null;
        }

        if (isMasterPlaylistModeRef.current) {
          setIsSwitchingQuality(false);
          qualitySwitchStateRef.current = null;
          setLocalPlaybackError(
            `Failed to load the ${providerDisplayNameRef.current} HLS stream. Please retry playback or switch audio version.`
          );
          return;
        }

        attemptNextQualityFallbackRef.current(activeHlsUrl);
      };

      hls.on(Hls.Events.MANIFEST_PARSED, handleManifestParsed);
      hls.on(Hls.Events.LEVEL_SWITCHED, handleLevelSwitched);
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, handleSubtitleTracksUpdated);
      hls.on(Hls.Events.ERROR, handleHlsError);

      return () => {
        hls.off(Hls.Events.MANIFEST_PARSED, handleManifestParsed);
        hls.off(Hls.Events.LEVEL_SWITCHED, handleLevelSwitched);
        hls.off(Hls.Events.SUBTITLE_TRACKS_UPDATED, handleSubtitleTracksUpdated);
        hls.off(Hls.Events.ERROR, handleHlsError);
        try {
          hls.stopLoad();
          hls.detachMedia();
          hls.destroy();
        } catch {
          // ignore
        }
        if (hlsRef.current === hls) {
          hlsRef.current = null;
        }
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS playback (e.g., Safari/iOS): uses native ABR without displaying fake manual quality options
      setHlsMasterLevels([]);
      video.src = activeHlsUrl;
      disableAllNativeAndHlsSubtitlesRef.current();
      restorePlaybackPositionOnVideoRef.current(video);

      const handleNativeError = () => {
        if (isMasterPlaylistModeRef.current) {
          setIsSwitchingQuality(false);
          qualitySwitchStateRef.current = null;
          setLocalPlaybackError(
            `Failed to load the ${providerDisplayNameRef.current} HLS stream. Please retry playback or switch audio version.`
          );
          return;
        }
        attemptNextQualityFallbackRef.current(activeHlsUrl);
      };
      video.addEventListener('error', handleNativeError);
      return () => {
        video.removeEventListener('error', handleNativeError);
        try {
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch {
          // ignore
        }
      };
    }
  }, [activeHlsUrl]);

  // Clean up video and HLS on unmount
  useEffect(() => {
    const videoEl = videoRef.current;
    return () => {
      if (hlsRef.current) {
        try {
          hlsRef.current.stopLoad();
          hlsRef.current.detachMedia();
          hlsRef.current.destroy();
        } catch {
          // ignore
        }
        hlsRef.current = null;
      }
      if (videoEl) {
        try {
          videoEl.pause();
          videoEl.removeAttribute('src');
          videoEl.load();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Handle Video Time Updates & AniSkip triggers
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    if (qualitySwitchStateRef.current?.isSwitching) {
      restorePlaybackPositionOnVideo(video);
      return;
    }

    const time = video.currentTime;
    const savedTime =
      initialResumeTime > 0
        ? initialResumeTime
        : getSavedProgress(animeId, episodeNumber);

    // Prevent initial 0:00 mount tick from overwriting a restored playback position
    if (!hasRestoredPositionRef.current && savedTime > 5 && time < 2) {
      restorePlaybackPositionOnVideo(video);
      return;
    }

    setCurrentTime(time);

    // Throttled progress save (every 3 seconds)
    const now = Date.now();
    if (now - lastProgressSaveRef.current > 3000 && time > 0) {
      lastProgressSaveRef.current = now;
      persistProgress(time, video.duration);
    }

    // Check for active AniSkip Intervals (OP / ED) using latest intervals ref
    const intervals = skipIntervalsRef.current;
    const activeInterval = intervals.find(
      (s) => time >= s.interval.startTime && time <= s.interval.endTime
    );

    if (activeInterval) {
      if (
        (activeInterval.skipType.includes('op') && autoSkipIntroRef.current) ||
        (activeInterval.skipType.includes('ed') && autoSkipOutroRef.current)
      ) {
        video.currentTime = activeInterval.interval.endTime;
        setCurrentSkip(null);
        currentSkipRef.current = null;
      } else {
        if (currentSkipRef.current?.skipType !== activeInterval.skipType) {
          setCurrentSkip(activeInterval);
          currentSkipRef.current = activeInterval;
        }
      }
    } else {
      if (currentSkipRef.current !== null) {
        setCurrentSkip(null);
        currentSkipRef.current = null;
      }
    }
  };

  // Perform Skip action
  const handlePerformSkip = () => {
    const video = videoRef.current;
    const skip = currentSkipRef.current ?? currentSkip;
    if (!video || !skip) return;
    video.currentTime = skip.interval.endTime;
    setCurrentSkip(null);
    currentSkipRef.current = null;
    persistProgress(skip.interval.endTime, video.duration);
  };

  // Play / Pause toggle
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => {});
      setIsPlaying(true);
      const effectiveTime =
        video.currentTime > 0 ? video.currentTime : currentTime > 0 ? currentTime : 5;
      persistProgress(effectiveTime, video.duration);
    } else {
      video.pause();
      setIsPlaying(false);
      if (video.currentTime > 0) {
        persistProgress(video.currentTime, video.duration);
      }
    }
  }, [currentTime, persistProgress]);

  // Seek forward / backward
  const handleSeekRelative = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      const maxDur =
        video && Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : duration || 1440;
      const baseTime = video && video.currentTime > 0 ? video.currentTime : currentTime;
      const nextTime = Math.max(0, Math.min(maxDur, baseTime + seconds));
      if (video) {
        try {
          video.currentTime = nextTime;
        } catch {
          // Ignore if media not ready
        }
      }
      hasRestoredPositionRef.current = true;
      setCurrentTime(nextTime);
      persistProgress(nextTime, maxDur);
    },
    [currentTime, duration, persistProgress]
  );

  // Progress bar scrub
  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    const newTime = parseFloat(e.target.value);
    const maxDur =
      video && Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : duration || 1440;
    if (video) {
      try {
        video.currentTime = newTime;
      } catch {
        // Ignore if media not ready
      }
    }
    hasRestoredPositionRef.current = true;
    setCurrentTime(newTime);
    persistProgress(newTime, maxDur);
  };

  // Volume & Mute
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const newVol = parseFloat(e.target.value);
    video.volume = newVol;
    setVolume(newVol);
    setIsMuted(newVol === 0);
  };

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isMuted) {
      video.volume = volume || 1;
      setIsMuted(false);
    } else {
      video.volume = 0;
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  // Fullscreen
  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Playback speed
  const changeSpeed = (speed: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    setPlaybackSpeed(speed);
    setShowSettingsMenu(false);
  };

  // Subtitle preference handlers
  const handleUpdateSubtitlePrefs = (newPrefs: Partial<SubtitlePreferences>) => {
    const updated = saveSubtitlePreferences(newPrefs);
    setSubtitlePrefs(updated);
  };

  const handleResetSubtitlePrefs = () => {
    const reset = resetSubtitlePreferences();
    setSubtitlePrefs(reset);
  };

  // Mouse activity auto-hide controls (2.5s)
  const handleMouseMove = () => {
    setShowControls(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    hideControlsTimerRef.current = setTimeout(() => {
      if (
        isPlaying &&
        !showSettingsMenu &&
        !showSubtitleMenu &&
        !showQualityMenu
      ) {
        setShowControls(false);
      }
    }, 2500);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleSeekRelative(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleSeekRelative(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume((prev) => {
            const next = Math.min(1, prev + 0.1);
            if (videoRef.current) videoRef.current.volume = next;
            return next;
          });
          setIsMuted(false);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume((prev) => {
            const next = Math.max(0, prev - 0.1);
            if (videoRef.current) videoRef.current.volume = next;
            return next;
          });
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
          break;
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'KeyN':
          e.preventDefault();
          if (episodeNumber < totalEpisodes) {
            onNavigateEpisode(episodeNumber + 1);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    togglePlay,
    toggleMute,
    handleSeekRelative,
    episodeNumber,
    totalEpisodes,
    onNavigateEpisode,
  ]);

  // Video ended -> Auto next episode
  const handleVideoEnded = () => {
    setIsPlaying(false);
    if (autoPlayNext && episodeNumber < totalEpisodes) {
      onNavigateEpisode(episodeNumber + 1);
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const effectiveError = streamError || localPlaybackError;
  const isEmbedMode = Boolean(
    streamData && (streamData.iframeOnly || streamData.playbackMode === 'embed')
  );
  const areSubtitlesOff =
    subtitlePreference === 'off' || activeSubtitleUrl === 'off';

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden border border-[#292929] select-none group"
    >
      {/* Special Iframe-Only Playback Path */}
      {isEmbedMode && streamData?.embedUrl && !effectiveError ? (
        <iframe
          src={streamData.embedUrl}
          title={`${animeTitle} Episode ${episodeNumber}`}
          className="w-full h-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : (
        /* Standard HTML5 Video Element */
        <video
          ref={videoRef}
          className="w-full h-full object-contain cursor-pointer"
          onClick={togglePlay}
          onPlay={() => setIsPlaying(true)}
          onPause={() => {
            setIsPlaying(false);
            if (videoRef.current && videoRef.current.currentTime >= 1) {
              persistProgress(
                videoRef.current.currentTime,
                videoRef.current.duration || duration || episodeDurationSeconds || 1440
              );
            }
          }}
          onTimeUpdate={handleTimeUpdate}
          onSeeked={handleTimeUpdate}
          onLoadedMetadata={() => {
            if (videoRef.current) {
              if (videoRef.current.duration && isFinite(videoRef.current.duration)) {
                setDuration(videoRef.current.duration);
              }
              disableAllNativeAndHlsSubtitles();
              restorePlaybackPositionOnVideo(videoRef.current);
            }
          }}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => {
            setIsBuffering(false);
            setIsSwitchingQuality(false);
          }}
          onEnded={handleVideoEnded}
          playsInline
          crossOrigin="anonymous"
        />
      )}

      {/* Center Big Play Button Overlay */}
      {!isPlaying && !isLoadingStream && !isBuffering && !isSwitchingQuality && !effectiveError && !isEmbedMode && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <button
            type="button"
            data-testid="center-play-button"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            aria-label="Play video"
            className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white text-black hover:bg-neutral-200 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center shadow-2xl backdrop-blur pointer-events-auto cursor-pointer group"
          >
            <Play size={28} className="translate-x-0.5 fill-black group-hover:scale-110 transition-transform" />
          </button>
        </div>
      )}

      {/* Loading Stream, Quality Switch, or Buffering Spinner */}
      {(isLoadingStream || isBuffering || isSwitchingQuality) && !effectiveError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 pointer-events-none z-20">
          <Loader2 size={44} className="text-white animate-spin mb-2" />
          <p className="text-xs text-[#A0A0A0] font-medium tracking-wider uppercase">
            {isLoadingStream
              ? 'Loading Video Stream...'
              : isSwitchingQuality
              ? `Switching to ${selectedQualityLabel}...`
              : 'Buffering...'}
          </p>
        </div>
      )}

      {/* Playback Error State */}
      {effectiveError && (
        <div
          data-testid="player-error-overlay"
          className="absolute inset-0 flex flex-col items-center justify-center bg-[#0A0A0A] p-6 text-center z-30"
        >
          <AlertCircle size={40} className="text-[#A0A0A0] mb-3" />
          <h3 className="text-base font-semibold text-white mb-1">
            Playback Unavailable
          </h3>
          <p className="text-xs text-[#A0A0A0] max-w-md mb-4">
            {effectiveError}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {onRetryStream && (
              <button
                type="button"
                onClick={() => {
                  setLocalPlaybackError(null);
                  failedQualityUrlsRef.current.clear();
                  hasTriedMasterFallbackRef.current = false;
                  onRetryStream();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors cursor-pointer"
              >
                <RefreshCw size={13} />
                <span>Retry Stream</span>
              </button>
            )}

            {/* Switch to the other version only if that version is actually available */}
            {((activeType === 'sub' && hasDub) ||
              (activeType === 'dub' && hasSub)) && (
              <button
                type="button"
                onClick={() => onChangeType(activeType === 'sub' ? 'dub' : 'sub')}
                className="px-4 py-2 rounded-lg border border-white/30 text-white text-xs font-semibold hover:border-white transition-colors cursor-pointer"
              >
                Switch to {activeType === 'sub' ? 'Dub' : 'Sub'}
              </button>
            )}

            {streamData?.embedUrl && (
              <a
                href={streamData.embedUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#292929] text-white text-xs hover:border-white transition-colors"
              >
                <span>Open External Stream</span>
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Resume Position Prompt */}
      {resumePrompt && (
        <div className="absolute bottom-20 left-6 z-30 bg-[#141414]/90 border border-[#292929] backdrop-blur-md rounded-xl p-3 flex items-center gap-3 shadow-xl">
          <div className="text-xs">
            <span className="text-[#A0A0A0]">Resume from </span>
            <span className="text-white font-mono font-medium">
              {formatTime(resumePrompt.time)}
            </span>
            <span className="text-[#A0A0A0]">?</span>
          </div>
          <button
            onClick={() => {
              if (videoRef.current) {
                videoRef.current.currentTime = resumePrompt.time;
              }
              setResumePrompt(null);
            }}
            className="px-2.5 py-1 bg-white text-black text-[11px] font-semibold rounded hover:bg-neutral-200 transition-colors"
          >
            Resume
          </button>
          <button
            onClick={() => setResumePrompt(null)}
            className="text-[11px] text-[#707070] hover:text-white transition-colors"
          >
            Start Over
          </button>
        </div>
      )}

      {/* Minimalist AniSkip Button (Preserved independent of ZokoAnime API) */}
      {currentSkip && !isEmbedMode && (
        <div className="absolute right-6 bottom-24 z-30 animate-fadeIn">
          <button
            data-testid="aniskip-button"
            onClick={handlePerformSkip}
            className="group px-4 py-2 rounded-xl bg-black/70 hover:bg-black/90 border border-emerald-500/70 hover:border-emerald-400 text-white hover:text-emerald-300 text-xs font-semibold tracking-wide shadow-2xl backdrop-blur-md transition-all flex items-center gap-2.5 active:scale-95 cursor-pointer"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse group-hover:bg-emerald-400" />
            <span>
              {currentSkip.skipType.includes('op')
                ? 'Skip Intro'
                : currentSkip.skipType.includes('ed')
                ? 'Skip Outro'
                : 'Skip Recap'}
            </span>
            <SkipForward size={14} className="text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      )}

      {/* Custom Subtitle Overlay — strictly disabled when subtitles are Off */}
      {!areSubtitlesOff && !isEmbedMode && (
        <SubtitleOverlay
          currentTime={currentTime}
          cues={parsedCues}
          preferences={subtitlePrefs}
          showControls={showControls}
          isFullscreen={isFullscreen}
        />
      )}

      {/* Player Overlays & Controls Bar */}
      {!isEmbedMode && (
        <div
          className={`absolute inset-0 pointer-events-none transition-opacity duration-300 flex flex-col justify-between ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* Top Bar: Title & Dynamic Episode-Specific Sub/Dub Selector */}
          <div className="p-4 md:p-6 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between pointer-events-auto">
            <div>
              <div className="flex items-center gap-2 text-xs text-[#A0A0A0]">
                <span className="font-semibold text-white uppercase tracking-wider">
                  Episode {episodeNumber}
                </span>
                {totalEpisodes > 1 && (
                  <>
                    <span aria-hidden="true" className="text-[#707070]">/</span>
                    <span>{totalEpisodes}</span>
                  </>
                )}
              </div>
              <h3 className="text-sm md:text-base font-bold text-white truncate max-w-md md:max-w-xl">
                {episodeTitle || animeTitle}
              </h3>
            </div>

            {/* Dynamic Sub / Dub Selector Pill (Never shows disabled buttons for unavailable versions) */}
            <div
              data-testid="player-sub-dub-controls"
              data-availability-status={
                isLoadingAvailability
                  ? 'loading'
                  : hasSub && hasDub
                  ? 'both'
                  : hasSub
                  ? 'sub-only'
                  : hasDub
                  ? 'dub-only'
                  : 'unavailable'
              }
              className="flex items-center bg-[#141414]/90 border border-[#292929] rounded-lg p-0.5"
            >
              {isLoadingAvailability ? (
                <span className="px-3 py-1 text-[11px] font-mono text-[#A0A0A0] flex items-center gap-1.5">
                  <Loader2 size={11} className="animate-spin text-white" />
                  <span>Audio...</span>
                </span>
              ) : !hasSub && !hasDub ? (
                <span
                  data-testid="player-audio-unavailable"
                  className="px-3 py-1 text-[11px] font-mono text-[#707070]"
                >
                  Unavailable
                </span>
              ) : (
                <>
                  {hasSub && (
                    <button
                      type="button"
                      data-testid="player-btn-sub"
                      onClick={() => onChangeType('sub')}
                      className={`px-3 py-1 text-xs rounded font-medium transition-colors cursor-pointer ${
                        activeType === 'sub'
                          ? 'bg-white text-black font-semibold'
                          : 'text-[#A0A0A0] hover:text-white'
                      }`}
                    >
                      SUB
                    </button>
                  )}
                  {hasDub && (
                    <button
                      type="button"
                      data-testid="player-btn-dub"
                      onClick={() => onChangeType('dub')}
                      className={`px-3 py-1 text-xs rounded font-medium transition-colors cursor-pointer ${
                        activeType === 'dub'
                          ? 'bg-white text-black font-semibold'
                          : 'text-[#A0A0A0] hover:text-white'
                      }`}
                    >
                      DUB
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Bottom Bar: Progress Slider & Action Buttons */}
          <div className="p-4 md:p-6 bg-gradient-to-t from-black/90 via-black/50 to-transparent space-y-2 pointer-events-auto">
            {/* Progress Scrubber */}
            <div className="relative group/scrubber flex items-center">
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={handleSeekChange}
                className="w-full h-1 bg-[#292929] accent-white rounded-lg cursor-pointer transition-all hover:h-2"
                aria-label="Video scrubber"
              />
            </div>

            {/* Controls Strip */}
            <div className="flex items-center justify-between text-white text-xs pt-1">
              {/* Left Controls: Play, 10s Seek, Prev/Next Ep, Volume, Time */}
              <div className="flex items-center gap-2 sm:gap-4">
                <button
                  onClick={togglePlay}
                  className="p-1.5 hover:text-[#A0A0A0] transition-colors cursor-pointer"
                  title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause size={20} fill="currentColor" />
                  ) : (
                    <Play size={20} fill="currentColor" />
                  )}
                </button>

                <button
                  onClick={() => handleSeekRelative(-10)}
                  className="p-1.5 hover:text-[#A0A0A0] transition-colors cursor-pointer"
                  title="Seek backward 10s (Left Arrow)"
                  aria-label="Seek backward 10s"
                >
                  <RotateCcw size={18} />
                </button>

                <button
                  onClick={() => handleSeekRelative(10)}
                  className="p-1.5 hover:text-[#A0A0A0] transition-colors cursor-pointer"
                  title="Seek forward 10s (Right Arrow)"
                  aria-label="Seek forward 10s"
                >
                  <RotateCw size={18} />
                </button>

                {/* Prev / Next Episode Buttons */}
                <button
                  onClick={() => onNavigateEpisode(episodeNumber - 1)}
                  disabled={episodeNumber <= 1}
                  className="p-1.5 hover:text-[#A0A0A0] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                  title="Previous episode"
                  aria-label="Previous episode"
                >
                  <SkipBack size={18} />
                </button>

                <button
                  onClick={() => onNavigateEpisode(episodeNumber + 1)}
                  disabled={episodeNumber >= totalEpisodes}
                  className="p-1.5 hover:text-[#A0A0A0] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                  title="Next episode (N)"
                  aria-label="Next episode"
                >
                  <SkipForward size={18} />
                </button>

                {/* Volume & Slider */}
                <div className="flex items-center gap-1.5 group/vol">
                  <button
                    onClick={toggleMute}
                    className="p-1.5 hover:text-[#A0A0A0] transition-colors cursor-pointer"
                    title="Mute (M)"
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX size={19} />
                    ) : (
                      <Volume2 size={19} />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="w-16 h-1 bg-[#292929] accent-white rounded cursor-pointer hidden sm:block"
                    aria-label="Volume slider"
                  />
                </div>

                {/* Time display */}
                <div className="font-mono text-[11px] text-[#A0A0A0] tracking-tight ml-1">
                  <span className="text-white">{formatTime(currentTime)}</span>
                  <span className="mx-1 text-[#707070]">/</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Right Controls: Subtitles, Quality Selector, Settings, Fullscreen */}
              <div className="flex items-center gap-2 sm:gap-3 relative">
                {/* Subtitles Button & Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    data-testid="subtitle-menu-button"
                    onClick={() => {
                      setShowSubtitleMenu((prev) => !prev);
                      setShowSettingsMenu(false);
                      setShowQualityMenu(false);
                    }}
                    className={`p-1.5 transition-colors cursor-pointer ${
                      !areSubtitlesOff
                        ? 'text-white'
                        : 'text-[#707070] hover:text-white'
                    }`}
                    title="Subtitles & Customization"
                    aria-label="Subtitles"
                  >
                    <Subtitles size={18} />
                  </button>

                  {showSubtitleMenu && (
                    <div
                      data-testid="subtitle-menu-dropdown"
                      className="absolute bottom-full right-0 mb-2 w-56 max-h-72 overflow-y-auto bg-[#141414] border border-[#292929] rounded-xl shadow-xl p-2 z-50 text-xs"
                    >
                      <div className="px-2 py-1 text-[10px] uppercase font-semibold text-[#707070] tracking-wider flex items-center justify-between">
                        <span>Subtitles</span>
                        {isLoadingSubtitles && (
                          <Loader2 size={11} className="animate-spin text-white" />
                        )}
                      </div>
                      <button
                        type="button"
                        data-testid="subtitle-option-off"
                        onClick={() => handleSelectSubtitle('off')}
                        className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1B1B1B] flex items-center justify-between cursor-pointer"
                      >
                        <span>Off</span>
                        {areSubtitlesOff && <Check size={13} />}
                      </button>
                      {subtitleTracks.length > 0 ? (
                        subtitleTracks.map((sub, sIdx) => {
                          const displayLabel = sub.label || sub.lang;
                          const isSelected =
                            !areSubtitlesOff && activeSubtitleUrl === sub.url;
                          return (
                            <button
                              key={`${sub.url}-${sIdx}`}
                              type="button"
                              data-testid={`subtitle-option-${sIdx}`}
                              onClick={() => handleSelectSubtitle(sub.url)}
                              className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1B1B1B] flex items-center justify-between gap-2 truncate cursor-pointer"
                            >
                              <span className="truncate">{displayLabel}</span>
                              {isSelected && (
                                <Check size={13} className="shrink-0" />
                              )}
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-2 py-1 text-[11px] text-[#707070] italic">
                          No external tracks detected
                        </div>
                      )}

                      <div className="mt-1.5 pt-1.5 border-t border-[#292929]">
                        <button
                          type="button"
                          onClick={() => {
                            setShowSubtitleMenu(false);
                            setShowSubtitleSettings(true);
                          }}
                          className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1B1B1B] text-[#A0A0A0] hover:text-white flex items-center gap-2 cursor-pointer transition-colors"
                        >
                          <Sliders size={13} />
                          <span>Subtitle Customization...</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Quality Selector Button & Dropdown (Discrete URLs for ZokoAnime movies OR HLS.js Master Levels for MegaPlay series) */}
                {(availableQualities.length > 0 || hlsMasterLevels.length > 0) && (
                  <div className="relative">
                    <button
                      type="button"
                      data-testid="quality-menu-button"
                      onClick={() => {
                        setShowQualityMenu((prev) => !prev);
                        setShowSubtitleMenu(false);
                        setShowSettingsMenu(false);
                      }}
                      className="px-2 py-1 rounded-md bg-[#141414]/90 border border-[#292929] text-[11px] font-mono text-white hover:border-white/60 transition-colors flex items-center gap-1 cursor-pointer"
                      title="Video Quality"
                      aria-label="Video Quality"
                    >
                      <Layers size={13} className="text-[#A0A0A0]" />
                      <span>
                        {selectedQualityLabel ||
                          availableQualities[0]?.quality ||
                          'Auto'}
                      </span>
                    </button>

                    {showQualityMenu && (
                      <div
                        data-testid="quality-menu-dropdown"
                        className="absolute bottom-full right-0 mb-2 w-44 bg-[#141414] border border-[#292929] rounded-xl shadow-xl p-2 z-50 text-xs"
                      >
                        <div className="px-2 py-1 text-[10px] uppercase font-semibold text-[#707070] tracking-wider flex items-center justify-between">
                          <span>Quality</span>
                          {isSwitchingQuality && (
                            <Loader2 size={11} className="animate-spin text-white" />
                          )}
                        </div>
                        {availableQualities.length > 0 ? (
                          availableQualities.map((qItem) => {
                            const isSelected =
                              activeHlsUrl === qItem.hlsProxyUrl ||
                              selectedQualityLabel === qItem.quality;
                            return (
                              <button
                                key={qItem.quality}
                                type="button"
                                data-testid={`quality-option-${qItem.quality}`}
                                onClick={() => handleSelectQuality(qItem)}
                                className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1B1B1B] flex items-center justify-between cursor-pointer"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-white">
                                    {qItem.quality}
                                  </span>
                                  {qItem.resolution && (
                                    <span className="text-[10px] font-mono text-[#707070]">
                                      {qItem.resolution}
                                    </span>
                                  )}
                                </div>
                                {isSelected && <Check size={13} />}
                              </button>
                            );
                          })
                        ) : (
                          <>
                            <button
                              type="button"
                              data-testid="quality-option-Auto"
                              onClick={() => handleSelectHlsLevel(-1)}
                              className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1B1B1B] flex items-center justify-between cursor-pointer"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-white">Auto</span>
                                {selectedHlsLevel === -1 && activeHlsAutoHeight && (
                                  <span className="text-[10px] font-mono text-[#707070]">
                                    {activeHlsAutoHeight}p
                                  </span>
                                )}
                              </div>
                              {selectedHlsLevel === -1 && <Check size={13} />}
                            </button>
                            {hlsMasterLevels.map((lvl) => {
                              const isSelected = selectedHlsLevel === lvl.levelIndex;
                              return (
                                <button
                                  key={`${lvl.levelIndex}-${lvl.label}`}
                                  type="button"
                                  data-testid={`quality-option-${lvl.label}`}
                                  onClick={() => handleSelectHlsLevel(lvl.levelIndex)}
                                  className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1B1B1B] flex items-center justify-between cursor-pointer"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-white">
                                      {lvl.label}
                                    </span>
                                    {lvl.resolution && (
                                      <span className="text-[10px] font-mono text-[#707070]">
                                        {lvl.resolution}
                                      </span>
                                    )}
                                  </div>
                                  {isSelected && <Check size={13} />}
                                </button>
                              );
                            })}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Speed / Settings Button & Dropdown (Also includes Quality section) */}
                <div className="relative">
                  <button
                    type="button"
                    data-testid="settings-menu-button"
                    onClick={() => {
                      setShowSettingsMenu((prev) => !prev);
                      setShowSubtitleMenu(false);
                      setShowQualityMenu(false);
                    }}
                    className="p-1.5 text-[#A0A0A0] hover:text-white transition-colors cursor-pointer"
                    title="Quality, Speed & Settings"
                    aria-label="Playback Settings"
                  >
                    <SettingsIcon size={18} />
                  </button>

                  {showSettingsMenu && (
                    <div
                      data-testid="settings-menu-dropdown"
                      className="absolute bottom-full right-0 mb-2 w-52 max-h-80 overflow-y-auto bg-[#141414] border border-[#292929] rounded-xl shadow-xl p-2 z-50 text-xs"
                    >
                      {(availableQualities.length > 0 || hlsMasterLevels.length > 0) && (
                        <>
                          <div className="px-2 py-1 text-[10px] uppercase font-semibold text-[#707070] tracking-wider">
                            Quality
                          </div>
                          {availableQualities.length > 0 ? (
                            availableQualities.map((qItem) => {
                              const isSelected =
                                activeHlsUrl === qItem.hlsProxyUrl ||
                                selectedQualityLabel === qItem.quality;
                              return (
                                <button
                                  key={`settings-q-${qItem.quality}`}
                                  type="button"
                                  onClick={() => handleSelectQuality(qItem)}
                                  className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1B1B1B] flex items-center justify-between cursor-pointer"
                                >
                                  <span>{qItem.quality}</span>
                                  {isSelected && <Check size={13} />}
                                </button>
                              );
                            })
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handleSelectHlsLevel(-1)}
                                className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1B1B1B] flex items-center justify-between cursor-pointer"
                              >
                                <span>
                                  Auto
                                  {selectedHlsLevel === -1 && activeHlsAutoHeight
                                    ? ` (${activeHlsAutoHeight}p)`
                                    : ''}
                                </span>
                                {selectedHlsLevel === -1 && <Check size={13} />}
                              </button>
                              {hlsMasterLevels.map((lvl) => {
                                const isSelected = selectedHlsLevel === lvl.levelIndex;
                                return (
                                  <button
                                    key={`settings-hls-q-${lvl.levelIndex}-${lvl.label}`}
                                    type="button"
                                    onClick={() => handleSelectHlsLevel(lvl.levelIndex)}
                                    className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1B1B1B] flex items-center justify-between cursor-pointer"
                                  >
                                    <span>{lvl.label}</span>
                                    {isSelected && <Check size={13} />}
                                  </button>
                                );
                              })}
                            </>
                          )}
                          <div className="border-t border-[#292929] my-1" />
                        </>
                      )}

                      <div className="px-2 py-1 text-[10px] uppercase font-semibold text-[#707070] tracking-wider">
                        Subtitles
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSettingsMenu(false);
                          setShowSubtitleSettings(true);
                        }}
                        className="w-full text-left px-2 py-2 rounded hover:bg-[#1B1B1B] text-white flex items-center justify-between cursor-pointer transition-colors mb-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <Sliders size={13} className="text-[#A0A0A0]" />
                          <span>Subtitle Settings</span>
                        </div>
                        <span className="text-[10px] font-mono text-[#707070]">
                          {subtitlePrefs.fontSize}px
                        </span>
                      </button>

                      <div className="border-t border-[#292929] my-1" />

                      <div className="px-2 py-1 text-[10px] uppercase font-semibold text-[#707070] tracking-wider">
                        Playback Speed
                      </div>
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => changeSpeed(s)}
                          className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1B1B1B] flex items-center justify-between cursor-pointer"
                        >
                          <span>{s === 1 ? 'Normal' : `${s}x`}</span>
                          {playbackSpeed === s && <Check size={13} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Fullscreen Button */}
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="p-1.5 hover:text-[#A0A0A0] transition-colors cursor-pointer"
                  title="Fullscreen (F)"
                  aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                >
                  {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subtitle Customization Settings Modal */}
      <SubtitleSettingsModal
        isOpen={showSubtitleSettings}
        onClose={() => setShowSubtitleSettings(false)}
        preferences={subtitlePrefs}
        onUpdatePreferences={handleUpdateSubtitlePrefs}
        onResetPreferences={handleResetSubtitlePrefs}
      />
    </div>
  );
}
