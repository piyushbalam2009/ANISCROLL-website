'use client';

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  Download,
  X,
  Loader2,
  Check,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import type { AniScrollStreamResponse, StreamingProvider } from '@/types/streaming';
import {
  downloadHlsToMp4,
  formatBytes,
  formatTransferSpeed,
  HlsDownloadError,
  resolveDownloadQualitiesFromStream,
  sanitizeDownloadFilename,
  type DownloadAudioVersion,
  type DownloadProgressState,
  type DownloadQualityOption,
} from '@/lib/hls-downloader';
import {
  getStreamingProviderDisplayName,
  selectStreamingProvider,
} from '@/lib/stream-provider-core';

interface PlayerDownloadPanelProps {
  isOpen: boolean;
  isFullscreen?: boolean;
  onClose: () => void;
  animeId: number;
  anilistId?: number | null;
  animeTitle: string;
  animeFormat?: string | null;
  isStandaloneMovie?: boolean;
  episodeNumber: number;
  activeType: 'sub' | 'dub';
  hasSub: boolean;
  hasDub: boolean;
  isLoadingAvailability?: boolean;
  activeStream?: AniScrollStreamResponse | null;
  subStream?: AniScrollStreamResponse | null;
  dubStream?: AniScrollStreamResponse | null;
  selectedPlayerQualityLabel?: string;
  onActiveDownloadChange?: (isActive: boolean) => void;
}

const INITIAL_PROGRESS: DownloadProgressState = {
  stage: 'idle',
  label: '',
  percent: null,
  downloadedBytes: 0,
  completedSegments: 0,
  totalSegments: 0,
  speedBytesPerSec: 0,
  estimatedTotalBytes: null,
  filename: null,
  error: null,
};

