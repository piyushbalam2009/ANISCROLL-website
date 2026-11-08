'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  Server,
  Layers,
  Loader2,
  Check,
  AlertCircle,
  ExternalLink,
  Sliders,
} from 'lucide-react';
import {
  AniScrollStreamResponse,
  AniSkipResult,
  SubtitleTrack,
  SubtitlePreferences,
  ParsedSubtitleCue,
} from '@/types/streaming';
import {
  saveWatchProgress,
  getSavedProgress,
  getUserPreferences,
  getSubtitlePreferences,
  saveSubtitlePreferences,
  resetSubtitlePreferences,
  DEFAULT_SUBTITLE_PREFERENCES,
} from '@/lib/storage';
import { parseSubtitles } from '@/lib/subtitle-parser';
import { SubtitleOverlay } from './SubtitleOverlay';
import { SubtitleSettingsModal } from './SubtitleSettingsModal';

interface VideoPlayerProps {
  animeId: number;
  animeTitle: string;
  episodeNumber: number;
  episodeTitle?: string;
  totalEpisodes?: number;
  malId?: number | null;
  streamData?: AniScrollStreamResponse | null;
  isLoadingStream?: boolean;
  streamError?: string | null;
  activeType: 'sub' | 'dub';
  onChangeType: (type: 'sub' | 'dub') => void;
  onNavigateEpisode: (episode: number) => void;
}

