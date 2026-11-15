export type StreamingProvider = 'megaplay' | 'zokoanime';

export type AnimeContentFormat =
  | 'TV'
  | 'TV_SHORT'
  | 'OVA'
  | 'ONA'
  | 'SPECIAL'
  | 'MOVIE'
  | 'MUSIC'
  | 'UNKNOWN';

export interface HlsManifestQualityLevel {
  levelIndex: number;
  label: string;
  height: number;
  width?: number;
  resolution?: string;
  bandwidth?: number;
}

export type SubtitlePreference = 'off' | string;

export interface SubtitleTrack {
  lang: string;
  label?: string;
  default: boolean;
  src?: string;
  url: string;
}

export interface ZokoAnimeQuality {
  quality: string;
  resolution?: string;
  width?: number;
  height?: number;
  bandwidth?: number;
  hlsProxyUrl: string;
}

export interface AniScrollStreamResponse {
  source: string;
  provider?: StreamingProvider;
  format?: string | null;
  anilistId: number;
  malId?: number | null;
  title?: string;
  episode: number;
  type: 'sub' | 'dub';
  embedUrl?: string;
  m3u8?: string;
  qualities?: ZokoAnimeQuality[];
  subtitles?: SubtitleTrack[];
  downloadUrl?: string;
  videoId?: number | string;
  skip?: {
    intro?: { start: number; end: number } | null;
    outro?: { start: number; end: number } | null;
  } | null;
  playbackMode?: 'hls' | 'embed' | 'direct' | string;
  serverName?: string;
  server?: string;
  availableServers?: string[];
  hlsProxyUrl?: string;
  iframeOnly?: boolean;
  intro?: { start: number; end: number } | null;
  outro?: { start: number; end: number } | null;
  note?: string | null;
  error?: string;
}

export interface EpisodeStreamAvailability {
  anilistId: number;
  episode: number;
  provider?: StreamingProvider;
  format?: string | null;
  subAvailable: boolean;
  dubAvailable: boolean;
  subStream: AniScrollStreamResponse | null;
  dubStream: AniScrollStreamResponse | null;
  defaultVersion: 'sub' | 'dub' | null;
}

export interface SkipInterval {
  startTime: number;
  endTime: number;
}

export interface AniSkipResult {
  interval: SkipInterval;
  skipType: 'op' | 'ed' | 'mixed-op' | 'mixed-ed' | 'recap';
  skipId?: string;
  episodeLength?: number;
}

export interface AniSkipResponse {
  found: boolean;
  results: AniSkipResult[];
  message?: string;
  statusCode?: number;
}

export interface WatchHistoryEntry {
  hoshikaId: number;
  anilistId?: number | null;
  malId?: number | null;
  title: string;
  animeTitle?: string;
  coverImage?: string;
  animeCover?: string;
  bannerImage?: string;
  episodeNumber: number;
  episodeTitle?: string;
  episodeThumbnail?: string;
  currentTime: number;
  duration: number;
  progress?: number;
  audioType?: 'sub' | 'dub';
  timestamp: number;
  lastWatched?: number | string;
  completed?: boolean;
}

export type WatchlistStatus =
  | 'watching'
  | 'plan_to_watch'
  | 'completed'
  | 'on_hold'
  | 'dropped';

export interface WatchlistEntry {
  hoshikaId: number;
  title: string;
  coverImage?: string;
  format?: string;
  rating?: number;
  seasonYear?: number;
  status?: WatchlistStatus;
  episodeProgress?: number;
  addedAt: number;
}

export interface UserPreferences {
  autoPlayNext: boolean;
  autoSkipIntro: boolean;
  autoSkipOutro: boolean;
  defaultAudio: 'sub' | 'dub';
  defaultQuality: 'auto' | '1080p' | '720p' | '480p';
  sidebarCollapsed: boolean;
  compactCards: boolean;
}

export type SubtitleFontFamily =
  | 'Arial'
  | 'Roboto'
  | 'Verdana'
  | 'Georgia'
  | 'Monospace'
  | 'System default';

export type SubtitleFontWeight = 'Normal' | 'Bold';

export type SubtitleTextColorPreset = 'White' | 'Yellow' | 'Green' | 'Cyan' | 'Custom';

export type SubtitleOutline = 'None' | 'Thin' | 'Thick';

export type SubtitleShadow = 'Off' | 'Light' | 'Strong';

export type SubtitlePosition = 'Top' | 'Middle' | 'Bottom';

export type SubtitleAlignment = 'Left' | 'Center' | 'Right';

export interface SubtitlePreferences {
  fontFamily: SubtitleFontFamily;
  fontSize: number; // 12px to 48px
  fontWeight: SubtitleFontWeight;
  textColor: string;
  textColorPreset: SubtitleTextColorPreset;
  backgroundColor: string;
  backgroundOpacity: number; // 0 to 100
  isBackgroundTransparent: boolean;
  outline: SubtitleOutline;
  shadow: SubtitleShadow;
  position: SubtitlePosition;
  alignment: SubtitleAlignment;
  offsetSeconds: number; // -5.0 to +5.0s
}

export interface ParsedSubtitleCue {
  id?: string;
  startTime: number; // in seconds
  endTime: number; // in seconds
  text: string;
}
