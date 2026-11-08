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
  id: string;
  shortId: number;
  relationType: string;
  titleRomaji?: string;
  titleEnglish?: string;
  coverImage?: string;
  format?: string;
}

export interface HoshikaAnimeItem {
  id: string;
  shortId: number;
  slug: string;
  titleRomaji?: string | null;
  titleEnglish?: string | null;
  titleJapanese?: string | null;
  titleLocalized?: string | null;
  synopsis?: string | null;
  coverImage?: string | null;
  bannerImage?: string | null;
  bannerFocusX?: number | null;
  bannerFocusY?: number | null;
  format?: string | null;
  status?: string | null;
  season?: string | null;
  seasonYear?: number | null;
  episodes?: number | null;
  episodeDuration?: number | null;
  averageScore?: number | null;
  canonScore?: number | null;
  canonCount?: number | null;
  rating?: string | null;
  demographic?: string | null;
  trailerId?: string | null;
  trailerSite?: string | null;
  startedAiring?: string | null;
  finishedAiring?: string | null;
  genres?: HoshikaGenre[];
  studios?: HoshikaStudio[];
  characters?: HoshikaCharacter[];
  relations?: HoshikaRelation[];
  nextEpisodeNumber?: number | null;
  nextEpisodeAiringAt?: string | null;
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

export interface IdMappingResult {
  hoshikaId: string | number;
  anilistId: number | null;
  malId: number | null;
  mappingStatus: 'verified' | 'provisional' | 'failed';
  matchedTitle?: string;
  confidence?: number;
  cached?: boolean;
}