export function VideoPlayer({
  animeId,
  animeTitle,
  episodeNumber,
  episodeTitle,
  totalEpisodes = 1,
  malId,
  streamData,
  isLoadingStream = false,
  streamError = null,
  activeType,
  onChangeType,
  onNavigateEpisode,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideControlsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastProgressSaveRef = useRef<number>(0);

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
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
  const [showServerMenu, setShowServerMenu] = useState(false);
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>('none');
  const [selectedServer, setSelectedServer] = useState<string>('MegaPlay Direct');

  // Subtitle Customization & Parsed Cues
  const [subtitlePrefs, setSubtitlePrefs] = useState<SubtitlePreferences>(DEFAULT_SUBTITLE_PREFERENCES);
  const [parsedCues, setParsedCues] = useState<ParsedSubtitleCue[]>([]);
  const [isLoadingSubtitles, setIsLoadingSubtitles] = useState(false);

  // AniSkip states
  const [skipIntervals, setSkipIntervals] = useState<AniSkipResult[]>([]);
  const [currentSkip, setCurrentSkip] = useState<AniSkipResult | null>(null);
  const [autoSkipIntro, setAutoSkipIntro] = useState(false);
  const [autoSkipOutro, setAutoSkipOutro] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(true);

  // Resume toast
  const [resumePrompt, setResumePrompt] = useState<{ time: number } | null>(null);

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

  // Fetch AniSkip timestamps when malId is available
  useEffect(() => {
    if (!malId) return;

    let isMounted = true;
    async function fetchSkips() {
      try {
        const res = await fetch(
          `/api/skips?malId=${malId}&episode=${episodeNumber}&duration=${duration || 1440}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && data.found && Array.isArray(data.results)) {
          setSkipIntervals(data.results);
        }
      } catch (err) {
        console.error('Failed to load skips:', err);
      }
    }

    fetchSkips();
    return () => {
      isMounted = false;
    };
  }, [malId, episodeNumber, duration]);

  // Load HLS Stream
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamData) return;

    // Determine stream URL: prefer hlsProxyUrl, fallback to m3u8
    const streamUrl = streamData.hlsProxyUrl || streamData.m3u8;

    if (!streamUrl) {
      return;
    }

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });

      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Check saved progress
        const savedTime = getSavedProgress(animeId, episodeNumber);
        if (savedTime > 15) {
          setResumePrompt({ time: savedTime });
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('HLS Network Error, attempting recovery...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('HLS Media Error, attempting recovery...');
              hls.recoverMediaError();
              break;
            default:
              console.error('Fatal HLS error, destroying instance:', data);
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari HLS
      video.src = streamUrl;
      const savedTime = getSavedProgress(animeId, episodeNumber);
      if (savedTime > 15) {
        setResumePrompt({ time: savedTime });
      }
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamData, animeId, episodeNumber]);

  // Handle Video Time Updates & AniSkip triggers
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    const time = video.currentTime;
    setCurrentTime(time);

    // Throttled progress save (every 5 seconds)
    const now = Date.now();
    if (now - lastProgressSaveRef.current > 5000 && video.duration > 0) {
      lastProgressSaveRef.current = now;
      saveWatchProgress({
        hoshikaId: animeId,
        title: animeTitle,
        episodeNumber,
        episodeTitle,
        currentTime: time,
        duration: video.duration,
        completed: time / video.duration > 0.9,
      });
    }

    // Check for active Skip Intervals (OP / ED)
    const activeInterval = skipIntervals.find(
      (s) => time >= s.interval.startTime && time <= s.interval.endTime
    );

    if (activeInterval) {
      if (
        (activeInterval.skipType.includes('op') && autoSkipIntro) ||
        (activeInterval.skipType.includes('ed') && autoSkipOutro)
      ) {
        // Auto-skip
        video.currentTime = activeInterval.interval.endTime;
        setCurrentSkip(null);
      } else {
        setCurrentSkip(activeInterval);
      }
    } else {
      setCurrentSkip(null);
    }
  };

  // Perform Skip action
  const handlePerformSkip = () => {
    const video = videoRef.current;
    if (!video || !currentSkip) return;
    video.currentTime = currentSkip.interval.endTime;
    setCurrentSkip(null);
  };

  // Play / Pause toggle
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  // Seek forward / backward
  const handleSeekRelative = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + seconds));
  };

  // Progress bar scrub
  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const newTime = parseFloat(e.target.value);
    video.currentTime = newTime;
    setCurrentTime(newTime);
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

  // Fetch and parse WebVTT / SRT subtitle content
  const loadSubtitleContent = useCallback(async (subUrl: string) => {
    if (!subUrl || subUrl === 'none') {
      setParsedCues([]);
      return;
    }

    setIsLoadingSubtitles(true);
    try {
      let text = '';
      // Try direct fetch first
      try {
        const directRes = await fetch(subUrl);
        if (directRes.ok) {
          text = await directRes.text();
        }
      } catch {
        // Direct fetch blocked by CORS or network
      }

      // If direct fetch didn't return text or was blocked, proxy via server route
      if (!text || !text.includes('-->')) {
        const proxyRes = await fetch(`/api/subtitles?url=${encodeURIComponent(subUrl)}`);
        if (proxyRes.ok) {
          text = await proxyRes.text();
        }
      }

      if (text) {
        const cues = parseSubtitles(text);
        setParsedCues(cues);
      }
    } catch (err) {
      console.error('Failed to parse subtitle:', err);
    } finally {
      setIsLoadingSubtitles(false);
    }
  }, []);

  // Subtitle Selection
  const changeSubtitle = useCallback(
    (subUrl: string) => {
      const video = videoRef.current;
      setSelectedSubtitle(subUrl);
      setShowSubtitleMenu(false);

      if (!video) return;

      // Remove old tracks
      const existingTracks = video.querySelectorAll('track');
      existingTracks.forEach((t) => t.remove());

      if (subUrl !== 'none') {
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.src = subUrl;
        track.srclang = 'en';
        track.label = 'Selected';
        track.default = true;
        video.appendChild(track);
        if (track.track) {
          track.track.mode = 'hidden';
        }
        loadSubtitleContent(subUrl);
      } else {
        setParsedCues([]);
      }
    },
    [loadSubtitleContent]
  );

  // Auto-select subtitle on track load if available
  useEffect(() => {
    if (streamData?.subtitles && streamData.subtitles.length > 0) {
      const defaultSub =
        streamData.subtitles.find((s) => s.default) ||
        streamData.subtitles.find((s) => s.lang.toLowerCase().includes('en')) ||
        streamData.subtitles[0];

      if (defaultSub && selectedSubtitle === 'none') {
        changeSubtitle(defaultSub.url);
      }
    }
  }, [streamData?.subtitles, selectedSubtitle, changeSubtitle]);

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
      if (isPlaying && !showSettingsMenu && !showSubtitleMenu && !showServerMenu) {
        setShowControls(false);
      }
    }, 2500);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
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
  }, [togglePlay, toggleMute, episodeNumber, totalEpisodes, onNavigateEpisode]);

  // Video ended -> Auto next episode
  const handleVideoEnded = () => {
    setIsPlaying(false);
    if (autoPlayNext && episodeNumber < totalEpisodes) {
      onNavigateEpisode(episodeNumber + 1);
    }
  };

  // Time formatter (mm:ss or hh:mm:ss)
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

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden border border-[#292929] select-none group"
    >
      {/* HTML5 Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain cursor-pointer"
        onClick={togglePlay}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration);
          }
        }}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onEnded={handleVideoEnded}
        playsInline
        crossOrigin="anonymous"
      />

      {/* Loading Stream or Buffering Spinner */}
      {(isLoadingStream || isBuffering) && !streamError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 pointer-events-none z-20">
          <Loader2 size={44} className="text-white animate-spin mb-2" />
          <p className="text-xs text-[#A0A0A0] font-medium tracking-wider uppercase">
            {isLoadingStream ? 'Loading Video Stream...' : 'Buffering...'}
          </p>
        </div>
      )}

      {/* Playback Error State */}
      {streamError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0A0A0A] p-6 text-center z-30">
          <AlertCircle size={40} className="text-[#A0A0A0] mb-3" />
          <h3 className="text-base font-semibold text-white mb-1">
            Playback Unavailable
          </h3>
          <p className="text-xs text-[#A0A0A0] max-w-md mb-4">
            {streamError}
          </p>

          <div className="flex items-center gap-3">
            {/* Try Dub if Sub failed or vice versa */}
            <button
              onClick={() => onChangeType(activeType === 'sub' ? 'dub' : 'sub')}
              className="px-4 py-2 rounded-lg bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-colors"
            >
              Switch to {activeType === 'sub' ? 'Dub' : 'Sub'}
            </button>

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

      {/* Minimalist AniSkip Button (Section 8: Right side, subtle white border, no green) */}
      {currentSkip && (
        <div className="absolute right-6 bottom-24 z-30 animate-fadeIn">
          <button
            onClick={handlePerformSkip}
            className="px-4 py-2 rounded-lg bg-black/60 hover:bg-black/90 border border-white/60 hover:border-white text-white text-xs font-medium tracking-wide shadow-2xl backdrop-blur-md transition-all flex items-center gap-2 active:scale-95"
          >
            <span>
              {currentSkip.skipType.includes('op')
                ? 'Skip Intro'
                : currentSkip.skipType.includes('ed')
                ? 'Skip Outro'
                : 'Skip Recap'}
            </span>
            <SkipForward size={14} />
          </button>
        </div>
      )}

      {/* Custom Subtitle Overlay (Visible in normal & fullscreen) */}
      {selectedSubtitle !== 'none' && (
        <SubtitleOverlay
          currentTime={currentTime}
          cues={parsedCues}
          preferences={subtitlePrefs}
          showControls={showControls}
          isFullscreen={isFullscreen}
        />
      )}

      {/* Player Overlays & Controls Bar */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 flex flex-col justify-between ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Top Bar: Title & Status */}
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

          {/* Sub / Dub Selector Pill */}
          <div className="flex items-center bg-[#141414]/90 border border-[#292929] rounded-lg p-0.5">
            <button
              onClick={() => onChangeType('sub')}
              className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                activeType === 'sub'
                  ? 'bg-white text-black font-semibold'
                  : 'text-[#A0A0A0] hover:text-white'
              }`}
            >
              SUB
            </button>
            <button
              onClick={() => onChangeType('dub')}
              className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                activeType === 'dub'
                  ? 'bg-white text-black font-semibold'
                  : 'text-[#A0A0A0] hover:text-white'
              }`}
            >
              DUB
            </button>
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
                className="p-1.5 hover:text-[#A0A0A0] transition-colors"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
              </button>

              <button
                onClick={() => handleSeekRelative(-10)}
                className="p-1.5 hover:text-[#A0A0A0] transition-colors"
                title="Seek backward 10s (Left Arrow)"
                aria-label="Seek backward 10s"
              >
                <RotateCcw size={18} />
              </button>

              <button
                onClick={() => handleSeekRelative(10)}
                className="p-1.5 hover:text-[#A0A0A0] transition-colors"
                title="Seek forward 10s (Right Arrow)"
                aria-label="Seek forward 10s"
              >
                <RotateCw size={18} />
              </button>

              {/* Prev / Next Episode Buttons */}
              <button
                onClick={() => onNavigateEpisode(episodeNumber - 1)}
                disabled={episodeNumber <= 1}
                className="p-1.5 hover:text-[#A0A0A0] disabled:opacity-30 disabled:pointer-events-none transition-colors"
                title="Previous episode"
                aria-label="Previous episode"
              >
                <SkipBack size={18} />
              </button>

              <button
                onClick={() => onNavigateEpisode(episodeNumber + 1)}
                disabled={episodeNumber >= totalEpisodes}
                className="p-1.5 hover:text-[#A0A0A0] disabled:opacity-30 disabled:pointer-events-none transition-colors"
                title="Next episode (N)"
                aria-label="Next episode"
              >
                <SkipForward size={18} />
              </button>

              {/* Volume & Slider */}
              <div className="flex items-center gap-1.5 group/vol">
                <button
                  onClick={toggleMute}
                  className="p-1.5 hover:text-[#A0A0A0] transition-colors"
                  title="Mute (M)"
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}
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

            {/* Right Controls: Subtitles, Server, Speed, Fullscreen */}
            <div className="flex items-center gap-2 sm:gap-3 relative">
              {/* Subtitles Button & Dropdown */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowSubtitleMenu((prev) => !prev);
                    setShowSettingsMenu(false);
                    setShowServerMenu(false);
                  }}
                  className={`p-1.5 transition-colors cursor-pointer ${
                    selectedSubtitle !== 'none' ? 'text-white' : 'text-[#707070] hover:text-white'
                  }`}
                  title="Subtitles & Customization"
                  aria-label="Subtitles"
                >
                  <Subtitles size={18} />
                </button>

                {showSubtitleMenu && (
                  <div className="absolute bottom-full right-0 mb-2 w-52 bg-[#141414] border border-[#292929] rounded-xl shadow-xl p-2 z-50 text-xs">
                    <div className="px-2 py-1 text-[10px] uppercase font-semibold text-[#707070] tracking-wider flex items-center justify-between">
                      <span>Subtitles</span>
                      {isLoadingSubtitles && <Loader2 size={11} className="animate-spin text-white" />}
                    </div>
                    <button
                      onClick={() => changeSubtitle('none')}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1B1B1B] flex items-center justify-between cursor-pointer"
                    >
                      <span>Off</span>
                      {selectedSubtitle === 'none' && <Check size={13} />}
                    </button>
                    {streamData?.subtitles && streamData.subtitles.length > 0 ? (
                      streamData.subtitles.map((sub, sIdx) => (
                        <button
                          key={sIdx}
                          onClick={() => changeSubtitle(sub.url)}
                          className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1B1B1B] flex items-center justify-between truncate cursor-pointer"
                        >
                          <span className="truncate">{sub.lang}</span>
                          {selectedSubtitle === sub.url && <Check size={13} className="shrink-0" />}
                        </button>
                      ))
                    ) : (
                      <div className="px-2 py-1 text-[11px] text-[#707070] italic">
                        No external tracks detected
                      </div>
                    )}

                    <div className="mt-1.5 pt-1.5 border-t border-[#292929]">
                      <button
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

              {/* Server Selector */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowServerMenu((prev) => !prev);
                    setShowSettingsMenu(false);
                    setShowSubtitleMenu(false);
                  }}
                  className="p-1.5 text-[#A0A0A0] hover:text-white transition-colors"
                  title="Streaming Servers"
                  aria-label="Streaming Servers"
                >
                  <Server size={18} />
                </button>

                {showServerMenu && (
                  <div className="absolute bottom-full right-0 mb-2 w-44 bg-[#141414] border border-[#292929] rounded-xl shadow-xl p-2 z-50 text-xs">
                    <div className="px-2 py-1 text-[10px] uppercase font-semibold text-[#707070] tracking-wider">
                      Streaming Server
                    </div>
                    {(streamData?.availableServers || ['MegaPlay Direct']).map((srv, srvIdx) => (
                      <button
                        key={srvIdx}
                        onClick={() => {
                          setSelectedServer(srv);
                          setShowServerMenu(false);
                        }}
                        className="w-full text-left px-2 py-1.5 rounded hover:bg-[#1B1B1B] flex items-center justify-between"
                      >
                        <span>{srv}</span>
                        {selectedServer === srv && <Check size={13} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Speed / Settings Button & Dropdown */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowSettingsMenu((prev) => !prev);
                    setShowSubtitleMenu(false);
                    setShowServerMenu(false);
                  }}
                  className="p-1.5 text-[#A0A0A0] hover:text-white transition-colors cursor-pointer"
                  title="Playback Speed & Settings"
                  aria-label="Playback Settings"
                >
                  <SettingsIcon size={18} />
                </button>

                {showSettingsMenu && (
                  <div className="absolute bottom-full right-0 mb-2 w-48 bg-[#141414] border border-[#292929] rounded-xl shadow-xl p-2 z-50 text-xs">
                    {/* Dedicated Subtitle Settings Option */}
                    <div className="px-2 py-1 text-[10px] uppercase font-semibold text-[#707070] tracking-wider">
                      Subtitles
                    </div>
                    <button
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
