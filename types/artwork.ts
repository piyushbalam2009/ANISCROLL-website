export interface FanartImage {
  id: string;
  url: string;
  lang: string;
  likes: string;
  season?: string;
}

export interface FanartResponse {
  name?: string;
  thetvdb_id?: string;
  tmdb_id?: string;
  hdtvlogo?: FanartImage[];
  clearlogo?: FanartImage[];
  hdmovielogo?: FanartImage[];
  movielogo?: FanartImage[];
  showbackground?: FanartImage[];
  moviebackground?: FanartImage[];
  tvthumb?: FanartImage[];
  moviethumb?: FanartImage[];
  hdclearart?: FanartImage[];
  clearart?: FanartImage[];
  tvposter?: FanartImage[];
  movieposter?: FanartImage[];
}

export interface FanartLogoItem {
  id: string;
  url: string;
  proxyUrl: string;
  lang: string;
  likes: number;
  source: 'fanart_hdtvlogo' | 'fanart_clearlogo' | 'custom_upload';
  category: 'hdtvlogo' | 'clearlogo' | 'custom';
  label?: string;
  width?: number;
  height?: number;
}

export interface CustomLogoItem {
  id: string;
  storagePath: string;
  url: string;
  proxyUrl: string;
  fileName: string;
  fileSize: number;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/webp';
  lang: string;
  uploadedBy: string;
  uploadedByEmail: string;
  uploadedAt: string;
}

export interface LogoDisplaySettings {
  width: number; // px (e.g. 240 - 650, default 420)
  scale: number; // % (e.g. 50 - 150, default 100)
  horizontalPosition: number; // px offset (-120 to +120, default 0)
  verticalPosition: number; // px offset (-80 to +80, default 0)
}

export const DEFAULT_LOGO_DISPLAY_SETTINGS: LogoDisplaySettings = {
  width: 420,
  scale: 100,
  horizontalPosition: 0,
  verticalPosition: 0,
};

export type AnimeLogoStatus =
  | 'valid'
  | 'missing'
  | 'japanese_only'
  | 'no_english'
  | 'low_resolution'
  | 'broken'
  | 'typography_fallback'
  | 'custom_override';

export interface AnimeArtworkResult {
  hoshikaId: number;
  title?: string;
  anilistId?: number | null;
  malId?: number | null;
  tvdbId?: number | null;
  tmdbId?: number | null;
  backgroundUrl: string | null;
  backgroundSource?:
    | 'fanart'
    | 'anilist_banner'
    | 'hoshika_banner'
    | 'hoshika_cover'
    | 'none';
  logoUrl: string | null;
  logoSource?:
    | 'fanart_hdtvlogo'
    | 'fanart_clearlogo'
    | 'custom_upload'
    | 'typography';
  characterArtUrl: string | null;
  posterUrl: string | null;
  source: 'fanart' | 'anilist' | 'hoshika' | 'custom_override';
  fetchedAt: number;
  // Enhanced Artwork & Admin Override Metadata
  availableLogos?: FanartLogoItem[];
  customLogos?: CustomLogoItem[];
  hiddenLogoIds?: string[];
  selectionMode?: 'auto' | 'manual';
  selectedLogoSource?:
    | 'fanart_hdtvlogo'
    | 'fanart_clearlogo'
    | 'custom_upload'
    | 'typography_fallback';
  selectedLogoLanguage?: string;
  logoDisplay?: LogoDisplaySettings;
  logoStatus?: AnimeLogoStatus;
  hasEnglishLogo?: boolean;
  hasJapaneseLogo?: boolean;
  reviewed?: boolean;
}
