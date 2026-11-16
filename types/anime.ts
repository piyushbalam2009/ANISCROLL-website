export interface HoshikaTitle {
  titleRomaji?: string | null;
  titleEnglish?: string | null;
  titleJapanese?: string | null;
  titleLocalized?: string | null;
}

export interface HoshikaGenre {
  name: string;
  slug: string;
}

export interface HoshikaStudio {
  name: string;
  slug: string;
}

export interface HoshikaCharacter {
  id: string;
  name: string;
  role: string;
  avatar?: string | null;
  seiyuu?: {
    id: string;
    name: string;
    avatar?: string | null;
  } | null;
}

export interface HoshikaRelation {
  id?: string;
  shortId: number;
  slug?: string;
  relationType: string;
  title?: string | null;
  titleRomaji?: string | null;
  titleEnglish?: string | null;
  coverImage?: string | null;
  format?: string | null;
}

export interface HoshikaRecommendation {
  id?: string;
  shortId: number;
  slug?: string;
  title?: string | null;
  titleRomaji?: string | null;
  titleEnglish?: string | null;
  coverImage?: string | null;
  averageScore?: number | null;
  format?: string | null;
}

export interface HoshikaVideo {
  id: string;
  title?: string | null;
  youtubeId?: string | null;
  image?: string | null;
}

export interface HoshikaStreamingLink {
  platform: string;
  url: string;
}

export interface HoshikaStats {
  watching?: number;
  completed?: number;
  on_hold?: number;
  plan_to_watch?: number;
  [key: string]: number | undefined;
}

export interface HoshikaAnimeItem {
  id: string;
  shortId: number;
  slug: string;
  titleRomaji?: string | null;
  titleEnglish?: string | null;
  titleJapanese?: string | null;
  titleLocalized?: string | null;
  nativeTitle?: string | null;
  originalTitle?: string | null;
  synonyms?: string[];
  alternativeTitles?: string[];
  synopsis?: string | null;
  coverImage?: string | null;
  bannerImage?: string | null;
  bannerFocusX?: number | null;
  bannerFocusY?: number | null;
  format?: string | null;
  status?: string | null;
  season?: string | null;
  seasonYear?: number | null;
  source?: string | null;
  episodes?: number | null;
  episodeDuration?: number | null;
  averageScore?: number | null;
  canonScore?: number | null;
  canonCount?: number | null;
  rating?: string | null;
  demographic?: string | null;
  favoriteCount?: number | null;
  trailerId?: string | null;
  trailerSite?: string | null;
  startedAiring?: string | null;
  finishedAiring?: string | null;
  genres?: HoshikaGenre[];
  studios?: HoshikaStudio[];
  characters?: HoshikaCharacter[];
  relations?: HoshikaRelation[];
  recommendations?: HoshikaRecommendation[];
  videos?: HoshikaVideo[];
  pictures?: string[];
  streaming?: HoshikaStreamingLink[];
  stats?: HoshikaStats | null;
  nextEpisodeNumber?: number | null;
  nextEpisodeAiringAt?: string | null;
  anilistId?: number | null;
  malId?: number | null;
  thetvdbId?: string | number | null;
  themoviedbId?: string | number | null;
  isStandaloneMovie?: boolean | null;
  standaloneMovie?: boolean | null;
}

export interface HoshikaEpisodeItem {
  id: string;
  number: number;
  title?: string | null;
  synopsis?: string | null;
  thumbnail?: string | null;
  aired?: string | null;
  filler?: boolean;
  recap?: boolean;
  averageScore?: number | null;
  youtubeId?: string | null;
}

export interface ScheduleItem extends HoshikaAnimeItem {
  episode?: number;
  airingAt?: string;
}

export type AniListMatchType =
  | 'english'
  | 'romaji'
  | 'native'
  | 'synonym'
  | 'fuzzy'
  | 'none';

export interface AniListCandidateSummary {
  id: number;
  malId?: number | null;
  englishTitle: string | null;
  romajiTitle: string | null;
  nativeTitle: string | null;
  synonyms: string[];
  format: string | null;
  seasonYear: number | null;
  episodes: number | null;
  status: string | null;
  confidence: number;
  matchType: AniListMatchType;
  explanation: string;
}

export interface IdMappingResult {
  hoshikaId: string | number;
  aniListId: number | null;
  anilistId: number | null;
  malId: number | null;
  format?: string | null;
  title?: string;
  mappingStatus: 'verified' | 'provisional' | 'failed';
  status?: 'verified' | 'provisional' | 'failed';
  matchedTitle?: string | null;
  matchType?: AniListMatchType;
  explanation?: string;
  confidence?: number;
  cached?: boolean;
  candidates?: AniListCandidateSummary[];
  errorCategory?: string;
  retryAfterMs?: number;
}
