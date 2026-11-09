export interface SubtitleTrack {
  url: string;
  lang: string;
  default: boolean;
}

export interface AniScrollStreamResponse {
  anilistId: number;
  malId?: number | null;
  title: string;
  episode: number;
  type: 'sub' | 'dub';
  source?: string;
  server: string;
  availableServers: string[];
  embedUrl?: string;
  m3u8?: string;
  hlsProxyUrl?: string;
  playbackMode?: 'hls' | 'embed' | 'direct';
  iframeOnly?: boolean;
  subtitles?: SubtitleTrack[];
  intro?: { start: number; end: number } | null;
  outro?: { start: number; end: number } | null;
  note?: string | null;
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
  coverImage?: string;
  bannerImage?: string;
  episodeNumber: number;
  episodeTitle?: string;
  currentTime: number;
  duration: number;
  timestamp: number;
  completed?: boolean;
}

export interface WatchlistEntry {
  hoshikaId: number;
  title: string;
  coverImage?: string;
  format?: string;
  rating?: number;
  seasonYear?: number;
  status?: 'watching' | 'plan_to_watch' | 'completed' | 'on_hold' | 'dropped';
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
