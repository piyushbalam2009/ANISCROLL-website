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
  Download,
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
  sanitizeStreamUrlForDiagnostic,
  selectHlsAudioTrackIndex,
  selectInitialHlsLevelIndex,
  selectInitialQuality,
  selectNextFallbackQuality,
  resolveSubtitleTrackForPreference,
} from '@/lib/zokoanime-stream';
import { SubtitleOverlay } from './SubtitleOverlay';
import { SubtitleSettingsModal } from './SubtitleSettingsModal';
import { PlayerDownloadPanel } from './PlayerDownloadPanel';

const STREAM_DEBUG_ENABLED =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_DEBUG_STREAM === 'true';

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
  animeFormat?: string | null;
  isStandaloneMovie?: boolean;
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
  subStream?: AniScrollStreamResponse | null;
  dubStream?: AniScrollStreamResponse | null;
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
  animeFormat,
  isStandaloneMovie = false,
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
  subStream,
  dubStream,
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
  const lastPointerTypeRef = useRef<string>('mouse');
  const isScrubbingRef = useRef<boolean>(false);

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
  const [showDownloadPanel, setShowDownloadPanel] = useState(false);
  const [isDownloadingEpisode, setIsDownloadingEpisode] = useState(false);

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
  const activeTypeRef = useRef<'sub' | 'dub'>(activeType);
  const streamDebugMetaRef = useRef<{
    type: string | null;
    provider: string | null;
  }>({
    type: streamData?.type ?? null,
    provider: streamData?.provider ?? streamData?.source ?? null,
  });

  useEffect(() => {
    activeTypeRef.current = activeType;
  }, [activeType]);

  useEffect(() => {
    streamDebugMetaRef.current = {
      type: streamData?.type ?? null,
      provider: streamData?.provider ?? streamData?.source ?? null,
    };
  }, [streamData?.type, streamData?.provider, streamData?.source]);

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

  const syncAudioTrackForMode = useCallback((mode: 'sub' | 'dub') => {
    const hls = hlsRef.current;
    if (hls) {
      const targetPreference = mode === 'dub' ? { lang: 'en' } : { lang: 'ja' };
      try {
        if (hls.config) {
          hls.config.audioPreference = targetPreference;
        }
      } catch {
        // Ignore read-only config
      }

      const hlsTracks = Array.isArray(hls.audioTracks) ? hls.audioTracks : [];
      if (hlsTracks.length > 1) {
        const targetIdx = selectHlsAudioTrackIndex(hlsTracks, mode);
        if (STREAM_DEBUG_ENABLED) {
          console.debug('[AniScroll][VideoPlayer] sync HLS audio track', {
            mode,
            currentAudioTrack: hls.audioTrack,
            targetIdx,
            availableTracks: hlsTracks.map((t, idx) => ({
              idx,
              name: t.name,
              lang: t.lang,
              default: t.default,
            })),
          });
        }
        if (targetIdx >= 0 && hls.audioTrack !== targetIdx) {
          try {
            hls.audioTrack = targetIdx;
          } catch {
            // Fallback to setAudioOption if direct index fails
            const trackObj = hlsTracks[targetIdx];
            if (trackObj && typeof hls.setAudioOption === 'function') {
              hls.setAudioOption(trackObj);
            }
          }
        }
      }
    }

    const videoEl = videoRef.current as
      | (HTMLVideoElement & {
          audioTracks?: ArrayLike<{
            label?: string;
            language?: string;
            enabled: boolean;
          }>;
        })
      | null;
    if (videoEl?.audioTracks && videoEl.audioTracks.length > 1) {
      const nativeTracks = Array.from(videoEl.audioTracks);
      const targetIdx = selectHlsAudioTrackIndex(nativeTracks, mode);
      if (targetIdx >= 0) {
        nativeTracks.forEach((track, idx) => {
          try {
            track.enabled = idx === targetIdx;
          } catch {
            // Ignore read-only native track error
          }
        });
      }
    }
  }, []);

  const syncAudioTrackForModeRef = useRef(syncAudioTrackForMode);
  useEffect(() => {
    syncAudioTrackForModeRef.current = syncAudioTrackForMode;
  });

  // React immediately when activeType or streamData updates (essential when Sub & Dub share a multi-audio master.m3u8 URL)
  useEffect(() => {
    syncAudioTrackForMode(activeType);
  }, [activeType, activeHlsUrl, streamData, syncAudioTrackForMode]);

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
      const initialAudioMode = activeTypeRef.current;
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        renderTextTracksNatively: false,
        audioPreference: initialAudioMode === 'dub' ? { lang: 'en' } : { lang: 'ja' },
      });

      hlsRef.current = hls;
      // Ensure HLS internal subtitle rendering stays disabled; we render subtitles cleanly via SubtitleOverlay
      hls.subtitleDisplay = false;
      hls.subtitleTrack = -1;

      if (STREAM_DEBUG_ENABLED) {
        console.debug('[AniScroll][VideoPlayer] attach HLS source', {
          activeType: initialAudioMode,
          streamType: streamDebugMetaRef.current.type,
          provider: streamDebugMetaRef.current.provider,
          sanitizedUrl: sanitizeStreamUrlForDiagnostic(activeHlsUrl),
        });
      }

      hls.loadSource(activeHlsUrl);
      hls.attachMedia(video);

      const handleAudioTracksUpdated = () => {
        syncAudioTrackForModeRef.current(activeTypeRef.current);
      };

      const handleManifestParsed = () => {
        hls.subtitleDisplay = false;
        hls.subtitleTrack = -1;
        disableAllNativeAndHlsSubtitlesRef.current();
        syncAudioTrackForModeRef.current(activeTypeRef.current);

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

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, handleAudioTracksUpdated);
      hls.on(Hls.Events.MANIFEST_PARSED, handleManifestParsed);
      hls.on(Hls.Events.LEVEL_SWITCHED, handleLevelSwitched);
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, handleSubtitleTracksUpdated);
      hls.on(Hls.Events.ERROR, handleHlsError);

      return () => {
        hls.off(Hls.Events.AUDIO_TRACKS_UPDATED, handleAudioTracksUpdated);
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

  const scheduleHideControls = useCallback(
    (delayOverrideMs?: number) => {
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
      const timeoutMs =
        delayOverrideMs ?? (lastPointerTypeRef.current === 'touch' ? 3500 : 2500);
      hideControlsTimerRef.current = setTimeout(() => {
        if (
          isPlaying &&
          !isScrubbingRef.current &&
          !showSettingsMenu &&
          !showSubtitleMenu &&
          !showQualityMenu &&
          !showDownloadPanel
        ) {
          setShowControls(false);
        }
      }, timeoutMs);
    },
    [isPlaying, showDownloadPanel, showQualityMenu, showSettingsMenu, showSubtitleMenu]
  );

  useEffect(() => {
    return () => {
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, []);

  // Keep controls visible whenever a player menu opens
  useEffect(() => {
    if (showSettingsMenu || showSubtitleMenu || showQualityMenu || showDownloadPanel) {
      setShowControls(true);
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
    } else if (isPlaying) {
      scheduleHideControls();
    }
  }, [showSettingsMenu, showSubtitleMenu, showQualityMenu, showDownloadPanel, isPlaying, scheduleHideControls]);

  // Synchronize fullscreen state across native browser events, Escape key, and iOS WebKit exits
  useEffect(() => {
    const syncFullscreenState = () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
        msFullscreenElement?: Element | null;
      };
      const fsEl =
        doc.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.msFullscreenElement ||
        null;
      const active = Boolean(fsEl);
      setIsFullscreen(active);
      if (!active) {
        try {
          (
            screen.orientation as ScreenOrientation & { unlock?: () => void }
          )?.unlock?.();
        } catch {
          // Ignore unsupported orientation unlock
        }
      }
    };

    const videoEl = videoRef.current as
      | (HTMLVideoElement & {
          webkitDisplayingFullscreen?: boolean;
        })
      | null;
    const handleWebkitEndFullscreen = () => {
      setIsFullscreen(false);
    };

    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    document.addEventListener('msfullscreenchange', syncFullscreenState);
    if (videoEl) {
      videoEl.addEventListener('webkitendfullscreen', handleWebkitEndFullscreen);
    }

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
      document.removeEventListener('msfullscreenchange', syncFullscreenState);
      if (videoEl) {
        videoEl.removeEventListener(
          'webkitendfullscreen',
          handleWebkitEndFullscreen
        );
      }
    };
  }, []);

  // Fullscreen with cross-browser mobile/iOS fallbacks and landscape lock
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current as
      | (HTMLDivElement & {
          webkitRequestFullscreen?: () => Promise<void> | void;
          msRequestFullscreen?: () => Promise<void> | void;
        })
      | null;
    const video = videoRef.current as
      | (HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
          webkitExitFullscreen?: () => void;
        })
      | null;
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
      msFullscreenElement?: Element | null;
      msExitFullscreen?: () => Promise<void> | void;
    };

    const currentFs =
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.msFullscreenElement ||
      null;

    if (!currentFs) {
      const requestPromise = container?.requestFullscreen
        ? container.requestFullscreen()
        : container?.webkitRequestFullscreen
        ? Promise.resolve(container.webkitRequestFullscreen())
        : container?.msRequestFullscreen
        ? Promise.resolve(container.msRequestFullscreen())
        : null;

      if (requestPromise) {
        requestPromise
          .then(() => {
            setIsFullscreen(true);
            if (typeof window !== 'undefined' && window.innerWidth < 1024) {
              try {
                (
                  screen.orientation as ScreenOrientation & {
                    lock?: (orientation: string) => Promise<void>;
                  }
                )
                  ?.lock?.('landscape')
                  ?.catch(() => {});
              } catch {
                // Ignore unsupported orientation lock
              }
            }
          })
          .catch(() => {
            if (video?.webkitEnterFullscreen) {
              try {
                video.webkitEnterFullscreen();
                setIsFullscreen(true);
              } catch {
                // Ignore unsupported fullscreen fallback
              }
            }
          });
      } else if (video?.webkitEnterFullscreen) {
        try {
          video.webkitEnterFullscreen();
          setIsFullscreen(true);
        } catch {
          // Ignore unsupported fullscreen fallback
        }
      }
    } else {
      const exitPromise = doc.exitFullscreen
        ? doc.exitFullscreen()
        : doc.webkitExitFullscreen
        ? Promise.resolve(doc.webkitExitFullscreen())
        : doc.msExitFullscreen
        ? Promise.resolve(doc.msExitFullscreen())
        : null;
      exitPromise?.catch(() => {});
      setIsFullscreen(false);
    }
    setShowControls(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

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

  // Pointer & mouse activity auto-hide controls
  const handleMouseMove = () => {
    if (lastPointerTypeRef.current === 'touch') return;
    setShowControls(true);
    scheduleHideControls(2500);
  };

  const handleTouchInteraction = () => {
    lastPointerTypeRef.current = 'touch';
    setShowControls(true);
    scheduleHideControls(3500);
  };

  const handleVideoClick = () => {
    if (lastPointerTypeRef.current === 'touch' && isPlaying && !showControls) {
      setShowControls(true);
      scheduleHideControls(3500);
      return;
    }
    togglePlay();
    setShowControls(true);
    scheduleHideControls();
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
    toggleFullscreen,
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
      onPointerDown={(e) => {
        lastPointerTypeRef.current = e.pointerType || 'mouse';
        setShowControls(true);
        scheduleHideControls(e.pointerType === 'touch' ? 3500 : 2500);
      }}
      onTouchStart={handleTouchInteraction}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        if (
          isPlaying &&
          lastPointerTypeRef.current !== 'touch' &&
          !showSettingsMenu &&
          !showSubtitleMenu &&
          !showQualityMenu &&
          !showDownloadPanel
        ) {
          setShowControls(false);
        }
      }}
      className={`@container relative w-full max-w-full bg-black overflow-hidden select-none group ${
        isFullscreen
          ? 'h-full max-h-screen rounded-none border-0 flex items-center justify-center'
          : 'aspect-video rounded-xl sm:rounded-2xl border border-[#292929] mx-auto [@media(orientation:landscape)_and_(max-height:500px)]:max-w-[calc((100dvh-8.5rem)*16/9)]'
      }`}
    >
      {/* Special Iframe-Only Playback Path */}
      {isEmbedMode && streamData?.embedUrl && !effectiveError ? (
        <iframe
          key={`${streamData.embedUrl}-${activeType}`}
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
          onClick={handleVideoClick}
          onPlay={() => setIsPlaying(true)}
          onPause={() => {
            setIsPlaying(false);
            setShowControls(true);
            if (videoRef.current && videoRef.current.currentTime >= 1) {
              persistProgress(
                videoRef.current.currentTime,
                videoRef.current.duration || duration || episodeDurationSeconds || 1440
              );
            }
          }}
          onTimeUpdate={handleTimeUpdate}
          onSeeking={handleTimeUpdate}
          onSeeked={handleTimeUpdate}
          onLoadedMetadata={() => {
            if (videoRef.current) {
              if (videoRef.current.duration && isFinite(videoRef.current.duration)) {
                setDuration(videoRef.current.duration);
              }
              disableAllNativeAndHlsSubtitles();
              syncAudioTrackForModeRef.current(activeTypeRef.current);
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
              scheduleHideControls();
            }}
            aria-label="Play video"
            className="w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 rounded-full bg-white text-black hover:bg-neutral-200 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center shadow-2xl backdrop-blur pointer-events-auto cursor-pointer group touch-manipulation"
          >
            <Play className="w-5 h-5 sm:w-7 sm:h-7 translate-x-0.5 fill-black group-hover:scale-110 transition-transform" />
          </button>
        </div>
      )}

      {/* Loading Stream, Quality Switch, or Buffering Spinner */}
      {(isLoadingStream || isBuffering || isSwitchingQuality) && !effectiveError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 pointer-events-none z-20 px-4 text-center">
          <Loader2 className="w-8 h-8 sm:w-11 sm:h-11 text-white animate-spin mb-2" />
          <p className="text-[11px] sm:text-xs text-[#A0A0A0] font-medium tracking-wider uppercase">
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
          className="absolute inset-0 flex flex-col items-center justify-center bg-[#0A0A0A] p-3 sm:p-6 text-center z-30 overflow-y-auto"
        >
          <AlertCircle className="w-7 h-7 sm:w-10 sm:h-10 text-[#A0A0A0] mb-2 sm:mb-3 shrink-0" />
          <h3 className="text-sm sm:text-base font-semibold text-white mb-1">
            Playback Unavailable
          </h3>
          <p className="text-[11px] sm:text-xs text-[#A0A0A0] max-w-md mb-3 sm:mb-4 line-clamp-3 sm:line-clamp-none">
            {effectiveError}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
            {onRetryStream && (
              <button
                type="button"
                onClick={() => {
                  setLocalPlaybackError(null);
                  failedQualityUrlsRef.current.clear();
                  hasTriedMasterFallbackRef.current = false;
                  onRetryStream();
                }}
                className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-white text-black text-[11px] sm:text-xs font-semibold hover:bg-neutral-200 transition-colors cursor-pointer touch-manipulation"
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
                className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg border border-white/30 text-white text-[11px] sm:text-xs font-semibold hover:border-white transition-colors cursor-pointer touch-manipulation"
              >
                Switch to {activeType === 'sub' ? 'Dub' : 'Sub'}
              </button>
            )}

            {streamData?.embedUrl && (
              <a
                href={streamData.embedUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg border border-[#292929] text-white text-[11px] sm:text-xs hover:border-white transition-colors touch-manipulation"
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
        <div className="absolute bottom-14 sm:bottom-20 left-2.5 right-2.5 sm:right-auto sm:left-6 z-30 bg-[#141414]/92 border border-[#292929] backdrop-blur-md rounded-xl px-2.5 py-1.5 sm:p-3 flex flex-wrap items-center gap-2 sm:gap-3 shadow-xl max-w-fit">
          <div className="text-[11px] sm:text-xs">
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
            className="px-2.5 py-1 bg-white text-black text-[11px] font-semibold rounded hover:bg-neutral-200 transition-colors cursor-pointer touch-manipulation"
          >
            Resume
          </button>
          <button
            onClick={() => setResumePrompt(null)}
            className="text-[11px] text-[#707070] hover:text-white transition-colors cursor-pointer touch-manipulation"
          >
            Start Over
          </button>
        </div>
      )}

      {/* Minimalist AniSkip Button — AniScroll dark monochrome theme (Intro / Outro / Recap) */}
      {currentSkip && !isEmbedMode && (
        <div
          style={
            isFullscreen
              ? {
                  right: 'max(1rem, env(safe-area-inset-right))',
                }
              : undefined
          }
          className={`absolute right-2.5 @[560px]:right-6 z-30 animate-fadeIn transition-all duration-200 ${
            showControls
              ? 'bottom-14 @[560px]:bottom-24'
              : 'bottom-3 @[560px]:bottom-6 @[768px]:bottom-8'
          }`}
        >
          <div className="rounded-lg bg-[rgba(15,15,15,0.88)] border border-[rgba(255,255,255,0.14)] hover:border-[rgba(255,255,255,0.28)] backdrop-blur-md transition-colors">
            <button
              type="button"
              data-testid="aniskip-button"
              onClick={handlePerformSkip}
              className="group px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-[#FFFFFF] hover:bg-[rgba(255,255,255,0.12)] active:bg-[rgba(255,255,255,0.18)] text-[11px] sm:text-xs font-medium tracking-wide transition-all flex items-center gap-2 active:scale-[0.98] cursor-pointer touch-manipulation"
            >
              <span>
                {currentSkip.skipType.includes('op')
                  ? 'Skip Intro'
                  : currentSkip.skipType.includes('ed')
                  ? 'Skip Outro'
                  : 'Skip Recap'}
              </span>
              <SkipForward
                size={13}
                className="text-[#B3B3B3] group-hover:text-[#FFFFFF] group-hover:translate-x-0.5 transition-all shrink-0"
              />
            </button>
          </div>
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
          <div
            style={
              isFullscreen
                ? {
                    paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
                    paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
                    paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
                  }
                : undefined
            }
            className="px-2.5 py-2 @[560px]:p-4 @[768px]:p-6 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between gap-2 pointer-events-auto"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 @[560px]:gap-2 text-[10px] @[560px]:text-xs text-[#A0A0A0]">
                <span className="font-semibold text-white uppercase tracking-wider shrink-0">
                  Episode {episodeNumber}
                </span>
                {totalEpisodes > 1 && (
                  <>
                    <span aria-hidden="true" className="text-[#707070]">/</span>
                    <span>{totalEpisodes}</span>
                  </>
                )}
              </div>
              <h3 className="text-xs @[560px]:text-sm @[768px]:text-base font-bold text-white truncate max-w-full @[768px]:max-w-xl">
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
              className="flex items-center bg-[#141414]/90 border border-[#292929] rounded-lg p-0.5 shrink-0"
            >
              {isLoadingAvailability ? (
                <span className="px-2 sm:px-3 py-1 text-[10px] sm:text-[11px] font-mono text-[#A0A0A0] flex items-center gap-1.5">
                  <Loader2 size={11} className="animate-spin text-white" />
                  <span>Audio...</span>
                </span>
              ) : !hasSub && !hasDub ? (
                <span
                  data-testid="player-audio-unavailable"
                  className="px-2 sm:px-3 py-1 text-[10px] sm:text-[11px] font-mono text-[#707070]"
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
                      className={`px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs rounded font-medium transition-colors cursor-pointer min-h-[26px] sm:min-h-0 touch-manipulation ${
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
                      className={`px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs rounded font-medium transition-colors cursor-pointer min-h-[26px] sm:min-h-0 touch-manipulation ${
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
          <div
            style={
              isFullscreen
                ? {
                    paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
                    paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
                    paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
                  }
                : undefined
            }
            className="px-2.5 pb-2 pt-3 @[560px]:p-4 @[768px]:p-6 bg-gradient-to-t from-black/90 via-black/55 to-transparent space-y-1 @[560px]:space-y-2 pointer-events-auto"
          >
            {/* Progress Scrubber (shows flanking compact timestamps on < 560px container widths so button strip fits cleanly) */}
            <div className="relative group/scrubber flex items-center gap-2 @[560px]:gap-0">
              <span className="@[560px]:hidden font-mono text-[10px] text-white tabular-nums shrink-0">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onPointerDown={() => {
                  isScrubbingRef.current = true;
                  setShowControls(true);
                }}
                onPointerUp={() => {
                  isScrubbingRef.current = false;
                  scheduleHideControls();
                }}
                onTouchStart={() => {
                  isScrubbingRef.current = true;
                  setShowControls(true);
                }}
                onTouchEnd={() => {
                  isScrubbingRef.current = false;
                  scheduleHideControls(3500);
                }}
                onChange={handleSeekChange}
                className="w-full h-1.5 @[560px]:h-1 bg-[#292929] accent-white rounded-lg cursor-pointer transition-all @[560px]:hover:h-2 touch-none"
                aria-label="Video scrubber"
              />
              <span className="@[560px]:hidden font-mono text-[10px] text-[#A0A0A0] tabular-nums shrink-0">
                {formatTime(duration)}
              </span>
            </div>

            {/* Controls Strip */}
            <div className="flex items-center justify-between gap-1 text-white text-xs pt-0.5 @[560px]:pt-1 min-w-0">
              {/* Left Controls: Play, 10s Seek, Prev/Next Ep, Volume, Time */}
              <div className="flex items-center gap-0.5 @[560px]:gap-2.5 @[768px]:gap-4 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    togglePlay();
                    scheduleHideControls();
                  }}
                  className="p-1.5 min-w-[28px] min-h-[28px] @[560px]:min-w-0 @[560px]:min-h-0 flex items-center justify-center hover:text-[#A0A0A0] transition-colors cursor-pointer touch-manipulation"
                  title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause className="w-[17px] h-[17px] @[560px]:w-5 @[560px]:h-5" fill="currentColor" />
                  ) : (
                    <Play className="w-[17px] h-[17px] @[560px]:w-5 @[560px]:h-5" fill="currentColor" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleSeekRelative(-10);
                    scheduleHideControls();
                  }}
                  className="p-1.5 min-w-[28px] min-h-[28px] @[560px]:min-w-0 @[560px]:min-h-0 flex items-center justify-center hover:text-[#A0A0A0] transition-colors cursor-pointer touch-manipulation"
                  title="Seek backward 10s (Left Arrow)"
                  aria-label="Seek backward 10s"
                >
                  <RotateCcw className="w-4 h-4 @[560px]:w-[18px] @[560px]:h-[18px]" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handleSeekRelative(10);
                    scheduleHideControls();
                  }}
                  className="p-1.5 min-w-[28px] min-h-[28px] @[560px]:min-w-0 @[560px]:min-h-0 flex items-center justify-center hover:text-[#A0A0A0] transition-colors cursor-pointer touch-manipulation"
                  title="Seek forward 10s (Right Arrow)"
                  aria-label="Seek forward 10s"
                >
                  <RotateCw className="w-4 h-4 @[560px]:w-[18px] @[560px]:h-[18px]" />
                </button>

                {/* Prev / Next Episode Buttons (shown when >= 560px container width; below-player buttons always remain accessible) */}
                <button
                  type="button"
                  onClick={() => onNavigateEpisode(episodeNumber - 1)}
                  disabled={episodeNumber <= 1}
                  className="hidden @[560px]:inline-flex p-1.5 items-center justify-center hover:text-[#A0A0A0] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer touch-manipulation"
                  title="Previous episode"
                  aria-label="Previous episode"
                >
                  <SkipBack className="w-4 h-4 @[560px]:w-[18px] @[560px]:h-[18px]" />
                </button>

                <button
                  type="button"
                  onClick={() => onNavigateEpisode(episodeNumber + 1)}
                  disabled={episodeNumber >= totalEpisodes}
                  className="hidden @[560px]:inline-flex p-1.5 items-center justify-center hover:text-[#A0A0A0] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer touch-manipulation"
                  title="Next episode (N)"
                  aria-label="Next episode"
                >
                  <SkipForward className="w-4 h-4 @[560px]:w-[18px] @[560px]:h-[18px]" />
                </button>

                {/* Volume & Slider */}
                <div className="flex items-center gap-1.5 group/vol">
                  <button
                    type="button"
                    onClick={() => {
                      toggleMute();
                      scheduleHideControls();
                    }}
                    className="p-1.5 min-w-[28px] min-h-[28px] @[560px]:min-w-0 @[560px]:min-h-0 flex items-center justify-center hover:text-[#A0A0A0] transition-colors cursor-pointer touch-manipulation"
                    title="Mute (M)"
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX className="w-4 h-4 @[560px]:w-[19px] @[560px]:h-[19px]" />
                    ) : (
                      <Volume2 className="w-4 h-4 @[560px]:w-[19px] @[560px]:h-[19px]" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="w-16 h-1 bg-[#292929] accent-white rounded cursor-pointer hidden @[560px]:block"
                    aria-label="Volume slider"
                  />
                </div>

                {/* Wide Container Inline Time display */}
                <div className="hidden @[560px]:flex font-mono text-[11px] text-[#A0A0A0] tracking-tight ml-1">
                  <span className="text-white">{formatTime(currentTime)}</span>
                  <span className="mx-1 text-[#707070]">/</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Right Controls: Subtitles, Quality Selector, Settings, Fullscreen */}
              <div className="flex items-center gap-0.5 @[560px]:gap-2 @[768px]:gap-3 relative shrink-0">
                {/* Subtitles Button & Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    data-testid="subtitle-menu-button"
                    onClick={() => {
                      setShowSubtitleMenu((prev) => !prev);
                      setShowSettingsMenu(false);
                      setShowQualityMenu(false);
                      setShowDownloadPanel(false);
                    }}
                    className={`p-1.5 min-w-[28px] min-h-[28px] @[560px]:min-w-0 @[560px]:min-h-0 flex items-center justify-center transition-colors cursor-pointer touch-manipulation ${
                      !areSubtitlesOff
                        ? 'text-white'
                        : 'text-[#707070] hover:text-white'
                    }`}
                    title="Subtitles & Customization"
                    aria-label="Subtitles"
                  >
                    <Subtitles className="w-4 h-4 @[560px]:w-[18px] @[560px]:h-[18px]" />
                  </button>

                  {showSubtitleMenu && (
                    <>
                      {!isFullscreen && (
                        <div
                          className="fixed inset-0 z-40 bg-black/50 sm:hidden"
                          onClick={() => setShowSubtitleMenu(false)}
                        />
                      )}
                      <div
                        data-testid="subtitle-menu-dropdown"
                        className={`overflow-y-auto overscroll-contain bg-[#141414] border border-[#292929] rounded-xl shadow-2xl p-2 z-50 text-xs ${
                          isFullscreen
                            ? 'absolute bottom-full right-0 mb-2 w-56 max-w-[calc(100vw-2rem)] max-h-[65vh]'
                            : 'fixed inset-x-3 bottom-3 max-h-[58dvh] w-auto sm:inset-auto sm:absolute sm:bottom-full sm:right-0 sm:mb-2 sm:w-56 sm:max-h-44 lg:max-h-72 [@media(orientation:landscape)_and_(max-height:500px)]:fixed [@media(orientation:landscape)_and_(max-height:500px)]:inset-auto [@media(orientation:landscape)_and_(max-height:500px)]:right-3 [@media(orientation:landscape)_and_(max-height:500px)]:bottom-3 [@media(orientation:landscape)_and_(max-height:500px)]:w-60 [@media(orientation:landscape)_and_(max-height:500px)]:max-h-[68dvh]'
                        }`}
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
                    </>
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
                        setShowDownloadPanel(false);
                      }}
                      className="px-1.5 @[560px]:px-2 py-1 min-h-[26px] @[560px]:min-h-0 rounded-md bg-[#141414]/90 border border-[#292929] text-[10px] @[560px]:text-[11px] font-mono text-white hover:border-white/60 transition-colors flex items-center gap-1 cursor-pointer touch-manipulation"
                      title="Video Quality"
                      aria-label="Video Quality"
                    >
                      <Layers size={13} className="hidden @[340px]:block text-[#A0A0A0]" />
                      <span>
                        {selectedQualityLabel ||
                          availableQualities[0]?.quality ||
                          'Auto'}
                      </span>
                    </button>

                    {showQualityMenu && (
                      <>
                        {!isFullscreen && (
                          <div
                            className="fixed inset-0 z-40 bg-black/50 sm:hidden"
                            onClick={() => setShowQualityMenu(false)}
                          />
                        )}
                        <div
                          data-testid="quality-menu-dropdown"
                          className={`overflow-y-auto overscroll-contain bg-[#141414] border border-[#292929] rounded-xl shadow-2xl p-2 z-50 text-xs ${
                            isFullscreen
                              ? 'absolute bottom-full right-0 mb-2 w-44 max-w-[calc(100vw-2rem)] max-h-[65vh]'
                              : 'fixed inset-x-3 bottom-3 max-h-[58dvh] w-auto sm:inset-auto sm:absolute sm:bottom-full sm:right-0 sm:mb-2 sm:w-44 sm:max-h-44 lg:max-h-72 [@media(orientation:landscape)_and_(max-height:500px)]:fixed [@media(orientation:landscape)_and_(max-height:500px)]:inset-auto [@media(orientation:landscape)_and_(max-height:500px)]:right-3 [@media(orientation:landscape)_and_(max-height:500px)]:bottom-3 [@media(orientation:landscape)_and_(max-height:500px)]:w-52 [@media(orientation:landscape)_and_(max-height:500px)]:max-h-[68dvh]'
                          }`}
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
                      </>
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
                      setShowDownloadPanel(false);
                    }}
                    className="p-1.5 min-w-[28px] min-h-[28px] @[560px]:min-w-0 @[560px]:min-h-0 flex items-center justify-center text-[#A0A0A0] hover:text-white transition-colors cursor-pointer touch-manipulation"
                    title="Quality, Speed & Settings"
                    aria-label="Playback Settings"
                  >
                    <SettingsIcon className="w-4 h-4 @[560px]:w-[18px] @[560px]:h-[18px]" />
                  </button>

                  {showSettingsMenu && (
                    <>
                      {!isFullscreen && (
                        <div
                          className="fixed inset-0 z-40 bg-black/50 sm:hidden"
                          onClick={() => setShowSettingsMenu(false)}
                        />
                      )}
                      <div
                        data-testid="settings-menu-dropdown"
                        className={`overflow-y-auto overscroll-contain bg-[#141414] border border-[#292929] rounded-xl shadow-2xl p-2 z-50 text-xs ${
                          isFullscreen
                            ? 'absolute bottom-full right-0 mb-2 w-52 max-w-[calc(100vw-2rem)] max-h-[65vh]'
                            : 'fixed inset-x-3 bottom-3 max-h-[58dvh] w-auto sm:inset-auto sm:absolute sm:bottom-full sm:right-0 sm:mb-2 sm:w-52 sm:max-h-44 lg:max-h-80 [@media(orientation:landscape)_and_(max-height:500px)]:fixed [@media(orientation:landscape)_and_(max-height:500px)]:inset-auto [@media(orientation:landscape)_and_(max-height:500px)]:right-3 [@media(orientation:landscape)_and_(max-height:500px)]:bottom-3 [@media(orientation:landscape)_and_(max-height:500px)]:w-60 [@media(orientation:landscape)_and_(max-height:500px)]:max-h-[68dvh]'
                        }`}
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
                    </>
                  )}
                </div>

                {/* Compact Episode MP4 Download Control & Panel */}
                <div className="relative">
                  <button
                    type="button"
                    data-testid="player-download-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDownloadPanel((prev) => !prev);
                      setShowSubtitleMenu(false);
                      setShowQualityMenu(false);
                      setShowSettingsMenu(false);
                    }}
                    className={`p-1.5 min-w-[28px] min-h-[28px] @[560px]:min-w-0 @[560px]:min-h-0 flex items-center justify-center transition-colors cursor-pointer touch-manipulation ${
                      showDownloadPanel || isDownloadingEpisode
                        ? 'text-white'
                        : 'text-[#A0A0A0] hover:text-white'
                    }`}
                    title="Download Episode (MP4)"
                    aria-label="Download Episode"
                    aria-expanded={showDownloadPanel}
                  >
                    {isDownloadingEpisode ? (
                      <Loader2 className="w-4 h-4 @[560px]:w-[18px] @[560px]:h-[18px] animate-spin text-white" />
                    ) : (
                      <Download className="w-4 h-4 @[560px]:w-[18px] @[560px]:h-[18px]" />
                    )}
                  </button>

                  <PlayerDownloadPanel
                    isOpen={showDownloadPanel}
                    isFullscreen={isFullscreen}
                    onClose={() => setShowDownloadPanel(false)}
                    animeId={animeId}
                    anilistId={anilistId}
                    animeTitle={animeTitle}
                    animeFormat={animeFormat}
                    isStandaloneMovie={isStandaloneMovie}
                    episodeNumber={episodeNumber}
                    activeType={activeType}
                    hasSub={hasSub}
                    hasDub={hasDub}
                    isLoadingAvailability={isLoadingAvailability}
                    activeStream={streamData}
                    subStream={subStream}
                    dubStream={dubStream}
                    selectedPlayerQualityLabel={selectedQualityLabel}
                    onActiveDownloadChange={setIsDownloadingEpisode}
                  />
                </div>

                {/* Fullscreen Button */}
                <button
                  type="button"
                  data-testid="fullscreen-button"
                  onClick={toggleFullscreen}
                  className="p-1.5 min-w-[28px] min-h-[28px] @[560px]:min-w-0 @[560px]:min-h-0 flex items-center justify-center hover:text-[#A0A0A0] transition-colors cursor-pointer touch-manipulation"
                  title="Fullscreen (F)"
                  aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                >
                  {isFullscreen ? (
                    <Minimize className="w-4 h-4 @[560px]:w-[18px] @[560px]:h-[18px]" />
                  ) : (
                    <Maximize className="w-4 h-4 @[560px]:w-[18px] @[560px]:h-[18px]" />
                  )}
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
