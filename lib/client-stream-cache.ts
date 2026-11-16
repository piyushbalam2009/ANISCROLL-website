import { AniScrollStreamResponse, StreamingProvider } from '@/types/streaming';
import { AudioMode, selectEpisodeAudioVersion } from './zokoanime-stream';

export interface CachedAudioStreamEntry {
  key: string;
  provider: StreamingProvider;
  anilistId: number;
  episode: number;
  type: AudioMode;
  available: boolean;
  stream: AniScrollStreamResponse | null;
  errorCode: string | null;
  cachedAt: number;
  expiresAt: number;
}

export interface CachedEpisodeAvailabilityEntry {
  subAvailable: boolean;
  dubAvailable: boolean;
  subErrorCode: string | null;
  dubErrorCode: string | null;
  cachedAt: number;
  expiresAt: number;
}

export interface ResolvedCachedEpisodeStreams {
  cacheHit: true;
  subAvailable: boolean;
  dubAvailable: boolean;
  subStream: AniScrollStreamResponse | null;
  dubStream: AniScrollStreamResponse | null;
  subErrorCode: string | null;
  dubErrorCode: string | null;
  chosenVersion: AudioMode | null;
  chosenStream: AniScrollStreamResponse | null;
}

const DEFAULT_CLIENT_STREAM_TTL_MS = 5 * 60 * 1000;

export function buildClientStreamCacheKey(
  provider: StreamingProvider,
  anilistId: number,
  episode: number,
  audioType: AudioMode
): string {
  return `${provider}:${anilistId}:${episode}:${audioType}`;
}

export function buildClientAvailabilityCacheKey(
  provider: StreamingProvider,
  anilistId: number,
  episode: number
): string {
  return `${provider}:${anilistId}:${episode}:availability`;
}

export function isValidCachedStreamForType(
  stream: AniScrollStreamResponse | null | undefined,
  expected: {
    provider: StreamingProvider;
    anilistId: number;
    episode: number;
    type: AudioMode;
  }
): stream is AniScrollStreamResponse {
  if (!stream || typeof stream !== 'object') return false;
  if (stream.type !== expected.type) return false;
  if (Number(stream.anilistId) !== Number(expected.anilistId)) return false;
  if (Number(stream.episode) !== Number(expected.episode)) return false;
  if (stream.provider && stream.provider !== expected.provider) return false;
  return true;
}