export function PlayerDownloadPanel({
  isOpen,
  isFullscreen = false,
  onClose,
  animeId,
  anilistId,
  animeTitle,
  animeFormat,
  isStandaloneMovie = false,
  episodeNumber,
  activeType,
  hasSub,
  hasDub,
  isLoadingAvailability = false,
  activeStream,
  subStream,
  dubStream,
  selectedPlayerQualityLabel,
  onActiveDownloadChange,
}: PlayerDownloadPanelProps) {
  const [selectedAudio, setSelectedAudio] = useState<DownloadAudioVersion>(() => {
    if (activeType === 'dub' && hasDub) return 'dub';
    if (activeType === 'sub' && hasSub) return 'sub';
    return hasSub ? 'sub' : hasDub ? 'dub' : activeType;
  });

  const [fetchedStreams, setFetchedStreams] = useState<{
    sub: AniScrollStreamResponse | null;
    dub: AniScrollStreamResponse | null;
  }>({ sub: null, dub: null });

  const [qualities, setQualities] = useState<DownloadQualityOption[]>([]);
  const [selectedQualityId, setSelectedQualityId] = useState<string>('');
  const [isInspectingQualities, setIsInspectingQualities] = useState<boolean>(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectRetryNonce, setInspectRetryNonce] = useState<number>(0);
  const [progress, setProgress] = useState<DownloadProgressState>(INITIAL_PROGRESS);

  const downloadAbortRef = useRef<AbortController | null>(null);
  const inspectAbortRef = useRef<AbortController | null>(null);
  const prevEpisodeKeyRef = useRef<string>(`${animeId}:${episodeNumber}`);
  const wasOpenRef = useRef<boolean>(false);

  const isDownloading =
    progress.stage === 'preparing' ||
    progress.stage === 'fetching_stream' ||
    progress.stage === 'downloading_segments' ||
    progress.stage === 'processing_mp4' ||
    progress.stage === 'saving';

  useEffect(() => {
    onActiveDownloadChange?.(isDownloading);
  }, [isDownloading, onActiveDownloadChange]);

  // Reset state cleanly whenever the active anime or episode changes
  useEffect(() => {
    const nextKey = `${animeId}:${episodeNumber}`;
    if (prevEpisodeKeyRef.current !== nextKey) {
      prevEpisodeKeyRef.current = nextKey;
      downloadAbortRef.current?.abort();
      downloadAbortRef.current = null;
      inspectAbortRef.current?.abort();
      inspectAbortRef.current = null;
      setFetchedStreams({ sub: null, dub: null });
      setQualities([]);
      setSelectedQualityId('');
      setInspectError(null);
      setProgress(INITIAL_PROGRESS);
    }
  }, [animeId, episodeNumber]);

  // Preselect active audio version when panel freshly opens in idle state
  useEffect(() => {
    if (isOpen && !wasOpenRef.current && !isDownloading && progress.stage === 'idle') {
      if (activeType === 'dub' && hasDub) {
        setSelectedAudio('dub');
      } else if (activeType === 'sub' && hasSub) {
        setSelectedAudio('sub');
      } else if (hasSub) {
        setSelectedAudio('sub');
      } else if (hasDub) {
        setSelectedAudio('dub');
      }
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, isDownloading, progress.stage, activeType, hasSub, hasDub]);

  // Abort any running workers/requests cleanly on unmount
  useEffect(() => {
    return () => {
      downloadAbortRef.current?.abort();
      inspectAbortRef.current?.abort();
    };
  }, []);

  const resolveStreamForAudio = useCallback(
    async (
      audio: DownloadAudioVersion,
      signal: AbortSignal
    ): Promise<AniScrollStreamResponse | null> => {
      if (audio === 'sub' && subStream && subStream.type === 'sub') return subStream;
      if (audio === 'dub' && dubStream && dubStream.type === 'dub') return dubStream;
      if (activeStream && activeStream.type === audio) return activeStream;
      if (fetchedStreams[audio] && fetchedStreams[audio]?.type === audio) {
        return fetchedStreams[audio];
      }

      if (!anilistId) return null;

      const formatQuery = animeFormat
        ? `&format=${encodeURIComponent(animeFormat)}`
        : '';
      const standaloneQuery = isStandaloneMovie ? '&standaloneMovie=true' : '';
      const res = await fetch(
        `/api/stream?anilistId=${anilistId}&episode=${episodeNumber}&hoshikaId=${animeId}${formatQuery}${standaloneQuery}&type=${audio}&preferredType=${audio}&checkBoth=false`,
        { signal, cache: 'no-store' }
      );
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        stream?: AniScrollStreamResponse | null;
        error?: string;
      } | null;

      if (!res.ok || !data?.ok || !data.stream) {
        throw new Error(
          data?.error ||
            `${audio.toUpperCase()} stream is currently unavailable for Episode ${episodeNumber}.`
        );
      }

      setFetchedStreams((prev) => ({
        ...prev,
        [audio]: data.stream ?? null,
      }));
      return data.stream;
    },
    [
      activeStream,
      animeFormat,
      animeId,
      anilistId,
      dubStream,
      episodeNumber,
      fetchedStreams,
      isStandaloneMovie,
      subStream,
    ]
  );

  // Inspect actual available qualities for the user-selected audio version when panel is open
  useEffect(() => {
    if (!isOpen || isLoadingAvailability || isDownloading) return;
    if (progress.stage === 'completed') return;

    const audioAvailable = selectedAudio === 'dub' ? hasDub : hasSub;
    if (!audioAvailable) {
      setQualities([]);
      setSelectedQualityId('');
      setInspectError(
        `${selectedAudio === 'dub' ? 'Dub' : 'Sub'} is not available for Episode ${episodeNumber}.`
      );
      return;
    }

    inspectAbortRef.current?.abort();
    const controller = new AbortController();
    inspectAbortRef.current = controller;

    let isMounted = true;

    async function inspectQualities() {
      setIsInspectingQualities(true);
      setInspectError(null);
      setQualities([]);

      try {
        const stream = await resolveStreamForAudio(selectedAudio, controller.signal);
        if (!isMounted || controller.signal.aborted) return;

        const resolved = await resolveDownloadQualitiesFromStream(stream, {
          signal: controller.signal,
        });
        if (!isMounted || controller.signal.aborted) return;

        if (resolved.options.length === 0) {
          setQualities([]);
          setSelectedQualityId('');
          setInspectError(
            resolved.errorMessage ||
              'No downloadable qualities were found for this audio stream.'
          );
          return;
        }

        setQualities(resolved.options);

        // Prefer matching player quality if available, else highest parsed option
        const matchedPlayerQuality = selectedPlayerQualityLabel
          ? resolved.options.find(
              (opt) =>
                opt.label.toLowerCase() === selectedPlayerQualityLabel.toLowerCase()
            )
          : undefined;
        setSelectedQualityId(
          matchedPlayerQuality ? matchedPlayerQuality.id : resolved.options[0].id
        );
      } catch (err: unknown) {
        if (!isMounted || (err as { name?: string })?.name === 'AbortError') return;
        setQualities([]);
        setSelectedQualityId('');
        setInspectError(
          err instanceof Error
            ? err.message
            : 'Unable to inspect downloadable qualities for this stream.'
        );
      } finally {
        if (isMounted && !controller.signal.aborted) {
          setIsInspectingQualities(false);
        }
      }
    }

    inspectQualities();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [
    isOpen,
    isLoadingAvailability,
    isDownloading,
    progress.stage,
    selectedAudio,
    hasSub,
    hasDub,
    episodeNumber,
    inspectRetryNonce,
    resolveStreamForAudio,
    selectedPlayerQualityLabel,
  ]);

  const selectedQuality = useMemo(
    () => qualities.find((q) => q.id === selectedQualityId) || qualities[0] || null,
    [qualities, selectedQualityId]
  );

  const previewFilename = useMemo(() => {
    return sanitizeDownloadFilename({
      animeTitle,
      episodeNumber,
      qualityLabel: selectedQuality?.label || 'Source',
      audioType: selectedAudio,
    });
  }, [animeTitle, episodeNumber, selectedQuality?.label, selectedAudio]);

  const effectiveStreamForMeta =
    (selectedAudio === 'dub' ? dubStream || fetchedStreams.dub : subStream || fetchedStreams.sub) ||
    (activeStream?.type === selectedAudio ? activeStream : null);

  const providerName: StreamingProvider | null =
    effectiveStreamForMeta?.provider === 'megaplay' ||
    effectiveStreamForMeta?.source === 'megaplay'
      ? 'megaplay'
      : effectiveStreamForMeta?.provider === 'zokoanime' ||
        effectiveStreamForMeta?.source === 'zokoanime'
      ? 'zokoanime'
      : selectStreamingProvider({ format: animeFormat, isStandaloneMovie });

  const providerLabel = providerName
    ? getStreamingProviderDisplayName(providerName)
    : 'Stream';

  const handleSelectAudio = (audio: DownloadAudioVersion) => {
    if (isDownloading) return;
    if (audio === 'sub' && !hasSub) return;
    if (audio === 'dub' && !hasDub) return;
    if (progress.stage !== 'idle') {
      setProgress(INITIAL_PROGRESS);
    }
    setSelectedAudio(audio);
  };

  const handleStartDownload = async () => {
    if (!selectedQuality || isDownloading) return;

    downloadAbortRef.current?.abort();
    const controller = new AbortController();
    downloadAbortRef.current = controller;

    try {
      await downloadHlsToMp4({
        animeTitle,
        episodeNumber,
        audioType: selectedAudio,
        quality: selectedQuality,
        provider: providerName || undefined,
        signal: controller.signal,
        onProgress: (nextState) => {
          setProgress(nextState);
        },
      });
    } catch (err: unknown) {
      if (
        controller.signal.aborted ||
        (err instanceof HlsDownloadError && err.code === 'ABORTED') ||
        (err as { name?: string })?.name === 'AbortError'
      ) {
        setProgress({
          ...INITIAL_PROGRESS,
          stage: 'cancelled',
          label: 'Download cancelled',
        });
        return;
      }

      setProgress((prev) => ({
        ...prev,
        stage: 'error',
        label: 'Download failed',
        error:
          err instanceof Error
            ? err.message
            : 'Unable to convert or download this episode stream.',
      }));
    } finally {
      if (downloadAbortRef.current === controller) {
        downloadAbortRef.current = null;
      }
    }
  };

  const handleCancelDownload = () => {
    downloadAbortRef.current?.abort();
    downloadAbortRef.current = null;
  };

  const handleResetToPicker = () => {
    setProgress(INITIAL_PROGRESS);
    setInspectRetryNonce((n) => n + 1);
  };

  if (!isOpen) return null;

  const isMovie = animeFormat?.toUpperCase() === 'MOVIE' || Boolean(isStandaloneMovie);

  return (
    <>
      {!isFullscreen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 sm:hidden"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        />
      )}

      <div
        role="dialog"
        aria-label="Download episode as MP4"
        data-testid="player-download-panel"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        className={`overflow-y-auto overscroll-contain bg-[#141414] border border-[#292929] rounded-xl shadow-2xl p-3.5 sm:p-4 z-50 text-xs text-white ${
          isFullscreen
            ? 'absolute bottom-full right-0 mb-2 w-80 sm:w-96 max-w-[calc(100vw-2rem)] max-h-[70vh]'
            : 'fixed inset-x-3 bottom-3 max-h-[78dvh] w-auto sm:inset-auto sm:absolute sm:bottom-full sm:right-0 sm:mb-2 sm:w-80 md:w-96 sm:max-h-[255px] md:max-h-[320px] lg:max-h-[390px] [@media(orientation:landscape)_and_(max-height:500px)]:fixed [@media(orientation:landscape)_and_(max-height:500px)]:inset-auto [@media(orientation:landscape)_and_(max-height:500px)]:right-3 [@media(orientation:landscape)_and_(max-height:500px)]:bottom-3 [@media(orientation:landscape)_and_(max-height:500px)]:w-80 [@media(orientation:landscape)_and_(max-height:500px)]:max-h-[82dvh]'
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-[#292929]">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Download size={13} className="text-white shrink-0" />
              <h4 className="text-xs font-semibold text-white">
                {isMovie ? 'Download Movie (MP4)' : 'Download Episode (MP4)'}
              </h4>
            </div>
            <p className="text-[11px] text-[#A0A0A0] truncate mt-0.5">
              {animeTitle} · Episode {episodeNumber} · {providerLabel}
            </p>
          </div>
          <button
            type="button"
            data-testid="download-panel-close"
            onClick={onClose}
            aria-label="Close download panel"
            className="p-1 rounded-md text-[#707070] hover:text-white hover:bg-[#1B1B1B] transition-colors cursor-pointer shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="pt-3 space-y-3">
          {isLoadingAvailability ? (
            <div className="py-4 flex items-center justify-center gap-2 text-[#A0A0A0]">
              <Loader2 size={14} className="animate-spin text-white" />
              <span>Checking available Sub/Dub streams...</span>
            </div>
          ) : !hasSub && !hasDub ? (
            <div
              data-testid="download-unavailable-message"
              className="p-3 rounded-lg bg-[#0A0A0A] border border-[#292929] text-[#A0A0A0] flex items-start gap-2"
            >
              <AlertCircle size={14} className="shrink-0 mt-0.5 text-[#A0A0A0]" />
              <span>
                No downloadable Sub or Dub stream is available for Episode {episodeNumber}.
              </span>
            </div>
          ) : (
            <>
              {/* Step 1: Select Audio */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-white">
                  Which audio version do you want to download?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="download-audio-sub"
                    disabled={!hasSub || isDownloading}
                    onClick={() => handleSelectAudio('sub')}
                    className={`px-3 py-2 rounded-lg border text-left transition-colors flex items-center justify-between ${
                      selectedAudio === 'sub' && hasSub
                        ? 'bg-white text-black border-white font-semibold'
                        : hasSub
                        ? 'bg-[#0A0A0A] text-white border-[#292929] hover:border-white/60 cursor-pointer'
                        : 'bg-[#0A0A0A] text-[#707070] border-[#292929] opacity-45 cursor-not-allowed'
                    } disabled:pointer-events-none`}
                  >
                    <div>
                      <span className="block text-xs">Sub</span>
                      <span
                        className={`block text-[10px] ${
                          selectedAudio === 'sub' && hasSub
                            ? 'text-neutral-700'
                            : 'text-[#707070]'
                        }`}
                      >
                        {hasSub ? 'Subtitled' : 'Unavailable'}
                      </span>
                    </div>
                    {selectedAudio === 'sub' && hasSub && <Check size={13} />}
                  </button>

                  <button
                    type="button"
                    data-testid="download-audio-dub"
                    disabled={!hasDub || isDownloading}
                    onClick={() => handleSelectAudio('dub')}
                    className={`px-3 py-2 rounded-lg border text-left transition-colors flex items-center justify-between ${
                      selectedAudio === 'dub' && hasDub
                        ? 'bg-white text-black border-white font-semibold'
                        : hasDub
                        ? 'bg-[#0A0A0A] text-white border-[#292929] hover:border-white/60 cursor-pointer'
                        : 'bg-[#0A0A0A] text-[#707070] border-[#292929] opacity-45 cursor-not-allowed'
                    } disabled:pointer-events-none`}
                  >
                    <div>
                      <span className="block text-xs">Dub</span>
                      <span
                        className={`block text-[10px] ${
                          selectedAudio === 'dub' && hasDub
                            ? 'text-neutral-700'
                            : 'text-[#707070]'
                        }`}
                      >
                        {hasDub ? 'English Audio' : 'Unavailable'}
                      </span>
                    </div>
                    {selectedAudio === 'dub' && hasDub && <Check size={13} />}
                  </button>
                </div>
              </div>

              {/* Step 2: Select Quality (shown when not completed or when user is configuring download) */}
              {progress.stage !== 'completed' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-medium text-[#A0A0A0]">
                      Video Quality
                    </p>
                    {isInspectingQualities && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-[#707070]">
                        <Loader2 size={11} className="animate-spin text-white" />
                        Inspecting...
                      </span>
                    )}
                  </div>

                  {isInspectingQualities ? (
                    <div className="py-2.5 px-3 rounded-lg bg-[#0A0A0A] border border-[#292929] text-[11px] text-[#A0A0A0] flex items-center gap-2">
                      <Loader2 size={13} className="animate-spin text-white shrink-0" />
                      <span>Checking available {selectedAudio.toUpperCase()} qualities...</span>
                    </div>
                  ) : inspectError ? (
                    <div
                      data-testid="download-inspect-error"
                      className="p-2.5 rounded-lg bg-[#0A0A0A] border border-[#292929] space-y-2"
                    >
                      <div className="flex items-start gap-2 text-[11px] text-[#A0A0A0]">
                        <AlertCircle size={13} className="shrink-0 mt-0.5 text-white" />
                        <span>{inspectError}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setInspectRetryNonce((n) => n + 1)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[#292929] hover:border-white text-[11px] text-white transition-colors cursor-pointer"
                      >
                        <RefreshCw size={11} />
                        <span>Retry</span>
                      </button>
                    </div>
                  ) : qualities.length > 0 ? (
                    <div
                      data-testid="download-quality-list"
                      className="flex flex-wrap gap-1.5"
                    >
                      {qualities.map((q) => {
                        const isSelected = selectedQuality?.id === q.id;
                        return (
                          <button
                            key={q.id}
                            type="button"
                            data-testid={`download-quality-${q.label}`}
                            disabled={isDownloading}
                            onClick={() => setSelectedQualityId(q.id)}
                            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-mono transition-colors ${
                              isSelected
                                ? 'bg-white text-black border-white font-semibold'
                                : 'bg-[#0A0A0A] text-white border-[#292929] hover:border-white/60 cursor-pointer'
                            } disabled:opacity-60 disabled:pointer-events-none`}
                          >
                            {q.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Step 3: Progress / Action / Completion / Error */}
              {isDownloading ? (
                <div
                  data-testid="download-progress-box"
                  className="p-2.5 rounded-lg bg-[#0A0A0A] border border-[#292929] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-white font-medium truncate">
                      {progress.label || 'Downloading...'}
                    </span>
                    {progress.percent !== null && (
                      <span className="font-mono text-white shrink-0">
                        {progress.percent}%
                      </span>
                    )}
                  </div>

                  <div className="w-full h-1.5 bg-[#292929] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white transition-all duration-200"
                      style={{
                        width:
                          progress.percent !== null
                            ? `${Math.max(2, Math.min(100, progress.percent))}%`
                            : '35%',
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-[#A0A0A0]">
                    <span>
                      {progress.downloadedBytes > 0
                        ? formatBytes(progress.downloadedBytes)
                        : 'Connecting...'}
                    </span>
                    <span>
                      {progress.speedBytesPerSec > 0
                        ? formatTransferSpeed(progress.speedBytesPerSec)
                        : progress.stage === 'processing_mp4'
                        ? 'Remuxing MP4'
                        : ''}
                    </span>
                  </div>

                  <button
                    type="button"
                    data-testid="download-cancel-button"
                    onClick={handleCancelDownload}
                    className="w-full py-1.5 rounded-lg border border-[#292929] hover:border-white text-[11px] font-medium text-white transition-colors cursor-pointer"
                  >
                    Cancel Download
                  </button>
                </div>
              ) : progress.stage === 'completed' ? (
                <div
                  data-testid="download-success-box"
                  className="p-2.5 rounded-lg bg-[#0A0A0A] border border-[#292929] space-y-2"
                >
                  <div className="flex items-start gap-2">
                    <CheckCircle2 size={15} className="text-white shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white">
                        MP4 Download Complete
                      </p>
                      <p
                        className="text-[10px] font-mono text-[#A0A0A0] truncate mt-0.5"
                        title={progress.filename || previewFilename}
                      >
                        {progress.filename || previewFilename}
                      </p>
                      {progress.downloadedBytes > 0 && (
                        <p className="text-[10px] font-mono text-[#707070] mt-0.5">
                          {formatBytes(progress.downloadedBytes)} · video/mp4
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="download-another-button"
                      onClick={handleResetToPicker}
                      className="flex-1 py-1.5 rounded-lg border border-[#292929] hover:border-white text-[11px] font-medium text-white transition-colors cursor-pointer"
                    >
                      Download Another
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-3 py-1.5 rounded-lg bg-white text-black text-[11px] font-semibold hover:bg-neutral-200 transition-colors cursor-pointer"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : progress.stage === 'error' ? (
                <div
                  data-testid="download-error-box"
                  className="p-2.5 rounded-lg bg-[#0A0A0A] border border-[#292929] space-y-2"
                >
                  <div className="flex items-start gap-2 text-[11px] text-[#A0A0A0]">
                    <AlertCircle size={14} className="text-white shrink-0 mt-0.5" />
                    <span>{progress.error || 'Download failed.'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="download-retry-button"
                      disabled={!selectedQuality}
                      onClick={handleStartDownload}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white text-black text-[11px] font-semibold hover:bg-neutral-200 disabled:opacity-40 transition-colors cursor-pointer"
                    >
                      <RefreshCw size={12} />
                      <span>Retry</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleResetToPicker}
                      className="px-3 py-1.5 rounded-lg border border-[#292929] hover:border-white text-[11px] text-white transition-colors cursor-pointer"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              ) : (
                selectedQuality &&
                !isInspectingQualities &&
                !inspectError && (
                  <div className="space-y-2 pt-0.5">
                    {progress.stage === 'cancelled' && (
                      <p
                        data-testid="download-cancelled-note"
                        className="text-[11px] text-[#A0A0A0]"
                      >
                        Previous download cancelled.
                      </p>
                    )}
                    <p
                      className="text-[10px] font-mono text-[#707070] truncate"
                      title={previewFilename}
                    >
                      File: {previewFilename}
                    </p>
                    <button
                      type="button"
                      data-testid="download-start-button"
                      onClick={handleStartDownload}
                      className="w-full py-2 px-3 rounded-lg bg-white text-black text-xs font-semibold hover:bg-neutral-200 active:scale-[0.99] transition-all flex items-center justify-center gap-1.5 cursor-pointer touch-manipulation"
                    >
                      <Download size={13} />
                      <span>
                        Download {selectedQuality.label} ({selectedAudio === 'dub' ? 'Dub' : 'Sub'}) MP4
                      </span>
                    </button>
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
