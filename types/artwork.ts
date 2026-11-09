export interface FanartImage {
  id: string;
  url: string;
  lang?: string;
  likes?: string | number;
  season?: string;
}

export interface FanartTvResponse {
  name?: string;
  thetvdb_id?: string | number;
  showbackground?: FanartImage[];
  show4kbackground?: FanartImage[];
  hdtvlogo?: FanartImage[];
  clearlogo?: FanartImage[];
  characterart?: FanartImage[];
  tvbanner?: FanartImage[];
  showthumb?: FanartImage[];
  hdclearart?: FanartImage[];
}

export type ArtworkBackgroundSource =
  | 'fanart_showbackground'
  | 'fanart_show4kbackground'
  | 'hoshika_banner'
  | 'hoshika_cover'
  | 'fallback';

export type ArtworkLogoSource =
  | 'fanart_hdtvlogo'
  | 'fanart_clearlogo'
  | 'typography';

export interface AnimeArtworkResult {
  hoshikaId: string | number;
  anilistId: number | null;
  tvdbId: number | null;
  tmdbId: number | null;
  title: string;
  backgroundUrl: string | null;
  backgroundSource: ArtworkBackgroundSource;
  logoUrl: string | null;
  logoSource: ArtworkLogoSource;
  characterArtUrl: string | null;
  bannerUrl: string | null;
  cachedAt: number;
}