export class ClientEpisodeStreamCache {
  private streamMap = new Map<string, CachedAudioStreamEntry>();
  private availabilityMap = new Map<string, CachedEpisodeAvailabilityEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_CLIENT_STREAM_TTL_MS) {
    this.ttlMs = Math.max(1000, ttlMs);
  }

  setStream(params: {
    provider: StreamingProvider;
    anilistId: number;
    episode: number;
    type: AudioMode;
    available: boolean;
    stream: AniScrollStreamResponse | null;
    errorCode?: string | null;
    now?: number;
  }): boolean {
    const { provider, anilistId, episode, type, available, stream, errorCode = null } = params;
    const now = params.now ?? Date.now();
    const key = buildClientStreamCacheKey(provider, anilistId, episode, type);

    if (available || stream) {
      if (!isValidCachedStreamForType(stream, { provider, anilistId, episode, type })) {
        this.streamMap.delete(key);
        return false;
      }
      this.streamMap.set(key, {
        key,
        provider,
        anilistId,
        episode,
        type,
        available: true,
        stream,
        errorCode: null,
        cachedAt: now,
        expiresAt: now + this.ttlMs,
      });
      return true;
    }

    // Only record unavailability metadata when definitively unavailable ('not_found')
    if (errorCode === 'not_found') {
      this.streamMap.set(key, {
        key,
        provider,
        anilistId,
        episode,
        type,
        available: false,
        stream: null,
        errorCode: 'not_found',
        cachedAt: now,
        expiresAt: now + Math.min(this.ttlMs, 45_000),
      });
      return true;
    }

    this.streamMap.delete(key);
    return false;
  }

  getStream(params: {
    provider: StreamingProvider;
    anilistId: number;
    episode: number;
    type: AudioMode;
    now?: number;
  }): CachedAudioStreamEntry | null {
    const { provider, anilistId, episode, type } = params;
    const now = params.now ?? Date.now();
    const key = buildClientStreamCacheKey(provider, anilistId, episode, type);
    const entry = this.streamMap.get(key);
    if (!entry) return null;

    if (now > entry.expiresAt) {
      this.streamMap.delete(key);
      return null;
    }

    if (entry.available) {
      if (!isValidCachedStreamForType(entry.stream, { provider, anilistId, episode, type })) {
        this.streamMap.delete(key);
        return null;
      }
    }

    return entry;
  }

  setEpisodeBundle(params: {
    provider: StreamingProvider;
    anilistId: number;
    episode: number;
    subAvailable: boolean;
    dubAvailable: boolean;
    subStream: AniScrollStreamResponse | null;
    dubStream: AniScrollStreamResponse | null;
    subErrorCode?: string | null;
    dubErrorCode?: string | null;
    now?: number;
  }): void {
    const now = params.now ?? Date.now();
    const subOk = isValidCachedStreamForType(params.subStream, {
      provider: params.provider,
      anilistId: params.anilistId,
      episode: params.episode,
      type: 'sub',
    });
    const dubOk = isValidCachedStreamForType(params.dubStream, {
      provider: params.provider,
      anilistId: params.anilistId,
      episode: params.episode,
      type: 'dub',
    });

    this.setStream({
      provider: params.provider,
      anilistId: params.anilistId,
      episode: params.episode,
      type: 'sub',
      available: Boolean(params.subAvailable && subOk),
      stream: subOk ? params.subStream : null,
      errorCode: params.subErrorCode ?? null,
      now,
    });

    this.setStream({
      provider: params.provider,
      anilistId: params.anilistId,
      episode: params.episode,
      type: 'dub',
      available: Boolean(params.dubAvailable && dubOk),
      stream: dubOk ? params.dubStream : null,
      errorCode: params.dubErrorCode ?? null,
      now,
    });

    if (subOk || dubOk) {
      const availKey = buildClientAvailabilityCacheKey(
        params.provider,
        params.anilistId,
        params.episode
      );
      this.availabilityMap.set(availKey, {
        subAvailable: Boolean(params.subAvailable && subOk),
        dubAvailable: Boolean(params.dubAvailable && dubOk),
        subErrorCode: subOk ? null : params.subErrorCode ?? null,
        dubErrorCode: dubOk ? null : params.dubErrorCode ?? null,
        cachedAt: now,
        expiresAt: now + this.ttlMs,
      });
    }
  }

  resolveForPreference(params: {
    provider: StreamingProvider;
    anilistId: number;
    episode: number;
    userSelectedVersion?: AudioMode | null;
    defaultAudio?: AudioMode | null;
    now?: number;
  }): ResolvedCachedEpisodeStreams | null {
    const now = params.now ?? Date.now();
    const availKey = buildClientAvailabilityCacheKey(
      params.provider,
      params.anilistId,
      params.episode
    );
    const avail = this.availabilityMap.get(availKey);
    if (!avail || now > avail.expiresAt) {
      this.availabilityMap.delete(availKey);
      return null;
    }

    const subEntry = this.getStream({
      provider: params.provider,
      anilistId: params.anilistId,
      episode: params.episode,
      type: 'sub',
      now,
    });
    const dubEntry = this.getStream({
      provider: params.provider,
      anilistId: params.anilistId,
      episode: params.episode,
      type: 'dub',
      now,
    });

    const effectivePreferred: AudioMode =
      params.userSelectedVersion === 'dub' || params.userSelectedVersion === 'sub'
        ? params.userSelectedVersion
        : params.defaultAudio === 'dub' || params.defaultAudio === 'sub'
        ? params.defaultAudio
        : 'sub';

    // Bypass cache if the preferred audio track is not valid in cache and was not definitively unavailable
    if (effectivePreferred === 'dub') {
      const dubValid = Boolean(dubEntry?.available && dubEntry.stream?.type === 'dub');
      const dubConfirmedUnavailable =
        !avail.dubAvailable && avail.dubErrorCode === 'not_found';
      if (!dubValid && !dubConfirmedUnavailable) {
        return null;
      }
    } else {
      const subValid = Boolean(subEntry?.available && subEntry.stream?.type === 'sub');
      const subConfirmedUnavailable =
        !avail.subAvailable && avail.subErrorCode === 'not_found';
      if (!subValid && !subConfirmedUnavailable) {
        return null;
      }
    }

    const subAvailable = Boolean(subEntry?.available && subEntry.stream?.type === 'sub');
    const dubAvailable = Boolean(dubEntry?.available && dubEntry.stream?.type === 'dub');
    const subStream = subAvailable ? subEntry!.stream : null;
    const dubStream = dubAvailable ? dubEntry!.stream : null;

    if (!subAvailable && !dubAvailable) {
      return null;
    }

    const chosenVersion = selectEpisodeAudioVersion({
      subAvailable,
      dubAvailable,
      userSelectedVersion: params.userSelectedVersion,
      defaultAudio: params.defaultAudio,
    });

    const chosenStream =
      chosenVersion === 'dub'
        ? dubStream
        : chosenVersion === 'sub'
        ? subStream
        : null;

    if (chosenVersion && (!chosenStream || chosenStream.type !== chosenVersion)) {
      return null;
    }

    return {
      cacheHit: true,
      subAvailable,
      dubAvailable,
      subStream,
      dubStream,
      subErrorCode: avail.subErrorCode,
      dubErrorCode: avail.dubErrorCode,
      chosenVersion,
      chosenStream,
    };
  }

  deleteEpisode(provider: StreamingProvider, anilistId: number, episode: number): void {
    this.streamMap.delete(buildClientStreamCacheKey(provider, anilistId, episode, 'sub'));
    this.streamMap.delete(buildClientStreamCacheKey(provider, anilistId, episode, 'dub'));
    this.availabilityMap.delete(buildClientAvailabilityCacheKey(provider, anilistId, episode));
  }

  clear(): void {
    this.streamMap.clear();
    this.availabilityMap.clear();
  }
}

export const clientEpisodeStreamCache = new ClientEpisodeStreamCache();
